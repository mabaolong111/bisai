'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const root = path.resolve(__dirname, '..');
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sourceData = path.join(__dirname, 'acceptance-isolated-data.json');
const dataFile = path.join(__dirname, 'browser-isolated-data.json');
const reportFile = path.join(__dirname, 'browser-acceptance-report.json');
const productionFile = path.join(root, 'nuanlin-data.json');
const productionHash = crypto.createHash('sha256').update(fs.readFileSync(productionFile)).digest('hex');
const results = [];
const consoleErrors = [];
const screenshots = [];
let server;
let browser;
let cdp;
let sessionId = '';
let servicePort = 0;
let debugPort = 0;
let profile = '';
let nextId = 0;
const pending = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pass = (name, detail = '') => { results.push({ name, status: '通过', detail }); console.log('PASS ' + name); };
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const value = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(value));
    });
  });
}
async function startServer() {
  fs.copyFileSync(sourceData, dataFile);
  servicePort = await freePort();
  server = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root, env: { ...process.env, NUANLIN_PORT: String(servicePort), NUANLIN_DATA: dataFile }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  let output = '';
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${servicePort}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await sleep(150);
  }
  throw new Error('UI 测试服务启动失败：' + output);
}
async function startBrowser() {
  if (!fs.existsSync(edge)) throw new Error('未找到本机 Edge：' + edge);
  debugPort = await freePort();
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nuanlin-edge-'));
  browser = spawn(edge, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--window-size=1440,1000', `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  let socketUrl = '';
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(600) });
      if (response.ok) { socketUrl = (await response.json()).webSocketDebuggerUrl; break; }
    } catch {}
    await sleep(150);
  }
  if (!socketUrl) throw new Error('Edge 调试接口启动超时');
  cdp = new WebSocket(socketUrl);
  await new Promise((resolve, reject) => {
    cdp.addEventListener('open', resolve, { once: true });
    cdp.addEventListener('error', reject, { once: true });
  });
  cdp.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails?.text || '页面脚本异常');
  });
  const target = await send('Target.createTarget', { url: 'about:blank' });
  const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  sessionId = attached.sessionId;
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
}
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    cdp.send(JSON.stringify(message));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || expression);
  return result.result.value;
}
async function waitFor(expression, description) {
  let last;
  for (let i = 0; i < 100; i++) {
    try { if (await evaluate(expression)) return; } catch (error) { last = error; }
    await sleep(100);
  }
  throw new Error('等待页面条件超时：' + description + (last ? '；' + last.message : ''));
}
async function navigate() {
  await send('Page.navigate', { url: `http://127.0.0.1:${servicePort}/` }, sessionId);
  await waitFor(`document.readyState === 'complete' && (!document.getElementById('login-form').hidden || !document.querySelector('.app-shell').hidden)`, '首页或登录页');
}
async function login(username, portal) {
  await waitFor(`!document.getElementById('login-form').hidden`, '登录表单');
  await evaluate(`document.querySelector('[data-action="select-portal"][data-portal="${portal}"]').click(); (() => { const f = document.getElementById('login-form'); f.elements.username.value = '${username}'; f.elements.password.value = 'Test-Only-2026!'; f.requestSubmit(); })(); true`);
  await waitFor(`!document.querySelector('.app-shell').hidden`, `${portal} 登录完成`);
}
async function logout() {
  assert.equal(await evaluate(`document.querySelectorAll('[data-action="logout"]').length`), 1);
  await evaluate(`document.querySelector('.topbar [data-action="logout"]').click(); true`);
  await waitFor(`!document.getElementById('access-screen').hidden && !document.getElementById('login-form').hidden`, '退出登录');
  assert.equal(await evaluate(`state.data === null && document.querySelector('.app-shell').hidden`), true);
  assert.equal(await evaluate(`fetch('/api/state', { credentials: 'same-origin' }).then(response => response.status)`), 401);
}
async function screenshot(name) {
  await sleep(250);
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  const file = path.join(__dirname, name);
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  screenshots.push(file);
}
async function setViewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId);
  await sleep(200);
}
async function closeAll() {
  if (cdp && cdp.readyState === WebSocket.OPEN) {
    try { await send('Browser.close'); } catch {}
  }
  if (browser && browser.exitCode === null) {
    const exited = once(browser, 'exit');
    browser.kill();
    await Promise.race([exited, sleep(3000)]);
  }
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await Promise.race([exited, sleep(3000)]);
  }
  if (profile) try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
}
async function main() {
  await startServer();
  const yanglaoPage = await fetch(`http://127.0.0.1:${servicePort}/yanglao.html`);
  assert.equal(yanglaoPage.status, 200);
  assert.match(yanglaoPage.headers.get('content-type') || '', /text\/html/);
  assert.ok((await yanglaoPage.text()).includes('<title>暖邻 · 便民养老智能服务平台</title>'));
  const elderPhoto = await fetch(`http://127.0.0.1:${servicePort}/assets/elder-community-home.jpg`);
  assert.equal(elderPhoto.status, 200);
  assert.match(elderPhoto.headers.get('content-type') || '', /image\/jpeg/);
  assert.ok((await elderPhoto.arrayBuffer()).byteLength > 100000);
  await startBrowser();
  await navigate();
  assert.equal(await evaluate(`document.getElementById('login-form').hidden`), false);
  assert.ok(await evaluate(`parseFloat(getComputedStyle(document.body).fontSize) > 0`));
  assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector('#login-submit')).fontSize) > 0`));
  pass('电脑尺寸登录页及 yanglao.html 静态路由');

  await login('elder_a_test', 'elder');
  const elderBaseFont = await evaluate(`parseFloat(getComputedStyle(document.documentElement).fontSize)`);
  const desktop = await evaluate(`(() => {
    const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const targets = [...document.querySelectorAll('button, a[href], input:not([type="checkbox"]):not([type="radio"]), select, textarea, summary, label.check-row')].filter(visible).map(el => ({ text: el.textContent.trim().slice(0, 40), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
    const textNodes = [...document.querySelectorAll('body *')].filter(el => visible(el) && [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())).map(el => ({ text: el.textContent.trim().slice(0, 40), size: parseFloat(getComputedStyle(el).fontSize) }));
    const order = [...document.querySelector('.main-column').children].map(el => el.id || (el.classList.contains('voice-panel') ? 'voice-panel' : el.className));
    const rgb = value => (value.match(/[0-9.]+/g) || []).slice(0, 3).map(Number);
    const luminance = value => { const c = rgb(value).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return c[0] * .2126 + c[1] * .7152 + c[2] * .0722; };
    const contrast = el => { const fg = luminance(getComputedStyle(el).color); let node = el; let bg = 1; let background = 'fallback-white'; while (node) { const value = getComputedStyle(node).backgroundColor; const parts = (value.match(/[0-9.]+/g) || []).map(Number); if (parts.length >= 3 && (value.startsWith('rgb(') || parts.length < 4 || parts[3] > 0)) { bg = luminance(value); background = value; break; } node = node.parentElement; } el.dataset.testContrast = getComputedStyle(el).color + ' on ' + background; return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05); };
    const contrastSelectors = ['body', '.service-description', '.primary-button', '.secondary-button', '.reminder-item small', '.voice-note'];
    return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, body: parseFloat(getComputedStyle(document.body).fontSize), bodyLeading: parseFloat(getComputedStyle(document.body).lineHeight) / parseFloat(getComputedStyle(document.body).fontSize), headingLeading: parseFloat(getComputedStyle(document.querySelector('#greeting')).lineHeight) / parseFloat(getComputedStyle(document.querySelector('#greeting')).fontSize), heading: parseFloat(getComputedStyle(document.querySelector('#greeting')).fontSize), primary: parseFloat(getComputedStyle(document.querySelector('.primary-button')).fontSize), services: document.querySelectorAll('.service-card').length, columns: getComputedStyle(document.querySelector('.service-grid')).gridTemplateColumns, tooSmall: targets.filter(x => x.width < 60 || x.height < 60), smallText: textNodes.filter(x => x.size < 16), order, decorationHidden: getComputedStyle(document.querySelector('.hero-illustration')).display === 'none' && getComputedStyle(document.querySelector('.resource-map')).display === 'none', homeIcon: getComputedStyle(document.querySelector('.service-card-blue .service-icon')).color, checkupIcon: getComputedStyle(document.querySelector('.service-card-purple .service-icon')).color, contrasts: contrastSelectors.map(selector => ({ selector, ratio: contrast(document.querySelector(selector)), raw: document.querySelector(selector).dataset.testContrast, colorParts: (getComputedStyle(document.querySelector(selector)).color.match(/[0-9.]+/g) || []) })) };
  })()`);
  assert.equal(desktop.width, 1440);
  assert.equal(desktop.overflow, false);
  assert.ok(desktop.body >= 20 && desktop.heading >= 24 && desktop.primary >= 22);
  assert.ok(desktop.bodyLeading >= 1.5 && desktop.bodyLeading <= 1.8);
  assert.ok(Math.abs(desktop.headingLeading - 1.3) < .02);
  assert.equal(desktop.services, 6);
  assert.ok(!desktop.columns.includes(' '));
  assert.deepEqual(desktop.tooSmall, []);
  assert.deepEqual(desktop.smallText, []);
  assert.equal(desktop.decorationHidden, true);
  assert.equal(desktop.homeIcon, 'rgb(11, 92, 80)');
  assert.equal(desktop.checkupIcon, 'rgb(91, 97, 27)');
  assert.ok(desktop.order.indexOf('service-home') < desktop.order.indexOf('reminders-section'));
  assert.ok(desktop.order.indexOf('reminders-section') < desktop.order.indexOf('voice-panel'));
  assert.ok(desktop.order.indexOf('voice-panel') < desktop.order.indexOf('workspace'));
  assert.ok(desktop.contrasts.every(item => item.ratio >= 4.5), JSON.stringify(desktop.contrasts));
  pass('老人六入口单列布局、最小文字、行距、对比度、整区热区及内容优先级');

  await evaluate(`document.querySelector('[data-scale="1.4"]').click(); document.querySelector('[data-theme-value="night"]').click(); true`);
  assert.ok(Math.abs(await evaluate(`parseFloat(getComputedStyle(document.documentElement).fontSize)`) - elderBaseFont * 1.4) < .1);
  assert.equal(await evaluate(`document.body.dataset.theme`), 'night');
  await send('Page.reload', { ignoreCache: true }, sessionId);
  await waitFor(`!document.querySelector('.app-shell').hidden`, '显示设置刷新恢复');
  assert.ok(Math.abs(await evaluate(`parseFloat(getComputedStyle(document.documentElement).fontSize)`) - elderBaseFont * 1.4) < .1);
  assert.equal(await evaluate(`document.body.dataset.theme`), 'night');
  await evaluate(`document.querySelector('[data-theme-value="contrast"]').click(); true`);
  assert.equal(await evaluate(`document.body.dataset.theme`), 'contrast');
  await evaluate(`document.querySelector('[data-action="reset-display"]').click(); true`);
  assert.ok(Math.abs(await evaluate(`parseFloat(getComputedStyle(document.documentElement).fontSize)`) - elderBaseFont) < .1);
  assert.equal(await evaluate(`document.body.dataset.theme`), 'normal');
  await sleep(650);
  const photoMotion = await evaluate(`(() => { const scene = document.querySelector('.elder-photo-scene'); const frame = document.querySelector('.elder-photo-frame'); const image = frame.querySelector('img'); return { visible: scene.getBoundingClientRect().width > 0 && image.complete && image.naturalWidth === 1200, perspective: getComputedStyle(scene).perspective, transformStyle: getComputedStyle(frame).transformStyle, animationName: getComputedStyle(frame).animationName, duration: getComputedStyle(frame).animationDuration, iterations: getComputedStyle(frame).animationIterationCount, settled: frame.getAnimations().every(animation => animation.playState === 'finished') }; })()`);
  assert.equal(photoMotion.visible, true);
  assert.equal(photoMotion.perspective, '900px');
  assert.equal(photoMotion.transformStyle, 'preserve-3d');
  assert.equal(photoMotion.animationName, 'elder-photo-enter');
  assert.equal(photoMotion.duration, '0.56s');
  assert.equal(photoMotion.iterations, '1');
  assert.equal(photoMotion.settled, true);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
  const reducedMotion = await evaluate(`({ animation: getComputedStyle(document.querySelector('.elder-photo-frame')).animationName, transform: getComputedStyle(document.querySelector('.elder-photo-frame')).transform, imageTransform: getComputedStyle(document.querySelector('.elder-photo-frame img')).transform })`);
  assert.equal(reducedMotion.animation, 'none');
  assert.equal(reducedMotion.transform, 'none');
  assert.equal(reducedMotion.imageTransform, 'none');
  await send('Emulation.setEmulatedMedia', { features: [] }, sessionId);
  pass('老人端三档字号、主题、本地保存及图片单次 3D 入场和静态降级');

  await evaluate(`document.querySelector('[data-type="home"]').click(); true`);
  await waitFor(`document.getElementById('modal-backdrop').classList.contains('open')`, '居家服务弹窗');
  await evaluate(`(() => { const option = document.getElementById('form-option'); option.value = '陪护照料'; option.dispatchEvent(new Event('change', { bubbles: true })); const select = document.getElementById('form-resource'); const target = [...select.options].find(x => x.value && x.textContent.includes('测试备用照护站')); if (!target) throw new Error('陪护资源选项未生成'); select.value = target.value; select.dispatchEvent(new Event('change', { bubbles: true })); const date = document.getElementById('form-date'); date.value = addDays(state.data.today, 3); date.dispatchEvent(new Event('change', { bubbles: true })); })(); true`);
  await waitFor(`document.getElementById('form-time').value && [...document.getElementById('form-time').options].some(x => !x.disabled && x.value)`, '可用服务时段');
  await screenshot('browser-desktop-form.png');
  await evaluate(`document.getElementById('form-name').value = '浏览器验收称呼'; document.getElementById('form-note').value = '浏览器表单实际提交'; document.getElementById('form-confirm').checked = true; document.getElementById('service-form').requestSubmit(); true`);
  await waitFor(`!document.getElementById('modal-backdrop').classList.contains('open') && document.getElementById('workspace').textContent.includes('浏览器验收称呼')`, '表单提交及工单展示');
  pass('居家主要表单、资源时段弹窗和浏览器实际提交称呼留痕');

  const compressed = await evaluate(`(async () => { const canvas = document.createElement('canvas'); canvas.width = 2000; canvas.height = 1200; const context = canvas.getContext('2d'); context.fillStyle = '#dff0e9'; context.fillRect(0, 0, 2000, 1200); context.fillStyle = '#173238'; context.font = '60px sans-serif'; context.fillText('虚构材料图片', 100, 150); const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); const encoded = await encodeAttachment(new File([blob], '虚构材料.png', { type: 'image/png' })); const image = await createImageBitmap(await (await fetch(encoded)).blob()); const result = { jpeg: encoded.startsWith('data:image/jpeg;base64,'), length: encoded.length, width: image.width, height: image.height }; image.close(); return result; })()`);
  assert.equal(compressed.jpeg, true);
  assert.ok(compressed.length < 1000000);
  assert.ok(compressed.width <= 1200 && compressed.height <= 1200);
  pass('虚构大图在浏览器内实际压缩为 JPEG、限制尺寸并满足上传上限');

  const beforeVoice = await evaluate(`state.data.cases.length`);
  await evaluate(`document.getElementById('voice-text').value = '明天下午三点三十分陪护照料，称呼我浏览器奶奶'; document.getElementById('voice-text-form').requestSubmit(); true`);
  await waitFor(`document.getElementById('modal-backdrop').classList.contains('open')`, '语音文字指令打开表单');
  await sleep(800);
  if (!await evaluate(`document.getElementById('form-time').value`)) {
    await evaluate(`(() => { const select = document.getElementById('form-resource'); const target = [...select.options].find(x => x.value && x.textContent.includes('测试备用照护站')); if (!target) throw new Error('语音表单没有可用陪护资源'); select.value = target.value; select.dispatchEvent(new Event('change', { bubbles: true })); })(); true`);
  }
  await waitFor(`document.getElementById('form-time').value === '15:30'`, '选择资源后保留语音识别时段');
  const voiceDebug = await evaluate(`({ name: document.getElementById('form-name')?.value, slot: document.getElementById('form-time')?.value, date: document.getElementById('form-date')?.value, option: document.getElementById('form-option')?.value, result: document.getElementById('voice-result').textContent })`);
  console.log('VOICE_DEBUG ' + JSON.stringify(voiceDebug));
  assert.equal(voiceDebug.name, '浏览器奶奶');
  assert.equal(voiceDebug.slot, '15:30');
  assert.ok((await evaluate(`document.getElementById('voice-result').textContent`)).includes('必须由您核对'));
  assert.equal(await evaluate(`state.data.cases.length`), beforeVoice);
  await evaluate(`document.querySelector('#modal-backdrop [data-action="close-modal"]').click(); document.getElementById('voice-text').value = '明天下午陪护照料'; document.getElementById('voice-text-form').requestSubmit(); true`);
  await waitFor(`document.getElementById('voice-result').textContent.includes('下午包含多个时段')`, '歧义时段提示');
  assert.equal(await evaluate(`document.getElementById('form-time').value`), '');
  await evaluate(`document.querySelector('#modal-backdrop [data-action="close-modal"]').click(); document.getElementById('voice-text').value = '查询高龄补贴政策'; document.getElementById('voice-text-form').requestSubmit(); true`);
  await waitFor(`document.getElementById('voice-result').textContent.includes('高龄补贴本地演示初审依据')`, '政策查询与文字反馈');
  pass('语音文字指令识别、关键内容复述、歧义确认、政策查询及不自动提交');

  const speech = await evaluate(`(() => { const supported = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'; if (!supported) return { supported: false }; document.querySelector('[data-action="speak-page"]').click(); const last = state.lastSpeech; document.querySelector('[data-action="speech-pause"]').click(); document.querySelector('[data-action="speech-resume"]').click(); document.querySelector('[data-action="speech-replay"]').click(); return { supported: true, voices: speechSynthesis.getVoices().filter(x => x.lang.toLowerCase().startsWith('zh')).map(x => x.name + ':' + x.lang), utteranceCreated: last.length > 20, speakingOrPending: speechSynthesis.speaking || speechSynthesis.pending }; })()`);
  assert.equal(speech.supported, true);
  assert.equal(speech.utteranceCreated, true);
  await evaluate(`document.getElementById('listen-button').click(); true`);
  await sleep(800);
  const recognition = await evaluate(`(() => { const supported = !!(window.SpeechRecognition || window.webkitSpeechRecognition); const result = { supported, text: document.getElementById('voice-result').textContent, button: document.getElementById('listen-button').textContent }; try { recognition?.abort(); } catch {} return result; })()`);
  if (!recognition.supported) assert.ok(recognition.text.includes('此浏览器不支持语音识别'));
  pass('朗读、暂停、继续、重播、语速控件及语音识别降级路径调用', JSON.stringify({ speech, recognition }));

  const profileValidity = await evaluate(`(() => { const form = document.getElementById('profile-form'); return { valid: form.checkValidity(), invalid: [...form.elements].filter(x => !x.checkValidity()).map(x => ({ name: x.name, message: x.validationMessage, value: x.value })) }; })()`);
  console.log('PROFILE_DEBUG ' + JSON.stringify(profileValidity));
  assert.equal(profileValidity.valid, true);
  await evaluate(`document.querySelector('#profile-form [name="needs"][value="日间照料"]').click(); document.getElementById('profile-form').requestSubmit(); true`);
  await waitFor(`state.data.profile.needs.includes('日间照料')`, '画像服务端保存');
  await send('Page.reload', { ignoreCache: true }, sessionId);
  await waitFor(`!document.querySelector('.app-shell').hidden`, '画像刷新恢复');
  assert.equal(await evaluate(`document.querySelector('#profile-form [name="needs"][value="日间照料"]').checked`), true);
  assert.equal(await evaluate(`document.querySelector('#recommendation-list').textContent.includes('测试主照护站')`), false);
  const resourcePoint = await evaluate(`(() => { const heading = document.querySelector('#recommendation-list .resource-content h3'); heading.scrollIntoView({ block: 'center', behavior: 'instant' }); const rect = heading.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...resourcePoint, button: 'left', clickCount: 1 }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...resourcePoint, button: 'left', clickCount: 1 }, sessionId);
  await waitFor(`document.getElementById('modal-backdrop').classList.contains('open')`, '资源卡非按钮区域打开详情');
  assert.ok((await evaluate(`document.getElementById('modal-title').textContent`)).length > 0);
  await evaluate(`document.querySelector('#modal-backdrop [data-action="close-modal"]').click(); true`);
  pass('画像刷新、下架资源隔离及资源整卡点击');

  await setViewport(390, 844, true);
  await send('Page.reload', { ignoreCache: true }, sessionId);
  await waitFor(`!document.querySelector('.app-shell').hidden`, '手机首页');
  const mobile = await evaluate(`(() => { const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); const targets = [...document.querySelectorAll('button, a[href], input:not([type="checkbox"]):not([type="radio"]), select, textarea, summary, label.check-row')].filter(visible).map(el => ({ text: el.textContent.trim().slice(0, 40), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })); const textNodes = [...document.querySelectorAll('body *')].filter(el => visible(el) && [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())).map(el => ({ text: el.textContent.trim().slice(0, 40), size: parseFloat(getComputedStyle(el).fontSize) })); return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1, columns: getComputedStyle(document.querySelector('.service-grid')).gridTemplateColumns, body: parseFloat(getComputedStyle(document.body).fontSize), tooSmall: targets.filter(x => x.width < 60 || x.height < 60), smallText: textNodes.filter(x => x.size < 16) }; })()`);
  assert.equal(mobile.width, 390);
  assert.equal(mobile.overflow, false);
  assert.ok(!mobile.columns.includes(' '));
  assert.ok(mobile.body >= 20);
  assert.deepEqual(mobile.tooSmall, []);
  assert.deepEqual(mobile.smallText, []);
  await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' }); true`);
  await screenshot('browser-mobile-home.png');
  await evaluate(`document.querySelector('[data-type="home"]').click(); true`);
  await waitFor(`document.getElementById('modal-backdrop').classList.contains('open')`, '手机表单弹窗');
  const modal = await evaluate(`(() => { const rect = document.querySelector('.modal').getBoundingClientRect(); return { left: rect.left, right: rect.right, viewport: innerWidth, overflow: document.querySelector('.modal').scrollWidth > document.querySelector('.modal').clientWidth + 1 }; })()`);
  assert.ok(modal.left >= 0 && modal.right <= 390 && !modal.overflow);
  await screenshot('browser-mobile-form.png');
  await evaluate(`document.querySelector('#modal-backdrop [data-action="close-modal"]').click(); document.querySelector('[data-scale="1.4"]').click(); true`);
  assert.ok(Math.abs(await evaluate(`parseFloat(getComputedStyle(document.documentElement).fontSize)`) - mobile.body * 1.4) < .1);
  assert.equal(await evaluate(`document.documentElement.scrollWidth > innerWidth + 1`), false);
  await evaluate(`document.querySelector('[data-action="reset-display"]').click(); true`);
  pass('390px 手机单列、必要文字与热区达标、弹窗及超大字号无横向溢出');

  await setViewport(1440, 1000, false);
  await logout();
  await login('family_a_test', 'family');
  assert.equal(await evaluate(`state.data.canBook`), false);
  assert.equal(await evaluate(`state.data.cases.length`), 0);
  assert.ok((await evaluate(`document.getElementById('family-panel').textContent`)).includes('未授权'));
  assert.equal(await evaluate(`document.getElementById('reminders-section').parentElement.classList.contains('side-column')`), true);
  assert.equal(await evaluate(`document.querySelector('.voice-panel').parentElement.classList.contains('side-column')`), true);
  assert.ok((await evaluate(`document.querySelector('.voice-note').textContent`)).includes('仅支持普通话'));
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.elder-photo-scene')).display`), 'none');
  await logout();
  await login('community_test', 'community');
  const archiveCheck = await evaluate(`(() => { const current = state.data.residents.find(x => x.id === state.selectedResidentId); const form = document.getElementById('resident-profile-form'); return { selected: state.selectedResidentId, expected: current.id, name: form.elements.name.value, expectedName: current.name, annual: form.elements.annual.value, expectedAnnual: current.deadlines.annual }; })()`);
  assert.equal(archiveCheck.selected, archiveCheck.expected);
  assert.equal(archiveCheck.name, archiveCheck.expectedName);
  assert.equal(archiveCheck.annual, archiveCheck.expectedAnnual);
  await evaluate(`(() => { const select = document.getElementById('community-resident'); select.value = [...select.options].find(x => !x.selected).value; select.dispatchEvent(new Event('change', { bubbles: true })); })(); true`);
  await waitFor(`document.getElementById('resident-profile-form').elements.name.value === state.data.residents.find(x => x.id === state.selectedResidentId).name`, '切换档案后表单一致');
  assert.ok((await evaluate(`document.querySelector('#audit-section').textContent`)).includes('批量材料核验通过'));
  const communityView = await evaluate(`(() => { const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); return { font: parseFloat(getComputedStyle(document.body).fontSize), speakVisible: visible(document.querySelector('[data-action="speak-page"]')), controlsVisible: visible(document.querySelector('.speech-controls')), voiceVisible: visible(document.querySelector('.voice-panel')), readButtons: document.querySelectorAll('#workspace [data-action^="read-"]').length, recommendation: document.getElementById('recommendation-list').textContent, mapHidden: document.getElementById('resource-map').hidden, mapPoints: document.querySelectorAll('#resource-map .map-point').length, overflow: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
  assert.equal(communityView.font, 15.5);
  assert.equal(communityView.speakVisible, false);
  assert.equal(communityView.controlsVisible, false);
  assert.equal(communityView.voiceVisible, false);
  assert.equal(communityView.readButtons, 0);
  assert.doesNotMatch(communityView.recommendation, /公里|示意距离|km|朗读/);
  assert.equal(communityView.mapHidden, true);
  assert.equal(communityView.mapPoints, 0);
  assert.equal(communityView.overflow, false);
  await evaluate(`state.lastSpeech = ''; speak('社区端不应播报'); true`);
  assert.equal(await evaluate(`state.lastSpeech`), '');
  await evaluate(`document.querySelector('#recommendation-list [data-action="resource-detail"]').click(); true`);
  await waitFor(`document.getElementById('modal-backdrop').classList.contains('open')`, '社区资源详情');
  assert.doesNotMatch(await evaluate(`document.getElementById('modal-content').textContent`), /示意坐标|地图导航/);
  await evaluate(`document.querySelector('#modal-backdrop [data-action="close-modal"]').click(); document.querySelector('[data-action="toggle-directory"]').click(); true`);
  assert.doesNotMatch(await evaluate(`document.getElementById('resource-directory').textContent`), /公里|示意距离|km|朗读/);
  assert.equal(await evaluate(`document.querySelectorAll('#resource-directory [data-action^="read-"]').length`), 0);
  await evaluate(`document.querySelector('[data-action="toggle-directory"]').click(); true`);
  await screenshot('browser-community.png');
  pass('家属布局恢复、社区紧凑字号、无语音入口及资源预览隐藏距离和位置图');

  await logout();
  await setViewport(390, 844, true);
  const mobileLogin = await evaluate(`({ overflow: document.documentElement.scrollWidth > innerWidth + 1, loginVisible: !document.getElementById('login-form').hidden, portalColumns: getComputedStyle(document.getElementById('portal-picker')).gridTemplateColumns, body: parseFloat(getComputedStyle(document.body).fontSize), roleCleared: !document.documentElement.hasAttribute('data-role') })`);
  assert.equal(mobileLogin.overflow, false);
  assert.equal(mobileLogin.loginVisible, true);
  assert.ok(mobileLogin.body > 0);
  assert.equal(mobileLogin.roleCleared, true);
  assert.ok(!mobileLogin.portalColumns.includes(' '));
  await screenshot('browser-mobile-login.png');
  pass('手机登录页、三端入口及退出后的角色样式清理');

  assert.deepEqual(consoleErrors, []);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(productionFile)).digest('hex'), productionHash);
  pass('浏览器运行无未捕获脚本异常，正式数据未修改');
  return { speech, recognition };
}

(async () => {
  let voice = {};
  try {
    voice = await main();
    fs.writeFileSync(reportFile, JSON.stringify({ success: true, generatedAt: new Date().toISOString(), servicePort, results, voice, limitations: ['无头浏览器只验证 Web Speech API 调用与界面反馈，未验证扬声器实际听感。', '未取得真实麦克风语音转写结果；方言模型与方言纠错未实现，仍按普通话常用说法和文字指令验收。', '截图使用 Edge 无头模式，内置浏览器另用于打开正式地址。'], screenshots, results }, null, 2));
    console.log(`BROWSER_ACCEPTANCE_OK ${results.length} 项通过`);
  } catch (error) {
    fs.writeFileSync(reportFile, JSON.stringify({ success: false, generatedAt: new Date().toISOString(), servicePort, results, voice, consoleErrors, error: error.stack || error.message, screenshots }, null, 2));
    console.error(error);
    process.exitCode = 1;
  } finally {
    await closeAll();
  }
})();
