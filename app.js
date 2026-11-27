const API = '/api';
const state = {
  data: null,
  role: 'elder',
  portal: 'elder',
  theme: 'normal',
  speechRate: .9,
  lastSpeech: '',
  audio: null,
  activeType: '',
  selectedResource: '',
  selectedResidentId: '',
  filters: { elder: 'all', type: 'all', status: 'all', deadline: 'all' },
  allReminders: false,
  directory: false,
  saving: false,
  slotRequest: 0,
  returnFocus: null,
  pendingBatch: []
};
const modal = document.getElementById('modal-backdrop');
const modalContent = document.getElementById('modal-content');
const toast = document.getElementById('toast');
const appShell = document.querySelector('.app-shell');
const submitting = new WeakSet();
let toastTimer;
let recognition;

function e(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function n(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function serviceLabel(type) {
  return ({ annual: '养老资格认证', subsidy: '高龄补贴', home: '居家养老', checkup: '老年体检', welfare: '福利事项' })[type] || String(type || '服务');
}
function roleLabel(role) {
  return ({ elder: '老人端', family: '家属端', community: '社区端' })[role] || '用户';
}
function selectPortal(portal) {
  if (!['elder', 'family', 'community'].includes(portal)) return;
  state.portal = portal;
  const hints = {
    elder: '请使用老人本人账号；将校验账号是否属于老人端。',
    family: '请使用关联家属账号；可办理范围以长者授权和后端返回为准。',
    community: '请使用社区工作账号；将校验账号是否属于社区端。'
  };
  document.querySelectorAll('[data-action="select-portal"]').forEach(button => {
    const active = button.dataset.portal === portal;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const form = document.getElementById('login-form');
  form.elements.portal.value = portal;
  document.getElementById('login-title').textContent = `${roleLabel(portal)}登录`;
  document.getElementById('portal-hint').textContent = hints[portal];
  document.getElementById('login-submit').textContent = `登录${roleLabel(portal)}`;
}
function selected(value, current) {
  return String(value) === String(current) ? 'selected' : '';
}
function checked(value) {
  return value ? 'checked' : '';
}
function statusClass(status) {
  if (['已完成', '发放完成'].includes(status)) return 'done';
  if (status === '已退回') return 'returned';
  if (status === '待社区审核') return 'pending';
  return 'active';
}
function formatAt(value) {
  if (!value) return '时间未记录';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}
function addDays(iso, amount) {
  const date = new Date(String(iso) + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function safeImage(value) {
  return typeof value === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';
}
function phoneHref(value) {
  return String(value || '').replace(/[^0-9+]/g, '');
}
function storeGet(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function storeSet(key, value) {
  try { localStorage.setItem(key, String(value)); } catch {}
}
function notify(message, error = false) {
  toast.textContent = String(message || '操作未完成');
  toast.classList.toggle('error', error);
  toast.setAttribute('role', error ? 'alert' : 'status');
  toast.setAttribute('aria-live', error ? 'assertive' : 'polite');
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), error ? 5200 : 3200);
}
async function request(path, options = {}) {
  const response = await fetch(API + path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
  let result;
  try { result = await response.json(); } catch { throw new Error('本机服务返回格式不正确'); }
  if (!response.ok) throw Object.assign(new Error(result.error || '请求失败'), { status: response.status });
  return result;
}
function stateRequestPath(params = {}) {
  const query = new URLSearchParams(params);
  if (state.role === 'community' && state.selectedResidentId) query.set('elderId', state.selectedResidentId);
  const text = query.toString();
  return '/state' + (text ? '?' + text : '');
}
function currentResident() {
  const residents = state.data?.residents || [];
  let resident = residents.find(item => item.id === state.selectedResidentId);
  if (!resident && residents.length) {
    resident = residents[0];
    state.selectedResidentId = resident.id;
  }
  return resident || null;
}
function activeResources() {
  return (state.data?.resources || []).filter(resource => resource.enabled === true);
}
function findCase(id) {
  return (state.data?.cases || []).find(item => item.id === id);
}
function findResource(id) {
  return (state.data?.resources || []).find(item => item.id === id);
}
function resourceDistance(resource) {
  return Number.isFinite(resource.distance) ? resource.distance : Math.hypot(n(resource.x), n(resource.y));
}
function integrationText(key) {
  const item = state.data?.integrations?.[key] || { configured: false, mode: 'local-demo' };
  return item.configured ? '已配置但未验证' : '本地演示，未配置外部服务';
}
function integrationMode(key) {
  return state.data?.integrations?.[key]?.mode || 'local-demo';
}
function setFont(scale) {
  const value = [1, 1.2, 1.4].includes(scale) ? scale : 1;
  document.documentElement.style.setProperty('--font-scale', value);
  document.querySelectorAll('[data-action="font"]').forEach(button => {
    const active = n(button.dataset.scale) === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  storeSet('warm-neighbor-font-scale', value);
}
function setTheme(theme) {
  state.theme = ['normal', 'night', 'contrast'].includes(theme) ? theme : 'normal';
  document.body.dataset.theme = state.theme;
  document.querySelectorAll('[data-action="theme"]').forEach(button => {
    const active = button.dataset.themeValue === state.theme;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  storeSet('warm-neighbor-theme', state.theme);
}
function setSpeechRate(value) {
  state.speechRate = [.7, .9, 1.15].includes(value) ? value : .9;
  document.getElementById('speech-rate').value = String(state.speechRate);
  storeSet('warm-neighbor-speech-rate', state.speechRate);
}
function resetDisplay() {
  setFont(1);
  setTheme('normal');
  setSpeechRate(.9);
  notify(state.role === 'community' ? '字号和配色已恢复标准设置' : '字号、配色和语速已恢复标准设置');
}
let speechSeq = 0;
const ttsBlobCache = new Map();
let ttsFallbackNotified = false;
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA=';
let sharedAudio = null;
let audioUnlocked = false;
function audioElement() {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
    sharedAudio.setAttribute('playsinline', '');
  }
  return sharedAudio;
}
function unlockAudio() {
  const audio = audioElement();
  if (audioUnlocked) return;
  audioUnlocked = true;
  audio.muted = true;
  audio.src = SILENT_WAV;
  audio.play().then(() => {
    if (state.audio === audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
    audio.removeAttribute('src');
  }).catch(() => { audio.muted = false; audio.removeAttribute('src'); });
}
function stopAudio() {
  speechSeq += 1;
  if (state.audio) {
    try { state.audio.pause(); } catch {}
    if (state.audio.objectUrl) URL.revokeObjectURL(state.audio.objectUrl);
    state.audio = null;
  }
  window.speechSynthesis?.cancel();
}
function browserSpeak(content) {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    notify('语音朗读暂不可用，请阅读页面文字', true);
    return;
  }
  const utterance = new SpeechSynthesisUtterance(content);
  utterance.lang = 'zh-CN';
  utterance.rate = state.speechRate;
  utterance.onerror = event => { if (event.error !== 'canceled' && event.error !== 'interrupted') notify('语音朗读未完成，请阅读页面文字', true); };
  window.speechSynthesis.speak(utterance);
}
function playTtsBlob(blob, content, seq) {
  if (seq !== speechSeq) return;
  const audio = audioElement();
  const objectUrl = URL.createObjectURL(blob);
  audio.pause();
  audio.muted = false;
  audio.volume = 1;
  audio.src = objectUrl;
  audio.objectUrl = objectUrl;
  state.audio = audio;
  document.documentElement.dataset.tts = 'voice-1';
  audio.onended = () => { URL.revokeObjectURL(objectUrl); if (state.audio === audio) state.audio = null; };
  audio.onerror = () => { URL.revokeObjectURL(objectUrl); if (state.audio === audio) state.audio = null; browserSpeak(content); };
  const played = audio.play();
  if (played?.catch) played.catch(error => {
    if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') {
      notify('请再点一次“朗读本页”开始播放语音', true);
      return;
    }
    browserSpeak(content);
  });
}
async function speak(text) {
  if (state.role === 'community') { stopAudio(); return; }
  const content = String(text || '').trim();
  if (!content) { notify('当前没有可朗读的内容'); return; }
  state.lastSpeech = content;
  stopAudio();
  unlockAudio();
  const seq = speechSeq;
  const cacheKey = state.speechRate + '|' + content;
  const cached = ttsBlobCache.get(cacheKey);
  if (cached) { playTtsBlob(cached, content, seq); return; }
  const loadingTimer = setTimeout(() => notify('正在准备语音，请稍候…'), 500);
  try {
    const response = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: content, speed: state.speechRate }) });
    if (!response.ok) throw new Error('tts-unavailable');
    const blob = await response.blob();
    if (seq !== speechSeq) return;
    ttsBlobCache.set(cacheKey, blob);
    if (ttsBlobCache.size > 24) ttsBlobCache.delete(ttsBlobCache.keys().next().value);
    playTtsBlob(blob, content, seq);
  } catch {
    if (seq !== speechSeq) return;
    document.documentElement.dataset.tts = 'fallback';
    if (!ttsFallbackNotified) { ttsFallbackNotified = true; notify('语音服务未连接，已改用系统语音', true); }
    browserSpeak(content);
  } finally {
    clearTimeout(loadingTimer);
  }
}
function eligibilitySpeech() {
  const eligibility = state.data?.eligibility;
  const policies = state.data?.policies;
  if (eligibility) {
    return `高龄补贴本地演示初审依据：${(eligibility.basis || []).join('，')}。当前年龄${eligibility.age ?? '未知'}岁，本地户籍${eligibility.local ? '是' : '否'}，演示初审${eligibility.passed ? '符合' : '不符合'}本地示例条件。${eligibility.notice || policies?.ruleNotice || ''}`;
  }
  if (policies) return `本地演示补贴规则为年满${policies.subsidy?.minAge ?? 80}岁，户籍要求为${policies.subsidy?.localRequired ? '本地户籍' : '不限户籍'}。${policies.ruleNotice || ''}`;
  return '当前账号没有可查看的资格依据。';
}
function progressSpeech() {
  const cases = state.data?.cases || [];
  if (!cases.length) return '当前没有可查看的办理记录。';
  return cases.slice(0, 4).map(item => {
    const latest = item.history?.at(-1);
    const returned = item.status === '已退回' && latest?.note ? `，退回原因：${latest.note}` : '';
    const report = item.report ? `，报告摘要：${item.report}` : '';
    return `${item.name || state.data.residentName || '长者'}的${serviceLabel(item.type)}，项目${item.option || ''}，状态${item.status}${returned}${report}`;
  }).join('。');
}
function pageSummary() {
  const data = state.data;
  if (!data) return '请先登录。';
  const reminders = data.reminders.slice(0, 3).map(item => `${item.residentName || data.residentName || ''}${serviceLabel(item.type)}${item.text}`).join('。');
  if (state.role === 'community') {
    const stats = data.stats || {};
    return `社区运营工作台。共有档案${stats.residentCount ?? 0}份，工单${stats.processingVolume?.total ?? 0}条，办结率${stats.completionRate ?? 0}%，已处置预警${stats.resolvedAlertCount ?? 0}条。当前提醒：${reminders || '暂无'}。${progressSpeech()}`;
  }
  return `当前提醒：${reminders || '暂无提醒'}。`;
}
function showAccount(data) {
  state.data = data;
  state.role = data.role;
  state.portal = data.role;
  document.documentElement.dataset.role = state.role;
  if (state.role === 'community') currentResident();
  document.getElementById('skip-link').href = '#main-content';
  document.getElementById('access-screen').hidden = true;
  appShell.hidden = false;
  render();
}
async function showAccess() {
  closeModal(false);
  clearTimeout(toastTimer);
  toast.classList.remove('show');
  toast.textContent = '';
  state.data = null;
  state.lastSpeech = '';
  state.activeType = '';
  state.selectedResource = '';
  state.selectedResidentId = '';
  state.filters = { elder: 'all', type: 'all', status: 'all', deadline: 'all' };
  state.allReminders = false;
  state.directory = false;
  state.pendingBatch = [];
  state.slotRequest += 1;
  stopAudio();
  delete document.documentElement.dataset.role;
  appShell.hidden = true;
  document.getElementById('skip-link').href = '#access-screen';
  document.getElementById('access-screen').hidden = false;
  document.getElementById('login-form').hidden = true;
  document.getElementById('setup-form').hidden = true;
  document.getElementById('portal-picker').hidden = true;
  document.getElementById('access-hint').textContent = '正在检查初始化状态。';
  try {
    const result = await request('/setup');
    document.getElementById('setup-form').hidden = !result.required;
    document.getElementById('login-form').hidden = result.required;
    document.getElementById('portal-picker').hidden = result.required;
    selectPortal(state.portal);
    document.getElementById('access-hint').textContent = result.required ? '首次启动，请使用终端中的初始化码创建社区账号。初始化仅创建社区端账号。' : '请选择登录端，再输入对应账号和密码。角色不匹配时不会进入应用。';
  } catch (error) {
    document.getElementById('access-hint').textContent = '连接本机服务失败，请启动 node server.js 后刷新。';
    notify(error.message, true);
  }
}
function openModal(html, focusSelector = '') {
  if (!modal.classList.contains('open')) state.returnFocus = document.activeElement;
  modalContent.innerHTML = html;
  appShell.inert = true;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    const preferred = focusSelector ? modal.querySelector(focusSelector) : null;
    const first = preferred || modal.querySelector('input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled)');
    (first || modal.querySelector('.modal-close'))?.focus();
  });
}
function closeModal(restore = true) {
  if (!modal.classList.contains('open')) return;
  state.slotRequest += 1;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  appShell.inert = false;
  if (restore) {
    const target = state.returnFocus?.isConnected ? state.returnFocus : document.querySelector('[data-action="home"]');
    target?.focus();
  }
}
function modalFrame(title, body, kicker = '暖邻服务') {
  return `<span class="section-kicker">${e(kicker)}</span><h2 id="modal-title">${e(title)}</h2>${body}`;
}
function focusTrap(event) {
  if (event.key === 'Escape' && modal.classList.contains('open')) {
    event.preventDefault();
    closeModal();
    return;
  }
  if (event.key !== 'Tab' || !modal.classList.contains('open')) return;
  const items = [...modal.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])')].filter(item => item.getClientRects().length);
  if (!items.length) return;
  const first = items[0];
  const last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
function serviceIntro(type) {
  return ({
    annual: '请核对当前档案并选择社区人工核验或家属提交材料。外部实名、短信和人脸能力不替代社区审核。',
    subsidy: '请查看按出生日期和户籍计算的本地演示初审依据。材料由您手工核对，OCR不会伪装识别。',
    home: '请选择七类居家服务之一、日期时段、可用资源和特殊需求。下架资源不能预约。',
    checkup: '请选择免费、普惠或慢病体检项目。系统优先推荐低峰时段，具体准备事项以社区告知为准。'
  })[type] || '请核对表单。';
}
function annualIntegrationHtml() {
  return `<div class="integration-box"><strong>外部认证能力说明</strong><ul><li>外部实名：${e(integrationText('identity'))}，状态 ${e(integrationMode('identity'))}</li><li>短信：${e(integrationText('sms'))}，状态 ${e(integrationMode('sms'))}</li><li>人脸：${e(integrationText('face'))}，状态 ${e(integrationMode('face'))}</li></ul><span>当前只提交本地演示申请，不声称完成真实实名、短信或人脸认证。</span></div>`;
}
function currentArchiveHtml(type) {
  const data = state.data;
  const profile = data.profile;
  let html = `<div class="policy-box"><strong>当前档案</strong><p>称呼：${e(data.residentName || '未提供')} · 社区：${e(data.residentDistrict || profile?.district || '未提供')}</p>`;
  if (profile) {
    html += `<p>出生日期：${e(data.birthDate || '未登记')}${data.birthDateEstimated ? '（估算日期）' : ''} · 年龄：${e(profile.age)} · 居住：${e(profile.living)} · 自理：${e(profile.mobility)}</p><p>户籍：${profile.local ? '本地' : '非本地'} · 慢病关注：${profile.chronic ? '有' : '无'}</p>`;
  } else if (state.role === 'family') {
    html += '<p>家属仅看到后端允许的信息；未获查看授权时不显示完整画像。</p>';
  }
  if (type === 'subsidy') html += eligibilityHtml();
  html += '</div>';
  return html;
}
function eligibilityHtml() {
  const item = state.data?.eligibility;
  if (!item) return '<p>当前账号未获资格依据查看权限，社区将按后端规则审核。</p>';
  return `<div class="policy-box"><strong>高龄补贴本地演示初审</strong><p>结果：${item.passed ? '符合本地示例初审条件' : '暂不符合本地示例初审条件'} · 年龄 ${e(item.age ?? '未知')} 岁 · ${item.local ? '本地户籍' : '非本地户籍'}</p><p>出生日期：${e(item.birthDate || '未登记')}${item.birthDateEstimated ? '（估算日期）' : ''}</p><ul>${(item.basis || []).map(value => `<li>${e(value)}</li>`).join('')}</ul><p>${e(item.notice || '')}</p><button class="small-button" type="button" data-action="read-eligibility">朗读政策与资格依据</button></div>`;
}
function needsMaterial(type, option) {
  return type === 'subsidy' || type === 'annual' && option === '家属提交材料';
}
function materialUploadHtml(type, option) {
  const visible = needsMaterial(type, option);
  return `<div id="material-section" class="integration-box" ${visible ? '' : 'hidden'}><strong>材料上传、压缩与手工核对</strong><p>OCR：${e(integrationText('ocr'))}，状态 ${e(integrationMode('ocr'))}。${state.data.integrations?.ocr?.configured ? '即使已有配置也未验证，本页不会自动识别或伪造识别结果。' : 'OCR 未配置，请手工核对材料，本页不会显示虚假识别结果。'}</p><div class="form-grid"><label>拍照上传<input id="form-camera" type="file" accept="image/*" capture="environment"></label><label>从相册选图<input id="form-file" type="file" accept="image/*"></label></div><p id="file-status" aria-live="polite">图片提交前会压缩为 JPEG；请确保图片仅为演示材料。</p><label class="check-row"><input name="materialChecked" type="checkbox" ${visible ? 'required' : ''}>我已手工核对所填信息和所选材料，不依赖 OCR</label></div>`;
}
function updateMaterialFields() {
  const section = document.getElementById('material-section');
  if (!section) return;
  const visible = needsMaterial(state.activeType, document.getElementById('form-option')?.value || '');
  section.hidden = !visible;
  const checkbox = section.querySelector('[name="materialChecked"]');
  if (checkbox) {
    checkbox.required = visible;
    if (!visible) checkbox.checked = false;
  }
  if (!visible) {
    section.querySelectorAll('input[type="file"]').forEach(input => { input.value = ''; });
    const status = document.getElementById('file-status');
    if (status) status.textContent = '当前办理方式不需要上传图片。';
  }
}
function serviceFormHtml(type, option, resourceId, draft) {
  const options = state.data.services[type].slice(1);
  const needsSchedule = ['home', 'checkup'].includes(type);
  const intro = serviceIntro(type);
  const draftText = draft?.text ? `<div class="notice" id="voice-confirmation"><strong>语音识别仅用于辅助填写，尚未提交</strong><p>识别原文：${e(draft.text)}</p><p>请核对称呼、业务、项目、日期时段、资源和需求。存在歧义的内容不会自动选择，必须手工明确。必须勾选确认并点击提交按钮。</p></div>` : '';
  let specific = '';
  if (type === 'annual') specific = annualIntegrationHtml();
  if (type === 'annual' || type === 'subsidy') specific += materialUploadHtml(type, option);
  const advice = type === 'checkup' ? '<div class="policy-box" id="option-advice" aria-live="polite"></div>' : '';
  const resource = needsSchedule ? `<label class="full-field">${type === 'home' ? '服务资源与容量' : '体检资源（可选；选择后按该资源容量计算余量）'}<select id="form-resource" ${type === 'home' ? 'required' : ''}></select><small id="resource-capacity"></small></label>` : '';
  const schedule = needsSchedule ? `<label>预约日期<input id="form-date" type="date" min="${e(state.data.today)}" value="${e(draft?.date || state.data.tomorrow)}" required></label><label>时间段<select id="form-time" required></select><small id="slot-advice" aria-live="polite">正在读取容量和低峰时段</small></label>` : '';
  const note = type === 'home' ? `<label class="full-field">特殊需求<textarea id="form-note" maxlength="160" placeholder="例如行动不便，需要提前电话联系">${e(draft?.note || '')}</textarea></label>` : '';
  return modalFrame(state.data.services[type][0], `<p id="form-intro">${e(intro)}</p><button class="small-button" type="button" data-action="read-form">朗读表单提示与当前选择</button>${currentArchiveHtml(type)}${specific}${draftText}<form id="service-form"><div class="form-grid"><label>长者称呼<input id="form-name" maxlength="40" value="${e(draft?.name || state.data.residentName || '')}" required></label><label>办理项目<select id="form-option">${options.map(value => `<option value="${e(value)}" ${selected(value, option)}>${e(value)}</option>`).join('')}</select></label>${schedule}${resource}${note}</div>${advice}<label class="check-row"><input id="form-confirm" type="checkbox" required>我已逐项核对以上信息，明确确认提交本次申请</label><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button type="submit" class="primary-button">确认并提交</button></div></form>`, '服务办理');
}
function openService(type, option = '', resourceId = '', draft = null) {
  const data = state.data;
  if (!data?.canBook) { notify('当前身份未获办理权限，请由长者开启家属代办授权', true); return false; }
  if (!data.services[type]) { notify('该提醒没有可在线办理的业务表单', true); return false; }
  const options = data.services[type].slice(1);
  const kind = options.includes(option) ? option : type === 'checkup' && data.profile?.chronic && !option ? '慢病随访体检' : options[0];
  state.activeType = type;
  state.selectedResource = resourceId || '';
  openModal(serviceFormHtml(type, kind, resourceId, draft), '#form-option');
  if (draft && ['home', 'checkup'].includes(type)) {
    const slotElement = document.getElementById('form-time');
    slotElement.dataset.requireExplicit = 'true';
    if (draft.slot) slotElement.dataset.voiceSlot = draft.slot;
  }
  updateServiceFields(false);
  if (!draft) speak(introForOpen(type));
  return true;
}
function introForOpen(type) {
  return `${serviceIntro(type)} 请逐项核对，勾选明确确认后点击提交。`;
}
function updateServiceFields(resetSlot = true) {
  const type = state.activeType;
  const optionElement = document.getElementById('form-option');
  if (!optionElement) return;
  const option = optionElement.value;
  const resourceSelect = document.getElementById('form-resource');
  if (resourceSelect) {
    const resources = activeResources().filter(resource => {
      if (type === 'home') return resource.kind === option;
      return resource.kind === option || (resource.projects || []).includes(option) || ['checkup', '体检'].includes(resource.category);
    });
    const previous = state.selectedResource || resourceSelect.value;
    resourceSelect.innerHTML = `${type === 'checkup' ? '<option value="">由社区安排，不指定资源</option>' : '<option value="">请选择可用资源</option>'}${resources.map(resource => `<option value="${e(resource.id)}" ${selected(resource.id, previous)}> ${e(resource.name)} · 每时段容量 ${e(resource.capacity)}</option>`).join('')}`;
    if (type === 'home' && !resources.some(resource => resource.id === resourceSelect.value)) resourceSelect.value = '';
    state.selectedResource = resourceSelect.value;
    const selectedResource = findResource(resourceSelect.value);
    document.getElementById('resource-capacity').textContent = resources.length ? selectedResource ? `${selectedResource.name}，每时段容量 ${selectedResource.capacity}，当前启用可预约。地址：${selectedResource.address || '社区补充'}` : type === 'home' ? '请选择资源后查看对应时段余量。' : '可由社区统一安排，也可选择已启用资源。' : '该项目当前没有启用资源，请改选其他项目或联系社区。';
  }
  if (type === 'checkup') {
    const advice = state.data.checkupAdvice?.[option] || (option.includes('慢病') ? '慢病项目建议携带既往慢病随访资料，具体项目以社区安排为准。' : option === '免费老年体检' ? '免费老年体检为本地演示预约，具体资格与项目以社区告知为准。' : option === '普惠老年体检' ? '普惠项目的费用与内容以社区和资源详情为准。' : '请按社区通知做好体检前准备。');
    document.getElementById('option-advice').textContent = advice;
  }
  if (resetSlot) delete document.getElementById('form-time')?.dataset.chosen;
  updateSlots();
}
async function updateSlots() {
  const type = state.activeType;
  const dateElement = document.getElementById('form-date');
  const slotElement = document.getElementById('form-time');
  if (!['home', 'checkup'].includes(type) || !dateElement || !slotElement) return;
  const date = dateElement.value;
  const resourceId = document.getElementById('form-resource')?.value || '';
  const requested = slotElement.value;
  const token = ++state.slotRequest;
  try {
    const result = await request(stateRequestPath({ date }));
    if (token !== state.slotRequest || type !== state.activeType || dateElement.value !== date || !slotElement.isConnected) return;
    const resource = findResource(resourceId);
    const capacity = resource ? n(resource.capacity, 0) : type === 'checkup' ? n(result.policies?.capacities?.checkup, 0) : 0;
    const counts = new Map();
    for (const entry of result.slots || []) {
      const count = resourceId ? n(type === 'checkup' ? entry.checkupResourceBooked?.[resourceId] : entry.resourceBooked?.[resourceId]) : type === 'checkup' ? n(entry.booked) : 0;
      counts.set(entry.slot, count);
    }
    const availableCounts = (result.slots || []).filter(entry => {
      const past = Date.parse(date + 'T' + entry.slot + ':00+08:00') <= Date.now();
      return !past && n(capacity) > counts.get(entry.slot);
    });
    const low = availableCounts.length ? Math.min(...availableCounts.map(entry => counts.get(entry.slot))) : null;
    const requireExplicit = slotElement.dataset.requireExplicit === 'true';
    slotElement.innerHTML = `${requireExplicit ? '<option value="" disabled>请选择明确时段</option>' : ''}${(result.slots || []).map(entry => {
      const count = counts.get(entry.slot) || 0;
      const past = Date.parse(date + 'T' + entry.slot + ':00+08:00') <= Date.now();
      const noResource = type === 'home' && !resource;
      const full = count >= capacity;
      const disabled = past || full || noResource;
      const remaining = Math.max(0, capacity - count);
      const reason = past ? '已开始' : noResource ? '先选资源' : full ? '已约满' : `剩余 ${remaining} 个名额`;
      const lowText = type === 'checkup' && !disabled && count === low ? ' · 低峰推荐' : '';
      return `<option value="${e(entry.slot)}" ${disabled ? 'disabled' : ''}>${e(entry.slot)} · ${e(reason + lowText)}</option>`;
    }).join('')}`;
    const voiceDesired = slotElement.dataset.voiceSlot || '';
    const desired = voiceDesired || (slotElement.dataset.chosen === 'true' ? requested : '');
    const available = [...slotElement.options].filter(item => item.value && !item.disabled);
    const voiceEntry = (result.slots || []).find(entry => entry.slot === voiceDesired);
    const voicePast = voiceEntry ? Date.parse(date + 'T' + voiceEntry.slot + ':00+08:00') <= Date.now() : false;
    const waitingForResource = Boolean(voiceDesired && type === 'home' && !resource && voiceEntry && !voicePast);
    let slotMessage = '';
    if (waitingForResource) {
      slotElement.value = '';
      slotElement.dataset.chosen = 'false';
      slotMessage = `已识别时段 ${voiceDesired}，请先选择服务资源再核对余量；系统未改选其他时段。`;
    } else if (desired && available.some(item => item.value === desired)) {
      slotElement.value = desired;
      slotElement.dataset.chosen = 'true';
      delete slotElement.dataset.voiceSlot;
      delete slotElement.dataset.requireExplicit;
    } else {
      if (voiceDesired) {
        delete slotElement.dataset.voiceSlot;
        slotElement.dataset.chosen = 'false';
        slotElement.dataset.requireExplicit = 'true';
        slotMessage = `识别时段 ${voiceDesired} 不存在或当前不可约，未替您改填，请手动选择可用时段。`;
        setVoiceResult(`${slotMessage} 其他已识别内容保留在表单中，仍需您核对并明确确认后提交。`);
        notify(slotMessage, true);
      }
      if (slotElement.dataset.requireExplicit === 'true') {
        slotElement.value = '';
        slotElement.dataset.chosen = 'false';
        if (!slotMessage) slotMessage = '请手动明确选择时段；仅说上午或下午不会自动选择。';
      } else {
        if (type === 'checkup') available.sort((a, b) => (counts.get(a.value) || 0) - (counts.get(b.value) || 0));
        slotElement.value = available[0]?.value || '';
      }
    }
    document.getElementById('slot-advice').textContent = slotMessage || (available.length ? type === 'checkup' ? `${resource ? `按所选资源 ${resource.name} 的容量 ${capacity} 计算余量；` : '未指定资源时按社区统一容量计算；'}已优先选择预约量较低的低峰时段，可手动改选。` : `按资源容量显示余量，当前选择 ${slotElement.value || '无'}。` : '该日没有可预约时段，请更换日期或资源。');
  } catch (error) {
    if (token === state.slotRequest) notify(error.message, true);
  }
}
function formSpeechText() {
    const type = state.activeType;
    const option = document.getElementById('form-option')?.value || '';
    const name = document.getElementById('form-name')?.value || '';
    const date = document.getElementById('form-date')?.value || '';
    const slot = document.getElementById('form-time')?.value || '';
    const resource = findResource(document.getElementById('form-resource')?.value)?.name || '';
    const note = document.getElementById('form-note')?.value || '';
    return `${serviceIntro(type)} 当前称呼${name}，项目${option}${date ? `，日期${date}，时段${slot || '未选择'}` : ''}${resource ? `，资源${resource}` : ''}${note ? `，特殊需求${note}` : ''}。${type === 'subsidy' ? eligibilitySpeech() : ''} 请核对后勾选明确确认，再点击提交。`;
}
async function fileImage(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('无法读取所选图片'));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}
async function encodeAttachment(file) {
  if (!file || !file.size) return '';
  if (!file.type.startsWith('image/')) throw new Error('仅接受图片材料');
  const image = await fileImage(file);
  const width = image.width;
  const height = image.height;
  const scale = Math.min(1, 1200 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法压缩图片，请换用其他图片');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close?.();
  let quality = .78;
  let result = canvas.toDataURL('image/jpeg', quality);
  while (result.length > 960000 && quality > .42) {
    quality -= .1;
    result = canvas.toDataURL('image/jpeg', quality);
  }
  if (result.length > 990000) throw new Error('图片压缩后仍过大，请选择更小的图片');
  return result;
}
async function performAction(body, success = '操作已保存') {
  if (state.saving) return false;
  state.saving = true;
  const community = state.role === 'community';
  const elderId = state.selectedResidentId;
  try {
    let data = await request('/action', { method: 'POST', body: JSON.stringify(body) });
    if (community) {
      const query = elderId ? '?elderId=' + encodeURIComponent(elderId) : '';
      try { data = await request('/state' + query); }
      catch (error) {
        state.data = data;
        state.selectedResidentId = elderId;
        currentResident();
        render();
        notify(`操作已保存，但按当前长者刷新失败：${error.message}`, true);
        return true;
      }
    }
    state.data = data;
    if (community) {
      state.selectedResidentId = elderId;
      currentResident();
    }
    render();
    notify(success);
    return true;
  } catch (error) {
    notify(error.message, true);
    if (error.status === 401) await showAccess();
    return false;
  } finally { state.saving = false; }
}
async function submitLocked(form, task) {
  if (submitting.has(form) || state.saving) return;
  submitting.add(form);
  const buttons = [...form.querySelectorAll('button[type="submit"], button:not([type])')];
  buttons.forEach(button => { button.disabled = true; });
  form.setAttribute('aria-busy', 'true');
  try { await task(); }
  catch (error) { notify(error.message, true); }
  finally {
    submitting.delete(form);
    form.removeAttribute('aria-busy');
    if (form.isConnected) buttons.forEach(button => { button.disabled = false; });
  }
}
function arrangeRoleLayout() {
  const mainColumn = document.querySelector('.main-column');
  const sideColumn = document.querySelector('.side-column');
  const workspace = document.getElementById('workspace');
  const reminders = document.getElementById('reminders-section');
  const family = document.getElementById('family-panel');
  if (state.role === 'elder') {
    if (reminders.parentElement !== mainColumn) mainColumn.insertBefore(reminders, workspace);
  } else if (reminders.parentElement !== sideColumn || family.parentElement !== sideColumn) {
    sideColumn.append(reminders, family);
  }
}
function render() {
  const data = state.data;
  if (!data) return;
  const elder = state.role === 'elder';
  const community = state.role === 'community';
  const speakPage = document.querySelector('[data-action="speak-page"]');
  speakPage.hidden = community;
  speakPage.textContent = elder ? '朗读本页' : '朗读本页摘要';
  document.querySelector('.speech-controls').hidden = community;
  document.querySelector('.demo-banner').textContent = community ? '业务数据保存在本机；社区端外部能力以状态说明为准' : '业务数据保存在本机；语音朗读由本机语音服务提供';
  if (community) stopAudio();
  document.querySelector('.brand-subtitle').textContent = elder ? `${data.residentName || '长者'} · 长辈版` : state.role === 'family' ? `${data.residentName || '长者'}的家属` : '社区运营工作台';
  document.getElementById('greeting').textContent = community ? '社区运营工作台' : state.role === 'family' ? `您好，${data.residentName || '长者'}的家属` : `您好，${data.residentName || '长者'}`;
  document.getElementById('hero-description').textContent = elder ? '想办哪件事？点下面的大按钮，就能开始。' : state.role === 'family' ? '仅在长者授权范围内代办、上传材料、查看进度、评价和接收同步提醒。' : '筛选和审核工单，维护档案、资源、探访、期限、预警与统计。';
  document.getElementById('footer-service').textContent = data.hotline ? `社区服务热线 ${data.hotline} · 服务时间由社区配置` : '社区服务热线待社区配置 · 服务时间由社区配置';
  arrangeRoleLayout();
  renderServiceHome();
  renderReminders();
  renderFamilyPanel();
  renderWorkspace();
  if (community) document.querySelectorAll('#workspace [data-action^="read-"]').forEach(button => button.remove());
  renderResources();
}
function renderServiceHome() {
  const container = document.getElementById('service-home');
  if (state.role === 'community') { container.innerHTML = ''; return; }
  const elder = state.role === 'elder';
  const cards = elder ? [
    ['annual', '证', '养老资格认证', '办理认证或年审', 'green'],
    ['subsidy', '补', '高龄补贴', '申请补贴或办理年审', 'orange'],
    ['home', '家', '居家养老', '预约送餐、保洁、陪护', 'blue'],
    ['checkup', '检', '体检预约', '选择体检项目和时间', 'purple'],
    ['progress', '查', '办理进度', '看看办到哪一步', 'teal'],
    ['reminders', '醒', '重要提醒', '看看快到期的事', 'rose']
  ] : [
    ['annual', '证', '养老资格认证', '查看档案并提交年审核验', 'green'],
    ['subsidy', '补', '高龄补贴', '查看演示初审依据并上传材料', 'orange'],
    ['home', '家', '居家养老', '七类服务、资源容量与时段', 'blue'],
    ['checkup', '检', '体检预约', '免费、普惠、慢病项目与低峰', 'purple'],
    ['progress', '查', '办理进度', '状态、历史、评分和报告', 'teal'],
    ['reminders', '醒', '重要提醒', '期限、逾期与服务同步提醒', 'rose']
  ];
  container.innerHTML = `<div class="section-heading"><div><span class="section-kicker">高频服务</span><h2>${elder ? '今天要办什么？' : '家属代办与查看'}</h2></div></div><div class="service-grid">${cards.map(([type, icon, title, description, color]) => {
    const disabled = !state.data.canBook && !['progress', 'reminders'].includes(type);
    return `<button class="service-card service-card-${color}" data-action="open-entry" data-type="${type}" ${disabled ? 'disabled' : ''}><span class="service-icon" aria-hidden="true">${icon}</span><span class="service-title">${title}</span><span class="service-description">${description}${disabled ? ' · 未获代办授权' : ''}</span></button>`;
  }).join('')}</div>`;
}
function renderReminders() {
  const items = state.data.reminders || [];
  document.getElementById('reminder-count').textContent = String(items.length);
  const shown = state.allReminders ? items : items.slice(0, 4);
  document.getElementById('reminder-list').innerHTML = shown.length ? shown.map(item => `<button class="reminder-item" data-action="reminder" data-id="${e(item.id)}"><span class="reminder-icon" aria-hidden="true">${item.type === 'subsidy' ? '￥' : '!'}</span><span><strong>${state.role === 'community' ? e(item.residentName || '长者') + ' · ' : ''}${e(serviceLabel(item.type))} · ${e(item.level)}</strong><small>${e(item.due || '')} · ${e(item.text)}</small></span></button>`).join('') : '<p class="empty-state">暂无临期、逾期或服务超时提醒。</p>';
  const toggle = document.querySelector('[data-action="show-reminders"]');
  toggle.hidden = items.length <= 4;
  toggle.textContent = state.allReminders ? '收起提醒' : '查看全部提醒';
  toggle.setAttribute('aria-expanded', String(state.allReminders));
}
function renderFamilyPanel() {
  const data = state.data;
  const panel = document.getElementById('family-panel');
  if (state.role === 'community') {
    const resident = currentResident();
    panel.innerHTML = `<span class="section-kicker">家属账号</span><h2>${e(resident?.name || '未选择长者')}</h2><p>${resident?.accounts?.some(item => item.role === 'family') ? '该档案已有家属账号，授权由长者本人设置。' : '该档案尚未开通家属账号。'}</p><button class="secondary-button" data-action="jump-admin" data-target="archives-section">管理档案与账号</button>`;
    return;
  }
  if (state.role === 'family') {
    panel.innerHTML = `<div class="family-avatar" aria-hidden="true">家</div><span class="section-kicker">家人守护</span><h2>授权范围</h2><p>进度查看（view）：${data.family.view ? '已授权' : '未授权'} · 代办（proxy）：${data.family.proxy ? '已授权' : '未授权'} · 健康报告（health）：${data.family.health ? '已单独授权' : '未单独授权'}</p><p>view 决定进度与关怀查看范围，proxy 决定代办、材料上传及本人代办工单评价范围，health 单独决定体检报告与健康细节范围；后端按各项权限返回信息。</p>${data.family.phone ? `<p>家属联系电话：${e(data.family.phone)}</p>` : ''}`;
    return;
  }
  panel.innerHTML = `<div class="family-avatar" aria-hidden="true">家</div><span class="section-kicker">家人守护</span><h2>${data.linkedFamily ? '家属账号已关联' : '家属账号未关联'}</h2><p>${data.linkedFamily ? `进度查看 ${data.family.view ? '开' : '关'} · 代办 ${data.family.proxy ? '开' : '关'} · 健康报告 ${data.family.health ? '开' : '关'}` : '请先由社区开通关联家属账号，再分别设置查看、代办和健康授权。'}</p><div class="family-actions">${data.family.phone ? `<a class="secondary-button" href="tel:${e(phoneHref(data.family.phone))}" aria-label="拨打家属联系电话 ${e(data.family.phone)}">家属联系电话</a>` : ''}<button class="secondary-button" data-action="family-auth" ${data.linkedFamily ? '' : 'disabled'}>设置或撤销授权</button></div>`;
}
function recommendationReason(resource) {
  const community = state.role === 'community';
  if (!community && resource.reason) return resource.reason;
  const needs = state.data.profile?.needs || currentResident()?.profile?.needs || [];
  const reasons = community ? [] : [`示意距离 ${resourceDistance(resource).toFixed(1)} 公里`];
  if (needs.includes(resource.kind) || (resource.projects || []).some(project => needs.includes(project))) reasons.push('符合当前档案中的服务需求');
  if (resource.fee === 0) reasons.push('示例免费资源');
  if (!reasons.length) reasons.push('社区启用资源');
  return reasons.join(' · ');
}
function resourceCard(resource, recommended = false) {
  const community = state.role === 'community';
  const elder = state.role === 'elder';
  const reason = recommendationReason(resource);
  const tag = elder ? (recommended ? '推荐服务' : '可预约服务') : `${recommended ? '推荐资源' : '启用资源'}${community ? '' : ` · 示意 ${resourceDistance(resource).toFixed(1)}km`}`;
  return `<article class="resource-card" ${elder ? `data-action="resource-detail" data-id="${e(resource.id)}"` : ''}><div class="resource-visual" aria-hidden="true">${e(String(resource.category || resource.kind || '养').slice(0, 1))}</div><div class="resource-content"><span class="tag">${e(tag)}</span><h3>${e(resource.name)}</h3><p>${e(resource.category || resource.kind)} · ${e((resource.projects || [resource.kind]).join('、'))}</p><p>${resource.fee === 0 ? '示例免费' : `演示费用 ¥${e(resource.fee)} 起`} · 每时段容量 ${e(resource.capacity)} · ${resource.enabled ? '可预约' : '已下架'}</p>${recommended ? `<p><strong>推荐理由：</strong>${e(reason)}</p>` : ''}<p>电话：${e(resource.phone || '未配置')} · 地址：${e(resource.address || '地址由社区补充')}</p><div class="resource-actions"><button class="small-button" data-action="resource-detail" data-id="${e(resource.id)}">查看详情</button>${recommended && !community ? `<button class="small-button" data-action="read-reason" data-id="${e(resource.id)}">朗读推荐理由</button>` : ''}${resource.phone ? `<a class="small-button" href="tel:${e(phoneHref(resource.phone))}">拨号</a>` : ''}${resource.enabled && state.data.canBook ? `<button class="primary-button" data-action="book-resource" data-id="${e(resource.id)}">预约</button>` : ''}</div></div></article>`;
}
function recommendedResources() {
  const needs = state.data.profile?.needs || currentResident()?.profile?.needs || [];
  return activeResources().map((resource, index) => {
    const matched = needs.includes(resource.kind) || (resource.projects || []).some(project => needs.includes(project));
    return { resource, index, matched, free: resource.fee === 0, distance: resourceDistance(resource) };
  }).sort((a, b) => {
    if (Number.isFinite(a.resource.score) && Number.isFinite(b.resource.score) && a.resource.score !== b.resource.score) return b.resource.score - a.resource.score;
    return Number(b.matched) - Number(a.matched) || Number(b.free) - Number(a.free) || a.distance - b.distance || a.index - b.index;
  }).slice(0, 3).map(entry => entry.resource);
}
function renderResources() {
  const resources = activeResources();
  const recommended = recommendedResources();
  const elder = state.role === 'elder';
  const community = state.role === 'community';
  document.getElementById('resource-kicker').textContent = elder ? '' : community ? '社区资源预览' : '为您推荐';
  document.getElementById('resource-heading').textContent = elder ? '为您推荐的服务' : community ? '居民端推荐资源（仅启用，最多 3 条）' : '最推荐的 3 条养老资源';
  document.getElementById('resource-logic').textContent = elder ? '' : community ? '居民推荐结果由服务端按当前档案计算；此处仅展示启用资源、服务匹配和示例免费条件。' : '推荐由服务端按当前档案计算：优先 3 公里内可用资源，并结合距离、护理需求、高龄独居和本地演示免费补贴资格排序；前端优先采用该评分。推荐、目录和预约入口均不显示已下架资源，坐标仅为示意。';
  document.getElementById('recommendation-list').innerHTML = recommended.length ? recommended.map(resource => resourceCard(resource, true)).join('') : '<p class="empty-state">当前没有启用资源。下架后推荐、目录和预约选项会同步消失。</p>';
  const map = document.getElementById('resource-map');
  map.hidden = community || elder;
  map.innerHTML = community || elder ? '' : `<span class="map-label">最多 3 条推荐资源相对位置示意 · 不用于导航 · 非真实地理位置</span><span class="map-center" style="left:50%;top:54%">社区</span>${recommended.map(resource => {
    const x = Math.max(7, Math.min(93, 50 + n(resource.x) * 11));
    const y = Math.max(16, Math.min(88, 54 - n(resource.y) * 10));
    return `<span class="map-point" style="left:${x}%;top:${y}%" title="${e(resource.name)}">${e(String(resource.kind || '养').slice(0, 1))}</span>`;
  }).join('')}`;
  const directory = document.getElementById('resource-directory');
  directory.hidden = !state.directory;
  const directoryDescription = elder ? '这里列出全部可预约服务。点击服务卡可查看详情。' : community ? '此目录只显示启用资源；下架资源仅在社区管理区显示。类别、项目、演示费用、电话、地址、容量和可用状态均来自本机数据。' : '此目录只显示启用资源；下架资源仅在社区管理区显示。类别、项目、演示费用、电话、地址、容量和可用状态均来自本机数据，坐标仅为示意。';
  directory.innerHTML = state.directory ? `<h3 class="directory-heading">完整资源目录 · 全部 ${e(resources.length)} 条启用资源</h3><p>${directoryDescription}</p><div class="resource-directory-list">${resources.length ? resources.map(resource => resourceCard(resource)).join('') : '<p class="empty-state">暂无启用资源</p>'}</div>` : '';
  const toggle = document.querySelector('[data-action="toggle-directory"]');
  toggle.textContent = state.directory ? '收起完整目录' : elder ? '查看全部服务' : '查看完整目录';
  toggle.setAttribute('aria-expanded', String(state.directory));
}
function openResource(id) {
  const resource = findResource(id);
  if (!resource) { notify('资源不存在或已更新', true); return; }
  const navigation = state.data.navigation || {};
  const navigationText = navigation.configured ? `地图能力为 ${navigation.mode || 'configured-not-verified'}，本页仍未验证导航地址，不生成导航链接。` : '未配置地图导航，仅展示明确标记的示意坐标，不生成虚假导航。';
  const locationDetails = ['community', 'elder'].includes(state.role) ? '' : `<p><strong>示意坐标：</strong>X ${e(resource.x)}，Y ${e(resource.y)}（coordinatesDemo）</p><p>${e(navigationText)}</p>`;
  const body = `<div class="policy-box"><p><strong>类别：</strong>${e(resource.category || resource.kind)}</p><p><strong>项目：</strong>${e((resource.projects || [resource.kind]).join('、'))}</p><p><strong>演示费用：</strong>${resource.fee === 0 ? '免费' : `¥${e(resource.fee)} 起`}</p><p><strong>电话：</strong>${e(resource.phone || '未配置')}</p><p><strong>地址：</strong>${e(resource.address || '未配置')}</p><p><strong>容量：</strong>每时段 ${e(resource.capacity)} 个名额</p><p><strong>状态：</strong>${resource.enabled ? '启用，可预约' : '已下架，不可预约'}</p>${locationDetails}</div><div class="modal-actions">${resource.phone ? `<a class="secondary-button" href="tel:${e(phoneHref(resource.phone))}">拨打服务点电话</a>` : ''}${resource.enabled && state.data.canBook ? `<button class="primary-button" data-action="book-resource" data-id="${e(resource.id)}">预约该资源</button>` : ''}${state.role === 'community' ? `<button class="secondary-button" data-action="edit-resource" data-id="${e(resource.id)}">编辑资源</button>` : ''}</div>`;
  openModal(modalFrame(resource.name, body, '资源详情'));
}
function bookResource(id) {
  const resource = findResource(id);
  if (!resource?.enabled) { notify('该资源已下架，不能预约', true); return; }
  const homeKinds = state.data.services.home.slice(1);
  const checkupKinds = state.data.services.checkup.slice(1);
  if (homeKinds.includes(resource.kind)) openService('home', resource.kind, resource.id);
  else {
    const option = checkupKinds.includes(resource.kind) ? resource.kind : checkupKinds.find(kind => (resource.projects || []).includes(kind)) || checkupKinds[0];
    openService('checkup', option, resource.id);
  }
}
function visitsHtml(visits) {
  if (!visits?.length) return '<p class="empty-state">暂无可查看的探访或关怀记录。</p>';
  return `<div class="case-list">${visits.map(visit => `<article class="case-card"><h3>${e(visit.type || '探访')} · ${e(visit.date || '')}</h3><p>${e(visit.note)}</p><p class="case-meta">经办人 ${e(visit.by || '未记录')} · 记录时间 ${e(formatAt(visit.at))}</p></article>`).join('')}</div>`;
}
function reportHistoryHtml(item) {
  if (!item.reportHistory?.length) return '';
  return `<details><summary>报告修改历史（${e(item.reportHistory.length)}）</summary><ol class="history-list">${item.reportHistory.map(entry => `<li><strong>${e(entry.report || '')}</strong><br>来源 ${e(entry.source || '未记录')} · 经办人 ${e(entry.by || '未记录')} · ${e(formatAt(entry.at))}${entry.legacy ? ' · 旧记录' : ''}</li>`).join('')}</ol></details>`;
}
function caseCard(item, admin = false) {
  const returned = item.status === '已退回' ? [...(item.history || [])].reverse().find(entry => entry.status === '已退回' && entry.note)?.note : '';
  const canRate = item.type === 'home' && item.status === '已完成' && !admin && (state.role === 'elder' || state.role === 'family' && state.data.family.proxy && item.by === 'family');
  const returnedHistory = (item.history || []).filter(entry => entry.status === '已退回');
  const returnedHistoryHtml = returnedHistory.length ? `<details class="returned-history"><summary>退回历史（${e(returnedHistory.length)}）</summary><ol class="history-list">${returnedHistory.map(entry => `<li><strong>${e(entry.note || '未填写退回原因')}</strong><br>经办 ${e(entry.by || '未记录')} · ${e(formatAt(entry.at))}</li>`).join('')}</ol><button class="small-button" type="button" data-action="read-return" data-id="${e(item.id)}">朗读最近退回原因</button></details>` : '';
  const image = safeImage(item.evidence);
  const attachment = safeImage(item.attachment);
  return `<article class="case-card ${admin ? 'admin-case' : ''}" data-case-id="${e(item.id)}"><div class="case-top"><h3>${e(item.name || state.data.residentName || '长者')} · ${e(serviceLabel(item.type))}</h3><span class="status-chip ${statusClass(item.status)}">${e(item.status)}</span></div><p><strong>${e(item.option || item.project || '')}</strong></p><p class="case-meta">${item.date ? `预约 ${e(item.date)} ${e(item.slot || '')} · ` : ''}提交 ${e(formatAt(item.createdAt))} · 最近更新 ${e(formatAt(item.updatedAt))}</p>${item.resourceName || item.resource ? `<p>资源：${e(item.resourceName || item.resource)}${['home', 'checkup'].includes(item.type) ? ` · ${item.resourceAvailable === false ? '资源已下架或不可用，未办结前请先改派资源' : '资源可用'}` : ''}</p>` : ''}${item.note ? `<p>需求说明：${e(item.note)}</p>` : ''}${item.advice ? `<p>体检建议：${e(item.advice)}</p>` : ''}${item.eligibility ? `<div class="policy-box"><strong>提交时的本地演示资格依据</strong><p>${e((item.eligibility.basis || []).join('；'))} · ${item.eligibility.passed ? '示例初审符合' : '示例初审不符合'}</p><p>${e(item.eligibility.notice || '')}</p></div>` : ''}${returned ? `<div class="notice warning-box"><strong>退回原因：</strong>${e(returned)}</div>` : ''}${returnedHistoryHtml}${item.serviceResult ? `<div class="policy-box"><strong>服务完成说明</strong><p>${e(item.serviceResult.note)}</p><p>来源 ${e(item.serviceResult.source || '社区手工录入（演示）')} · 经办 ${e(item.serviceResult.by || '')} · ${e(formatAt(item.serviceResult.at))}</p></div>` : ''}${item.report ? `<div class="policy-box"><strong>健康报告摘要</strong><p>${e(item.report)}</p><p>来源 ${e(item.reportSource || '未记录')} · 经办 ${e(item.reportBy || '未记录')} · ${e(formatAt(item.reportAt))}</p></div>` : ''}${state.role === 'family' && item.type === 'checkup' && !state.data.family.health ? '<p class="notice">健康报告需长者单独授权；未授权时不显示报告内容和体检项目细节。其他类型工单不显示此健康提示。</p>' : ''}${attachment ? `<p><a class="small-button" href="${e(attachment)}" target="_blank" rel="noopener">查看允许的图片材料</a></p>` : ''}${image ? `<img class="evidence" src="${e(image)}" alt="社区上传的服务留痕照片">` : ''}${item.rating ? `<p>服务评分：${e(item.rating)} 分 · ${e(formatAt(item.ratedAt))}</p>` : ''}${canRate ? `<label class="stack-label">我的服务评分<select data-rating="${e(item.id)}"><option value="">请选择评分</option>${[1, 2, 3, 4, 5].map(score => `<option value="${score}" ${selected(score, item.rating)}>${score} 分</option>`).join('')}</select></label>` : ''}<div class="case-actions"><button class="small-button" data-action="read-case" data-id="${e(item.id)}">朗读进度与审核结果</button>${returned ? `<button class="small-button" data-action="read-return" data-id="${e(item.id)}">朗读退回原因</button>` : ''}${item.eligibility ? `<button class="small-button" data-action="read-case-eligibility" data-id="${e(item.id)}">朗读资格依据</button>` : ''}${item.report ? `<button class="small-button" data-action="read-report" data-id="${e(item.id)}">朗读报告</button>` : ''}</div>${item.history?.length ? `<details><summary>办理历史（${e(item.history.length)}）</summary><ol class="history-list">${item.history.map(step => `<li><strong>${e(step.status)}</strong>${step.note ? ` · ${e(step.note)}` : ''}<br>经办 ${e(step.by || '系统')} · ${e(formatAt(step.at))}</li>`).join('')}</ol></details>` : ''}${reportHistoryHtml(item)}</article>`;
}
function profileFields(resident, includeDeadlines) {
  const profile = resident.profile || {};
  const deadlines = resident.deadlines || { annual: '', subsidy: '', checkup: '', welfare: {} };
  const homeNeeds = state.data.services.home.slice(1);
  return `<div class="form-grid"><label>长者称呼<input name="name" maxlength="40" value="${e(resident.name || '')}" required></label><label>出生日期<input name="birthDate" type="date" max="${e(state.data.today)}" value="${e(resident.birthDate || '')}"><small>无准确日期时可清空并填写年龄，保存后标记估算</small></label><label class="check-row"><input name="birthDateEstimated" type="checkbox" ${checked(resident.birthDateEstimated)}>该出生日期为估算日期</label><label>年龄（出生日期为空时用于估算）<input name="age" type="number" min="60" max="130" value="${e(profile.age ?? 80)}" required></label><label>所在社区<input name="district" maxlength="30" value="${e(profile.district || resident.district || '示例社区')}" required></label><label>户籍<select name="local"><option value="true" ${selected(true, profile.local)}>本地户籍</option><option value="false" ${selected(false, profile.local)}>非本地户籍</option></select></label><label>居住情况<select name="living">${['独居', '空巢', '与家人同住'].map(value => `<option value="${value}" ${selected(value, profile.living)}>${value}</option>`).join('')}</select></label><label>自理情况<select name="mobility">${['自理', '行动不便', '失能'].map(value => `<option value="${value}" ${selected(value, profile.mobility)}>${value}</option>`).join('')}</select></label><label class="check-row full-field"><input name="chronic" type="checkbox" ${checked(profile.chronic)}>有慢性病关注</label><fieldset class="needs-options"><legend>服务需求（整行可选）</legend>${homeNeeds.map(value => `<label class="check-row"><input name="needs" type="checkbox" value="${e(value)}" ${checked((profile.needs || []).includes(value))}>${e(value)}</label>`).join('')}</fieldset></div>${includeDeadlines ? `<h3>业务期限</h3><div class="form-grid"><label>资格认证期限<input name="annual" type="date" value="${e(deadlines.annual || '')}"></label><label>高龄补贴期限<input name="subsidy" type="date" value="${e(deadlines.subsidy || '')}"></label><label>体检期限<input name="checkup" type="date" value="${e(deadlines.checkup || '')}"></label></div><h4>其他福利期限</h4>${Object.entries(deadlines.welfare || {}).map(([key, value]) => `<div class="welfare-row" data-welfare-key="${e(key)}"><label>福利名称<input value="${e(key)}" readonly></label><label>期限<input type="date" value="${e(value || '')}"></label></div>`).join('')}<div class="welfare-row"><label>新增福利名称<input name="welfareName" maxlength="40" placeholder="可留空"></label><label>新增福利期限<input name="welfareDate" type="date"></label></div>` : ''}`;
}
function elderProfileHtml() {
  const data = state.data;
  const resident = { name: data.residentName, birthDate: data.birthDate, birthDateEstimated: data.birthDateEstimated, profile: data.profile };
  return `<details class="workspace-card"><summary>我的画像与资格档案</summary><p>出生日期、社区、户籍、居住、自理、慢病和服务需求保存到本机，刷新后仍保留。</p><form id="profile-form">${profileFields(resident, false)}<button class="primary-button" type="submit">保存我的画像</button></form></details>`;
}
function renderPersonalWorkspace() {
  const data = state.data;
  const title = state.role === 'family' ? '授权范围内的进度、评价与探访关怀' : '我的办理进度与结果';
  const cases = data.cases || [];
  document.getElementById('workspace').innerHTML = `${state.role === 'elder' ? elderProfileHtml() : ''}<section class="workspace-card" id="progress-section"><div class="workspace-heading"><div><span class="section-kicker">真实后端记录</span><h2>${title}</h2></div><span class="demo-label">共 ${e(cases.length)} 条</span></div>${state.role === 'family' ? '<p class="notice">家属只能看到后端按查看、代办和健康授权返回的信息。撤销授权后，下次刷新会立即收缩可见范围。</p>' : ''}<div class="case-list">${cases.length ? cases.map(item => caseCard(item)).join('') : '<p class="empty-state">暂无可见办理记录。</p>'}</div></section><section class="workspace-card"><div class="workspace-heading"><div><span class="section-kicker">社区关怀</span><h2>探访与关怀记录</h2></div></div>${visitsHtml(data.visits)}</section>${integrationPanelHtml()}${policyPanelHtml()}`;
}
function policyPanelHtml() {
  const policies = state.data.policies || {};
  return `<details class="workspace-card"><summary>本地演示政策与容量依据</summary><div class="policy-box"><p>高龄补贴：年满 ${e(policies.subsidy?.minAge ?? 80)} 岁，${policies.subsidy?.localRequired ? '须为本地户籍' : '不限户籍'}。</p><p>资格认证周期：${e(policies.eligibility?.cycleDays ?? 365)} 天；居家按所选资源容量计算；体检未指定资源时社区默认每时段容量 ${e(policies.capacities?.checkup ?? 2)}，指定资源后按该资源 capacity 计算。</p><p>${e(policies.ruleNotice || '')}</p><button class="small-button" data-action="read-eligibility">朗读政策与当前资格依据</button></div></details>`;
}
function integrationPanelHtml() {
  const labels = { identity: '外部实名', sms: '短信', face: '人脸', ocr: 'OCR 文字识别', payment: '支付', health: '健康数据', map: '地图导航', push: '消息推送' };
  return `<details class="workspace-card"><summary>外部能力状态集中说明</summary><p>仅展示 local-demo 或 configured-not-verified，配置不等于验证通过。</p><ul class="integration-list">${Object.entries(labels).map(([key, label]) => `<li><strong>${e(label)}</strong><br>${e(integrationText(key))}<span class="mode-code">${e(integrationMode(key))}</span></li>`).join('')}</ul></details>`;
}
function adminCaseDue(item) {
  const resident = (state.data.residents || []).find(entry => entry.id === item.elderId);
  if (item.type === 'welfare') return resident?.deadlines?.welfare?.[item.option] || '';
  return resident?.deadlines?.[item.type] || '';
}
function adminFilteredCases() {
  const filters = state.filters;
  const timeoutIds = new Set((state.data.reminders || []).filter(item => item.level === '服务超时').map(item => item.caseId || item.id));
  return (state.data.cases || []).filter(item => {
    if (filters.elder !== 'all' && item.elderId !== filters.elder) return false;
    if (filters.type !== 'all' && item.type !== filters.type) return false;
    if (filters.status !== 'all' && item.status !== filters.status) return false;
    if (filters.deadline === 'all') return true;
    if (filters.deadline === 'timeout') return timeoutIds.has(item.id);
    const due = adminCaseDue(item);
    if (!due) return false;
    const days = Math.round((Date.parse(due + 'T00:00:00Z') - Date.parse(state.data.today + 'T00:00:00Z')) / 86400000);
    return filters.deadline === 'overdue' ? days < 0 : days >= 0 && days <= 7;
  });
}
function resourceBlocked(item) {
  return ['home', 'checkup'].includes(item.type) && item.resourceAvailable === false && item.status !== '已完成';
}
function canAdvance(item) {
  if (resourceBlocked(item)) return false;
  const flows = { annual: ['待社区审核', '审核通过', '已完成'], subsidy: ['待社区审核', '审核通过', '补贴发放中', '发放完成'], home: ['待社区审核', '已确认', '已完成'], checkup: ['待社区审核', '已确认', '已完成'] };
  const flow = flows[item.type] || [];
  const index = flow.indexOf(item.status);
  if (index < 0 || index >= flow.length - 1) return false;
  return !(item.type === 'home' && item.status === '已确认');
}
function adminCaseRow(item) {
  const reportAction = item.type === 'checkup' && item.status === '已完成' ? `<button class="small-button" data-action="open-result" data-id="${e(item.id)}">${item.report ? '确认修改报告' : '录入报告'}</button>` : '';
  const homeResult = item.type === 'home' && (item.status === '已确认' && !resourceBlocked(item) || item.status === '已完成' && !item.serviceResult) ? `<button class="primary-button" data-action="open-result" data-id="${e(item.id)}">${item.status === '已完成' ? '旧工单补录结果' : '填写完成说明并办结'}</button>` : '';
  const reassignAction = resourceBlocked(item) ? `<button class="primary-button" data-action="open-reassign" data-id="${e(item.id)}">改派资源后继续办理</button>` : '';
  const blockedNotice = resourceBlocked(item) ? '<p class="notice warning-box">原资源已下架或不可用，本工单不能审核推进或办结；请先改派启用资源。旧已完成工单的结果补录不受此限制。</p>' : '';
  return `<div class="admin-case-wrap"><label class="case-choice check-row"><input class="batch-select case-select" type="checkbox" data-id="${e(item.id)}" ${canAdvance(item) ? '' : 'disabled'}><span>选择此工单批量推进${canAdvance(item) ? '' : resourceBlocked(item) ? '（资源不可用，请先改派）' : '（当前状态不可批量推进）'}</span></label>${caseCard(item, true)}${blockedNotice}<div class="admin-actions">${canAdvance(item) ? `<button class="primary-button" data-action="review-next" data-id="${e(item.id)}">${item.status === '待社区审核' ? '单笔通过' : '推进到下一状态'}</button>` : ''}${item.status === '待社区审核' ? `<button class="danger-button" data-action="review-reject" data-id="${e(item.id)}">退回并填写原因</button>` : ''}${reassignAction}${homeResult}${reportAction}</div></div>`;
}
function statsHtml() {
  const stats = state.data.stats || {};
  const rows = object => Object.entries(object || {}).map(([key, value]) => `<div class="stat-row"><span>${e(serviceLabel(key) === key ? key : serviceLabel(key))}</span><strong>${e(value)}</strong></div>`).join('');
  const byType = Object.entries(stats.processingVolume?.byType || {}).map(([type, value]) => `<div class="stat-row"><span>${e(serviceLabel(type))}</span><strong>办理 ${e(value.total)} · 办结 ${e(value.completed)}</strong></div>`).join('');
  return `<div class="stats-grid"><div class="stat-card"><h3>年龄结构</h3>${rows(stats.ageStructure)}</div><div class="stat-card"><h3>服务需求</h3>${rows(stats.serviceNeeds)}</div><div class="stat-card"><h3>补贴状态</h3>${rows(stats.subsidyStatus) || '<p>暂无补贴工单</p>'}</div><div class="stat-card"><h3>办理量与办结率</h3><div class="stat-row"><span>档案数</span><strong>${e(stats.residentCount ?? 0)}</strong></div><div class="stat-row"><span>总办理量</span><strong>${e(stats.processingVolume?.total ?? 0)}</strong></div><div class="stat-row"><span>总办结量</span><strong>${e(stats.processingVolume?.completed ?? 0)}</strong></div><div class="stat-row"><span>办结率</span><strong>${e(stats.completionRate ?? 0)}%</strong></div>${byType}</div><div class="stat-card"><h3>全部工单状态</h3>${rows(stats.byStatus)}</div><div class="stat-card"><h3>预警处理</h3><div class="stat-row"><span>已处置预警</span><strong>${e(stats.resolvedAlertCount ?? 0)}</strong></div><p>数据全部来自 data.stats。</p></div></div>`;
}
function archiveAdminHtml() {
  const resident = currentResident();
  if (!resident) return '<p class="empty-state">请先新增长者档案。</p>';
  return `<h3>选中档案：${e(resident.name)}</h3><p>下方画像、期限、账号和探访均使用当前选中档案 ${e(resident.name)}，日期保持一致。</p><form id="resident-profile-form">${profileFields(resident, true)}<button class="primary-button" type="submit">保存完整画像与期限</button></form><h3>家属授权状态</h3><p>进度查看 ${resident.family?.view ? '允许' : '未授权'} · 代办 ${resident.family?.proxy ? '允许' : '未授权'} · 健康报告 ${resident.family?.health ? '单独允许' : '未授权'} · 家属联系电话 ${e(resident.family?.phone || '未填写')}</p><p>授权变更历史 ${e((resident.familyHistory || []).length)} 条，权限由长者本人设置或撤销。</p><h3>该档案账号</h3><ul class="account-list">${(resident.accounts || []).map(account => `<li><span>${account.role === 'elder' ? '老人' : '家属'}账号：${e(account.role === 'elder' ? resident.name : resident.name + '的家属')}</span><button class="small-button" type="button" data-action="reset-password" data-username="${e(account.username)}">重置密码</button></li>`).join('') || '<li>尚无登录账号</li>'}</ul><form id="account-form" class="form-grid"><label>开通身份<select name="role"><option value="elder">老人账号</option><option value="family">家属账号</option></select></label><label>登录账号<input name="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_\-]{3,32}" autocomplete="off"></label><label>初始密码<input name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password"></label><p>为 ${e(resident.name)} 开通账号。密码仅提交本机后端，不在页面显示。</p><button class="primary-button" type="submit">开通选中档案账号</button></form><details><summary>新增其他长者档案</summary><form id="new-resident-form">${profileFields({ name: '', birthDate: '', birthDateEstimated: false, profile: { age: 80, district: '示例社区', local: true, living: '与家人同住', mobility: '自理', chronic: false, needs: [] }, deadlines: { annual: '', subsidy: '', checkup: '', welfare: {} } }, true)}<button class="primary-button" type="submit">新增档案</button></form></details>`;
}
function resourceAdminHtml() {
  const resources = state.data.resources || [];
  return `<p>资源管理区显示全部资源（含已下架）；上方居民推荐和完整目录只显示启用资源。下架后不可新预约，受影响进行中工单须先改派。</p><button class="primary-button" data-action="edit-resource" data-id="">新增服务资源</button><div class="case-list">${resources.map(resource => `<article class="case-card"><div class="case-top"><h3>${e(resource.name)}</h3><span class="status-chip ${resource.enabled ? 'done' : 'returned'}">${resource.enabled ? '启用' : '已下架'}</span></div><p>${e(resource.category)} · ${e((resource.projects || []).join('、'))} · 容量 ${e(resource.capacity)} · ${resource.fee === 0 ? '示例免费' : `¥${e(resource.fee)}`}</p><p>${e(resource.address || '未填地址')} · ${e(resource.phone || '未填电话')}</p><p>示意坐标 X ${e(resource.x)}，Y ${e(resource.y)} · 不用于导航</p><div class="case-actions"><button class="small-button" data-action="resource-detail" data-id="${e(resource.id)}">详情</button><button class="small-button" data-action="edit-resource" data-id="${e(resource.id)}">编辑</button><button class="${resource.enabled ? 'danger-button' : 'primary-button'}" data-action="toggle-resource" data-id="${e(resource.id)}" data-enabled="${resource.enabled}">${resource.enabled ? '下架资源' : '重新上架'}</button></div></article>`).join('') || '<p class="empty-state">暂无资源</p>'}</div>${affectedHtml()}`;
}
function affectedHtml() {
  const affected = state.data.affectedAppointments || [];
  if (!affected.length) return '<p class="empty-state">暂无因资源下架受影响的进行中预约。</p>';
  return `<div class="affected-box warning-box"><h3>受影响居家与体检预约（${e(affected.length)}）</h3><p>下列预约的原资源已下架或不可用，不能继续推进；改派启用资源后再按原状态办理。</p><div class="case-list">${affected.map(item => `<article class="case-card"><p><strong>${e(item.residentName || item.name || '长者')} · ${e(serviceLabel(item.type))}</strong></p><p>${e(item.option)} · ${e(item.date)} ${e(item.slot)} · ${e(item.status)}</p><p>原资源：${e(item.resourceName || item.resourceId || '未记录')}</p>${['home', 'checkup'].includes(item.type) ? `<button class="primary-button" type="button" data-action="open-reassign" data-id="${e(item.id)}">改派资源</button>` : ''}</article>`).join('')}</div></div>`;
}
function visitAdminHtml() {
  const resident = currentResident();
  if (!resident) return '<p class="empty-state">请先选择档案。</p>';
  const visits = (state.data.visits || []).filter(item => item.elderId === resident.id);
  return `<h3>为 ${e(resident.name)} 新增探访或关怀</h3><form id="visit-form" class="form-grid"><label>记录类型<select name="type"><option value="探访">探访</option><option value="关怀">关怀</option></select></label><label>服务日期<input name="date" type="date" value="${e(state.data.today)}" required></label><label class="full-field">记录说明<textarea name="note" maxlength="500" required></textarea></label><button class="primary-button" type="submit">保存记录</button></form><p>记录自动保存经办账号、类型和 at 时间。</p>${visitsHtml(visits)}`;
}
function alertsAdminHtml() {
  const reminders = state.data.reminders || [];
  const history = state.data.resolutionHistory || [];
  return `<div class="case-list">${reminders.map(item => `<article class="case-card"><h3>${e(item.residentName || '长者')} · ${e(serviceLabel(item.type))} · ${e(item.level)}</h3><p>${e(item.due)} · ${e(item.text)}</p>${item.level === '服务超时' ? `<button class="primary-button" data-action="open-resolve" data-id="${e(item.id)}">填写说明并处置</button>` : '<p>期限提醒由业务办结或期限管理更新，不在此核销。</p>'}</article>`).join('') || '<p class="empty-state">暂无未处置提醒。</p>'}</div><h3>预警处置历史</h3>${history.length ? `<ol class="history-list">${history.map(item => `<li><strong>${e(item.note || '旧记录未留说明')}</strong><br>预警 ${e(item.id)} · 经办人 ${e(item.by || '旧记录未留')} · 时间 ${e(formatAt(item.at))}</li>`).join('')}</ol>` : '<p class="empty-state">暂无处置历史。</p>'}`;
}
function renderAdminWorkspace() {
  const data = state.data;
  const resident = currentResident();
  const residents = data.residents || [];
  const filtered = adminFilteredCases();
  const statuses = ['待社区审核', '审核通过', '补贴发放中', '已确认', '已完成', '发放完成', '已退回'];
  const residentOptions = residents.map(item => `<option value="${e(item.id)}" ${selected(item.id, state.selectedResidentId)}>${e(item.name)} · ${e(item.profile?.district || item.district || '')}</option>`).join('');
  document.getElementById('workspace').innerHTML = `<section class="workspace-card"><div class="workspace-heading"><div><span class="section-kicker">社区工作台</span><h2>档案、工单与服务全流程</h2></div><span class="demo-label">选中 ${e(resident?.name || '无档案')}</span></div><label class="stack-label">当前操作的长者档案<select id="community-resident">${residentOptions}</select></label><details class="admin-section" open><summary>工单审核与批量推进（当前 ${e(filtered.length)} 条）</summary><div class="inline-form filter-bar" aria-label="工单筛选"><label>长者<select data-filter="elder"><option value="all">全部长者</option>${residents.map(item => `<option value="${e(item.id)}" ${selected(item.id, state.filters.elder)}>${e(item.name)}</option>`).join('')}</select></label><label>类型<select data-filter="type"><option value="all">全部类型</option>${Object.keys(data.services).map(type => `<option value="${e(type)}" ${selected(type, state.filters.type)}>${e(serviceLabel(type))}</option>`).join('')}</select></label><label>状态<select data-filter="status"><option value="all">全部 expected 状态</option>${statuses.map(status => `<option value="${e(status)}" ${selected(status, state.filters.status)}>${e(status)}</option>`).join('')}</select></label><label>期限<select data-filter="deadline"><option value="all" ${selected('all', state.filters.deadline)}>全部期限</option><option value="upcoming" ${selected('upcoming', state.filters.deadline)}>临期 7 天</option><option value="overdue" ${selected('overdue', state.filters.deadline)}>已逾期</option><option value="timeout" ${selected('timeout', state.filters.deadline)}>服务超时</option></select></label></div><div class="button-row"><label class="check-row"><input id="select-all-cases" type="checkbox">全选当前可推进工单</label><button class="primary-button" data-action="batch-review">批量推进并二次确认</button></div><div class="case-list">${filtered.length ? filtered.map(adminCaseRow).join('') : '<p class="empty-state">当前筛选条件下没有工单。</p>'}</div></details><details class="admin-section" id="archives-section"><summary>档案、完整画像、账号与期限管理</summary>${archiveAdminHtml()}</details><details class="admin-section"><summary>资源管理与受影响预约</summary>${resourceAdminHtml()}</details><details class="admin-section"><summary>探访与关怀管理</summary>${visitAdminHtml()}</details><details class="admin-section"><summary>临期、逾期、超时预警与处置历史</summary>${alertsAdminHtml()}</details><details class="admin-section"><summary>社区统计</summary>${statsHtml()}</details><details class="admin-section"><summary>社区热线</summary><form id="hotline-form" class="inline-form"><label>社区服务热线<input name="hotline" inputmode="tel" value="${e(data.hotline || '')}" placeholder="留空则不启用拨号"></label><button class="primary-button" type="submit">保存热线</button></form></details></section>${integrationPanelHtml()}${policyPanelHtml()}`;
}
function auditAdminHtml() {
  const items = state.data.auditLog || [];
  const text = value => typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value || '未记录');
  return `<details class="workspace-card audit-section" id="audit-section"><summary>审计台账（${e(items.length)} 条）</summary><p>动作、对象、经办、时间和说明均来自 data.auditLog。</p>${items.length ? `<ol class="history-list audit-list">${items.map(item => { const object = item.object || item.target || [item.targetType, item.targetId].filter(Boolean).join(' ') || item.id; const note = item.note || item.detail || item.details || item.description; return `<li><strong>动作：${e(text(item.action))}</strong><br>对象：${e(text(object))} · 经办：${e(text(item.by || item.actor || item.operator))}<br>时间：${e(formatAt(item.at || item.time))}<br>说明：${e(text(note))}</li>`; }).join('')}</ol>` : '<p class="empty-state">暂无审计记录。</p>'}</details>`;
}
function renderWorkspace() {
  if (state.role === 'community') {
    renderAdminWorkspace();
    document.getElementById('workspace').insertAdjacentHTML('beforeend', auditAdminHtml());
  } else renderPersonalWorkspace();
}
function openChangePassword() {
  const body = `<p>当前登录：${e(roleLabel(state.role))} · ${e(state.data.role === 'community' ? '社区管理员' : state.data.role === 'family' ? (state.data.residentName || '长者') + '的家属' : (state.data.residentName || '长者'))}</p><form id="password-form"><label class="stack-label">原密码<input name="oldPassword" type="password" autocomplete="current-password" required maxlength="128"></label><label class="stack-label">新密码<input name="newPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></label><p class="notice">修改成功后将退出到登录页，请使用新密码重新登录。</p><div class="modal-actions"><button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="submit">确认修改密码</button></div></form>`;
  openModal(modalFrame('账号安全 · 修改密码', body, '账号安全'), '[name="oldPassword"]');
}
function openResetPassword(username) {
  if (state.role !== 'community') return;
  const account = currentResident()?.accounts?.find(item => item.username === username);
  if (!account) { notify('账号不存在或档案已更新', true); return; }
  const body = `<p>为 ${e(currentResident().name)} 的${account.role === 'elder' ? '老人' : '家属'}账号重置密码。</p><form id="reset-password-form"><label class="stack-label">登录账号<input name="username" value="${e(username)}" readonly required></label><label class="stack-label">新密码<input name="newPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></label><p class="notice">重置成功后，请通知账号使用人持新密码重新登录。</p><div class="modal-actions"><button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="submit">确认重置密码</button></div></form>`;
  openModal(modalFrame('重置账号密码', body, '社区账号管理'), '[name="newPassword"]');
}
function showFamilyAuth() {
  const data = state.data;
  if (state.role !== 'elder' || !data.linkedFamily) { notify('请先由社区开通家属账号', true); return; }
  const history = data.familyHistory || [];
  const descriptions = { view: '允许家属查看申请、服务进度和探访关怀', proxy: '允许家属代办业务和上传材料', health: '单独允许家属查看体检报告与健康细节' };
  const body = `<p>查看（view）控制进度与探访关怀范围；代办（proxy）控制业务代办、材料上传及本人代办居家工单评价；健康（health）单独控制体检报告和健康细节。各项授权按各自范围生效，保存后由后端重新返回可见信息。</p><form id="consent-form"><label>关联家属账号<input name="username" value="${e(data.familyUsername || '')}" readonly required></label>${['view', 'proxy', 'health'].map(key => `<div class="policy-box"><label class="check-row"><input name="${key}" type="checkbox" ${checked(data.family[key])}>${e(descriptions[key])}</label><button class="danger-button" type="button" data-action="revoke-permission" data-key="${key}" ${data.family[key] ? '' : 'disabled'}>单独撤销${key === 'view' ? '查看' : key === 'proxy' ? '代办' : '健康报告'}授权</button></div>`).join('')}<label>家属联系电话<input name="phone" inputmode="tel" value="${e(data.family.phone || '')}" placeholder="留空则不启用拨号"></label><p class="notice">健康报告必须单独授权；撤销查看或健康授权后，家属只能看到后端仍允许的信息。</p><div class="modal-actions"><button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="submit">保存三项授权</button></div></form><h3>授权历史</h3>${history.length ? `<ol class="history-list">${history.map(item => `<li>${e(formatAt(item.at))} · 经办 ${e(item.by || '长者')}<br>查看 ${item.view ? '允许' : '撤销'} · 代办 ${item.proxy ? '允许' : '撤销'} · 健康报告 ${item.health ? '允许' : '撤销'}</li>`).join('')}</ol>` : '<p class="empty-state">暂无授权变更历史。</p>'}`;
  openModal(modalFrame('家属三项独立授权', body, '家人守护'));
}
function openReassign(id) {
  if (state.role !== 'community') return;
  const item = findCase(id) || (state.data.affectedAppointments || []).find(entry => entry.id === id);
  if (!item || !['home', 'checkup'].includes(item.type)) { notify('受影响预约已更新，请刷新后重试', true); return; }
  const resources = activeResources().filter(resource => {
    if (item.type === 'home') return resource.kind === item.option;
    return resource.kind === item.option || (resource.projects || []).includes(item.option) || ['checkup', '体检'].includes(resource.category);
  });
  const summary = `<p>${e(item.residentName || item.name || '长者')} · ${e(serviceLabel(item.type))} · ${e(item.option)}</p><p>预约 ${e(item.date || '')} ${e(item.slot || '')} · 当前 expected 状态 ${e(item.status)}</p><p class="notice warning-box">原资源 ${e(item.resourceName || item.resourceId || '未记录')} 已下架或不可用。只有改派到启用资源后才能继续推进，原预约日期和时段保持不变。</p>`;
  const body = resources.length ? `${summary}<form id="reassign-form" data-id="${e(item.id)}" data-expected="${e(item.status)}"><label class="stack-label">改派到启用资源<select name="resourceId" required><option value="">请选择资源</option>${resources.map(resource => `<option value="${e(resource.id)}">${e(resource.name)} · 每时段容量 ${e(resource.capacity)} · ${e(resource.address || '地址由社区补充')}</option>`).join('')}</select></label><p id="reassign-status" aria-live="polite">提交时将携带当前状态作为 expected，状态已被他人修改时后端会拒绝改派。</p><div class="modal-actions"><button class="secondary-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="submit">确认改派资源</button></div></form>` : `${summary}<p class="empty-state">当前没有匹配该项目的启用资源，请先重新上架或在资源管理区新增资源。</p>`;
  openModal(modalFrame('改派受影响预约资源', body, '资源调度'), resources.length ? 'select' : '');
}
function openReject(id) {
  const item = findCase(id);
  if (!item || item.status !== '待社区审核') { notify('工单状态已变化，请刷新', true); return; }
  const body = `<p>${e(item.name)} · ${e(serviceLabel(item.type))} · ${e(item.option)}</p><form id="reject-form" data-id="${e(item.id)}"><label class="stack-label">退回原因（必填）<textarea name="note" maxlength="500" required autofocus></textarea></label><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="danger-button" type="submit">确认退回</button></div></form>`;
  openModal(modalFrame('退回工单', body, '单笔审核'), 'textarea');
}
function openBatchConfirm(ids) {
  const items = ids.map(findCase).filter(Boolean);
  if (!items.length) { notify('请先勾选可推进工单', true); return; }
  if (items.some(item => !canAdvance(item))) { notify('所选工单包含资源不可用或须逐单填写结果的状态，请先改派资源或逐单处理', true); return; }
  state.pendingBatch = ids;
  const body = `<p>这是二次确认。将按每条工单当前 expected 状态推进，若他人已修改状态，后端会拒绝本次操作。</p><ul>${items.map(item => `<li>${e(item.name)} · ${e(item.option)} · ${e(item.status)}</li>`).join('')}</ul><form id="batch-confirm-form"><label class="check-row"><input type="checkbox" required>我确认批量推进以上 ${e(items.length)} 条工单</label><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">再次确认批量推进</button></div></form>`;
  openModal(modalFrame('批量推进二次确认', body));
}
function openResult(id) {
  const item = findCase(id);
  if (!item) { notify('工单不存在', true); return; }
  const checkup = item.type === 'checkup' && item.status === '已完成';
  const home = item.type === 'home' && (item.status === '已确认' || item.status === '已完成' && !item.serviceResult);
  if (!checkup && !home) { notify('当前状态不支持录入结果', true); return; }
  const existing = checkup && Boolean(item.report);
  const title = checkup ? existing ? '确认修改体检报告' : '录入体检报告' : item.status === '已完成' ? '旧已完成工单补录' : '填写居家服务完成说明';
  const body = `<p>${e(item.name)} · ${e(item.option)} · ${e(item.status)}</p><div class="integration-box"><strong>来源：社区手工录入（演示）</strong><p>报告或完成说明不会标记为外部健康系统结果。居家照片可选，完成说明必填。</p></div>${existing ? `<div class="notice warning-box">已有报告。只有在下方明确勾选确认修改，请求才会携带 overwrite。</div>` : ''}<form id="result-form" data-id="${e(item.id)}" data-kind="${checkup ? 'checkup' : 'home'}" data-existing="${existing}"><label class="stack-label">${checkup ? '演示报告摘要' : '服务完成说明'}<textarea name="note" maxlength="500" required autofocus>${e(existing ? item.report : '')}</textarea></label>${home ? '<label class="stack-label">服务留痕照片（可选）<input name="attachment" type="file" accept="image/*"></label>' : ''}${existing ? '<label class="check-row"><input name="overwrite" type="checkbox" required>我已核对原报告，明确确认覆盖修改并保留修改历史</label>' : ''}<div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">${checkup ? existing ? '确认覆盖报告' : '保存报告' : '保存说明并办结'}</button></div></form>`;
  openModal(modalFrame(title, body, '报告与服务结果'), 'textarea');
}
function openResolve(id) {
  const item = (state.data.reminders || []).find(entry => entry.id === id && entry.level === '服务超时');
  if (!item) { notify('仅可处置当前未核销的服务超时预警', true); return; }
  const body = `<p>${e(item.residentName)} · ${e(item.option || serviceLabel(item.type))} · ${e(item.text)}</p><form id="resolve-form" data-id="${e(id)}"><label class="stack-label">预警处置说明（必填）<textarea name="note" maxlength="500" required autofocus></textarea></label><p>保存后展示后端记录的经办账号和处置时间。</p><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">确认处置</button></div></form>`;
  openModal(modalFrame('处置服务超时预警', body), 'textarea');
}
function openResourceForm(id) {
  const resource = id ? findResource(id) : { name: '', kind: state.data.services.home[1], category: '', projects: [], fee: 0, capacity: 4, phone: '', address: '', x: 1, y: 1, enabled: true };
  if (!resource) { notify('资源不存在', true); return; }
  const kinds = [...state.data.services.home.slice(1), ...state.data.services.checkup.slice(1)];
  const body = `<form id="resource-form" data-id="${e(id || '')}"><div class="form-grid"><label>资源名称<input name="name" maxlength="40" value="${e(resource.name)}" required></label><label>主服务类型<select name="kind">${kinds.map(kind => `<option value="${e(kind)}" ${selected(kind, resource.kind)}>${e(kind)}</option>`).join('')}</select></label><label>类别<input name="category" maxlength="40" value="${e(resource.category || resource.kind)}" required></label><label>服务项目（逗号分隔）<input name="projects" value="${e((resource.projects || [resource.kind]).join('，'))}" required></label><label>演示费用<input name="fee" type="number" min="0" max="100000" step="0.01" value="${e(resource.fee)}" required></label><label>每时段容量<input name="capacity" type="number" min="1" max="10000" step="1" value="${e(resource.capacity)}" required></label><label>服务电话<input name="phone" inputmode="tel" value="${e(resource.phone || '')}"></label><label>地址<input name="address" maxlength="200" value="${e(resource.address || '')}"></label><label>横向示意坐标<input name="x" type="number" min="-20" max="20" step="0.1" value="${e(resource.x)}" required></label><label>纵向示意坐标<input name="y" type="number" min="-20" max="20" step="0.1" value="${e(resource.y)}" required></label><label class="check-row full-field"><input name="enabled" type="checkbox" ${checked(resource.enabled)}>启用并允许预约</label></div><p class="notice">坐标仅为 coordinatesDemo 示意，不用于真实地图或导航。</p><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">保存资源</button></div></form>`;
  openModal(modalFrame(id ? '编辑服务资源' : '新增服务资源', body));
}
function profileBody(form, includeDeadlines) {
  const values = new FormData(form);
  const body = {
    name: values.get('name'),
    birthDate: values.get('birthDate') || '',
    birthDateEstimated: values.get('birthDateEstimated') === 'on',
    age: Number(values.get('age')),
    district: values.get('district'),
    local: values.get('local') === 'true',
    living: values.get('living'),
    mobility: values.get('mobility'),
    chronic: values.get('chronic') === 'on',
    needs: values.getAll('needs')
  };
  if (!body.birthDate) body.reestimateBirthDate = true;
  if (includeDeadlines) {
    body.deadlines = { annual: values.get('annual') || '', subsidy: values.get('subsidy') || '', checkup: values.get('checkup') || '', welfare: {} };
    form.querySelectorAll('[data-welfare-key]').forEach(row => {
      body.deadlines.welfare[row.dataset.welfareKey] = row.querySelector('input[type="date"]').value || '';
    });
    const welfareName = String(values.get('welfareName') || '').trim();
    if (welfareName) body.deadlines.welfare[welfareName] = values.get('welfareDate') || '';
  }
  return body;
}
function setVoiceResult(message) {
  const el = document.getElementById('voice-result');
  if (el) { el.textContent = message; return; }
  notify(message);
}
async function refreshState(silent = true) {
  if (!state.data || state.saving) return false;
  try {
    const data = await request(stateRequestPath());
    state.data = data;
    if (state.role === 'community') currentResident();
    render();
    if (!silent) notify('已按当前选中长者刷新最新数据');
    return true;
  } catch (error) {
    if (error.status === 401) await showAccess();
    else if (!silent) notify(error.message, true);
    return false;
  }
}
function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
document.addEventListener('submit', event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  submitLocked(form, async () => {
    if (form.id === 'login-form' || form.id === 'setup-form') {
      const endpoint = form.id === 'login-form' ? '/session' : '/setup';
      const data = await request(endpoint, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      form.reset();
      if (endpoint === '/session') showAccount(data);
      else { await showAccess(); notify('初始化完成，请使用社区账号登录'); }
      return;
    }
    if (!state.data) return;
    if (form.id === 'service-form') {
      const type = state.activeType;
      const option = document.getElementById('form-option').value;
      const file = document.getElementById('form-camera')?.files[0] || document.getElementById('form-file')?.files[0];
      const attachment = needsMaterial(type, option) ? await encodeAttachment(file) : '';
      const body = { action: 'apply', type, option, name: document.getElementById('form-name').value, note: document.getElementById('form-note')?.value || '', resourceId: document.getElementById('form-resource')?.value || '', date: document.getElementById('form-date')?.value || '', slot: document.getElementById('form-time')?.value || '', attachment };
      if (['home', 'checkup'].includes(type) && !body.slot) throw new Error('该日没有可预约时段，请更换日期或资源');
      if (type === 'home' && !body.resourceId) throw new Error('请选择启用且可预约的服务资源');
      if (await performAction(body, '申请已提交，等待社区审核')) {
        closeModal();
        speak(`${serviceLabel(type)}申请已提交，当前状态待社区审核。可在办理进度查看历史和审核结果。`);
        setTimeout(() => scrollToId('progress-section'), 80);
      }
      return;
    }
    if (form.id === 'password-form') {
      const values = new FormData(form);
      await request('/action', { method: 'POST', body: JSON.stringify({ action: 'password', oldPassword: values.get('oldPassword'), newPassword: values.get('newPassword') }) });
      closeModal(false);
      try { await request('/logout', { method: 'POST', body: '{}' }); } catch {}
      await showAccess();
      notify('密码已修改，请使用新密码重新登录');
      return;
    }
    if (form.id === 'reset-password-form') {
      const values = new FormData(form);
      if (await performAction({ action: 'resetPassword', username: values.get('username'), newPassword: values.get('newPassword') }, '密码已重置，请通知账号使用人使用新密码重新登录')) closeModal();
      return;
    }
    if (form.id === 'profile-form') {
      await performAction({ action: 'profile', ...profileBody(form, false) }, '画像已保存，刷新后仍会保留');
      return;
    }
    if (form.id === 'consent-form') {
      const values = new FormData(form);
      if (await performAction({ action: 'family', username: values.get('username'), view: values.get('view') === 'on', proxy: values.get('proxy') === 'on', health: values.get('health') === 'on', phone: values.get('phone') || '' }, '授权已保存并立即刷新')) closeModal();
      return;
    }
    if (form.id === 'reassign-form') {
      const values = new FormData(form);
      if (await performAction({ action: 'reassign', id: form.dataset.id, resourceId: values.get('resourceId'), expected: form.dataset.expected }, '资源已改派，受影响预约可继续按流程办理')) closeModal();
      return;
    }
    if (form.id === 'reject-form') {
      const item = findCase(form.dataset.id);
      if (!item) throw new Error('工单已更新，请刷新');
      const note = new FormData(form).get('note');
      if (await performAction({ action: 'review', ids: [item.id], decision: 'reject', expected: { [item.id]: item.status }, note }, '工单已退回并记录原因')) closeModal();
      return;
    }
    if (form.id === 'batch-confirm-form') {
      const items = state.pendingBatch.map(findCase).filter(Boolean);
      if (!items.length || items.some(item => !canAdvance(item))) throw new Error('所选工单状态已变化，请刷新后重新选择');
      if (await performAction({ action: 'review', ids: items.map(item => item.id), decision: 'next', expected: Object.fromEntries(items.map(item => [item.id, item.status])) }, `已批量推进 ${items.length} 条工单`)) closeModal();
      return;
    }
    if (form.id === 'result-form') {
      const values = new FormData(form);
      const file = values.get('attachment');
      const attachment = file?.size ? await encodeAttachment(file) : '';
      const existing = form.dataset.existing === 'true';
      if (existing && values.get('overwrite') !== 'on') throw new Error('修改已有报告必须明确确认覆盖');
      if (await performAction({ action: 'result', id: form.dataset.id, note: values.get('note'), attachment, overwrite: existing }, '报告或服务结果已保存并记录来源')) closeModal();
      return;
    }
    if (form.id === 'resolve-form') {
      if (await performAction({ action: 'resolve', id: form.dataset.id, note: new FormData(form).get('note') }, '预警已处置，经办人和时间已记录')) closeModal();
      return;
    }
    if (form.id === 'resource-form') {
      const values = new FormData(form);
      const body = { action: 'resource', id: form.dataset.id || undefined, name: values.get('name'), kind: values.get('kind'), category: values.get('category'), projects: String(values.get('projects') || '').split(/[,，]/).map(value => value.trim()).filter(Boolean), fee: Number(values.get('fee')), capacity: Number(values.get('capacity')), phone: values.get('phone'), address: values.get('address'), x: Number(values.get('x')), y: Number(values.get('y')), enabled: values.get('enabled') === 'on' };
      if (await performAction(body, '资源已保存，推荐和预约选项已同步')) closeModal();
      return;
    }
    if (form.id === 'resident-profile-form') {
      const resident = currentResident();
      if (!resident) throw new Error('请选择长者档案');
      await performAction({ action: 'resident', id: resident.id, ...profileBody(form, true) }, '选中长者的完整画像和期限已保存');
      return;
    }
    if (form.id === 'new-resident-form') {
      await performAction({ action: 'resident', ...profileBody(form, true) }, '新增长者档案已保存');
      return;
    }
    if (form.id === 'account-form') {
      const resident = currentResident();
      const values = Object.fromEntries(new FormData(form));
      if (await performAction({ action: 'account', elderId: resident.id, ...values }, '账号已开通')) form.reset();
      return;
    }
    if (form.id === 'visit-form') {
      const resident = currentResident();
      const values = Object.fromEntries(new FormData(form));
      if (await performAction({ action: 'visit', elderId: resident.id, ...values }, '探访或关怀记录已保存')) form.reset();
      return;
    }
    if (form.id === 'hotline-form') {
      const resident = currentResident();
      await performAction({ action: 'settings', elderId: resident?.id || '', hotline: new FormData(form).get('hotline') || '' }, '社区热线已保存');
    }
  });
});
document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (!target) {
    if (event.target === modal) closeModal();
    return;
  }
  const name = target.dataset.action;
  if (name === 'font') setFont(n(target.dataset.scale, 1));
  else if (name === 'theme') setTheme(target.dataset.themeValue);
  else if (name === 'reset-display') resetDisplay();
  else if (name === 'select-portal') selectPortal(target.dataset.portal);
  else if (name === 'close-modal') closeModal();
  else if (name === 'speech-pause') { if (state.audio) state.audio.pause(); else window.speechSynthesis?.pause(); }
  else if (name === 'speech-resume') { if (state.audio) state.audio.play().catch(() => {}); else window.speechSynthesis?.resume(); }
  else if (name === 'speech-replay') { if (state.audio) { state.audio.currentTime = 0; state.audio.play().catch(() => {}); } else speak(state.lastSpeech || pageSummary()); }
  else if (name === 'speak-page') speak(pageSummary());
  else if (name === 'home') {
    closeModal();
    state.directory = false;
    renderResources();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (name === 'logout') {
    if (state.saving) return;
    try { await request('/logout', { method: 'POST', body: '{}' }); await showAccess(); }
    catch (error) { notify(error.message, true); }
  } else if (!state.data) return;
  else if (name === 'change-password') openChangePassword();
  else if (name === 'reset-password') openResetPassword(target.dataset.username);
  else if (name === 'open-entry') {
    const type = target.dataset.type;
    if (type === 'progress') scrollToId('progress-section');
    else if (type === 'reminders') scrollToId('reminders-section');
    else openService(type);
  } else if (name === 'help') {
    if (state.data.hotline) location.href = 'tel:' + phoneHref(state.data.hotline);
    else { notify('社区尚未配置服务热线，请通过社区既有渠道求助', true); speak('社区服务热线尚未配置，请联系社区工作人员。'); }
  } else if (name === 'show-reminders') {
    state.allReminders = !state.allReminders;
    renderReminders();
  } else if (name === 'toggle-directory') {
    state.directory = !state.directory;
    renderResources();
    if (state.directory) scrollToId('resource-directory');
  } else if (name === 'resource-detail') openResource(target.dataset.id);
  else if (name === 'book-resource') bookResource(target.dataset.id);
  else if (name === 'read-reason') {
    const resource = findResource(target.dataset.id);
    if (resource) speak(`${resource.name}。推荐理由：${recommendationReason(resource)}。${resource.address || ''}。示意坐标，不用于导航。`);
  } else if (name === 'reminder') {
    const item = state.data.reminders.find(entry => entry.id === target.dataset.id);
    if (!item) return;
    speak(`${item.residentName || ''}${serviceLabel(item.type)}，${item.text}，期限${item.due}`);
    if (state.role === 'community') {
      if (item.elderId) {
        state.selectedResidentId = item.elderId;
        state.filters.elder = item.elderId;
        await refreshState(false);
      }
    } else if (state.data.canBook && state.data.services[item.type] && item.level !== '服务超时') openService(item.type);
  } else if (name === 'family-auth') showFamilyAuth();
  else if (name === 'revoke-permission') {
    const key = target.dataset.key;
    if (!['view', 'proxy', 'health'].includes(key)) return;
    const body = { action: 'family', username: state.data.familyUsername, view: state.data.family.view, proxy: state.data.family.proxy, health: state.data.family.health, phone: state.data.family.phone || '', [key]: false };
    if (await performAction(body, '该项授权已撤销并立即刷新')) showFamilyAuth();
  } else if (name === 'read-form') speak(formSpeechText());
  else if (name === 'read-eligibility') speak(eligibilitySpeech());
  else if (name === 'read-case') {
    const item = findCase(target.dataset.id);
    if (item) {
      const latest = item.history?.at(-1);
      speak(`${item.name || ''}的${serviceLabel(item.type)}，项目${item.option}，当前状态${item.status}${item.date ? `，预约${item.date}${item.slot}` : ''}${item.resourceName ? `，资源${item.resourceName}` : ''}${latest?.note ? `，最近审核说明${latest.note}` : ''}${item.serviceResult ? `，完成说明${item.serviceResult.note}` : ''}${item.report ? `，报告${item.report}` : ''}`);
    }
  } else if (name === 'read-return') {
    const item = findCase(target.dataset.id);
    const reason = [...(item?.history || [])].reverse().find(entry => entry.status === '已退回' && entry.note)?.note;
    speak(reason ? `退回原因：${reason}` : '暂无退回原因');
  } else if (name === 'read-case-eligibility') {
    const item = findCase(target.dataset.id);
    speak(item?.eligibility ? `提交时的演示资格依据：${(item.eligibility.basis || []).join('，')}。${item.eligibility.notice || ''}` : '该工单没有资格依据');
  } else if (name === 'read-report') {
    const item = findCase(target.dataset.id);
    speak(item?.report ? `报告摘要：${item.report}。来源：${item.reportSource || '未记录'}，录入人${item.reportBy || '未记录'}。` : '暂无可朗读报告');
  } else if (name === 'review-next') {
    const item = findCase(target.dataset.id);
    if (item && canAdvance(item)) await performAction({ action: 'review', ids: [item.id], decision: 'next', expected: { [item.id]: item.status } }, '工单已按 expected 状态推进');
  } else if (name === 'review-reject') openReject(target.dataset.id);
  else if (name === 'batch-review') openBatchConfirm([...document.querySelectorAll('.case-select:checked')].map(input => input.dataset.id));
  else if (name === 'open-result') openResult(target.dataset.id);
  else if (name === 'open-reassign') openReassign(target.dataset.id);
  else if (name === 'open-resolve') openResolve(target.dataset.id);
  else if (name === 'toggle-resource') {
    const resource = findResource(target.dataset.id);
    if (resource) await performAction({ action: 'resource', id: resource.id, enabled: !resource.enabled }, resource.enabled ? '资源已下架，受影响预约已同步显示' : '资源已重新上架');
  } else if (name === 'edit-resource') openResourceForm(target.dataset.id);
  else if (name === 'jump-admin') scrollToId(target.dataset.target);
});
document.addEventListener('change', async event => {
  const target = event.target;
  if (target.id === 'speech-rate') setSpeechRate(n(target.value, .9));
  if (target.id === 'form-option') {
    state.selectedResource = '';
    updateMaterialFields();
    updateServiceFields(true);
  }
  if (target.id === 'form-date') {
    delete document.getElementById('form-time')?.dataset.chosen;
    updateSlots();
  }
  if (target.id === 'form-resource') {
    state.selectedResource = target.value;
    delete document.getElementById('form-time')?.dataset.chosen;
    updateServiceFields(false);
  }
  if (target.id === 'form-time') {
    target.dataset.chosen = 'true';
    delete target.dataset.requireExplicit;
    delete target.dataset.voiceSlot;
  }
  if (target.id === 'form-camera' || target.id === 'form-file') {
    const other = target.id === 'form-camera' ? document.getElementById('form-file') : document.getElementById('form-camera');
    if (target.files[0] && other) other.value = '';
    const status = document.getElementById('file-status');
    if (status) status.textContent = target.files[0] ? `已选择 ${target.files[0].name}，提交时压缩。请手工核对，OCR未自动识别。` : '未选择图片。';
  }
  if (target.dataset.filter) {
    state.filters[target.dataset.filter] = target.value;
    renderWorkspace();
  }
  if (target.id === 'community-resident') {
    const previous = state.selectedResidentId;
    state.selectedResidentId = target.value;
    target.disabled = true;
    const refreshed = await refreshState(false);
    if (!refreshed && state.data) {
      state.selectedResidentId = previous;
      render();
    } else if (target.isConnected) target.disabled = false;
  }
  if (target.id === 'select-all-cases') document.querySelectorAll('.case-select:not(:disabled)').forEach(input => { input.checked = target.checked; });
  if (target.dataset.rating && target.value) {
    target.disabled = true;
    const saved = await performAction({ action: 'rate', id: target.dataset.rating, rating: Number(target.value) }, '服务评分已保存');
    if (!saved && target.isConnected) target.disabled = false;
  }
});
document.addEventListener('input', event => {
  const form = event.target.closest('form');
  if (form && !['voice-text-form', 'login-form', 'setup-form'].includes(form.id)) form.dataset.dirty = 'true';
});
document.addEventListener('keydown', focusTrap);
setInterval(() => {
  if (!state.data || state.saving || modal.classList.contains('open')) return;
  const active = document.activeElement;
  if (active?.matches('input, textarea, select') || document.querySelector('.app-shell form[data-dirty="true"]')) return;
  refreshState(true);
}, 60000);
setFont(n(storeGet('warm-neighbor-font-scale', '1'), 1));
setTheme(storeGet('warm-neighbor-theme', 'normal'));
setSpeechRate(n(storeGet('warm-neighbor-speech-rate', '.9'), .9));
if (location.protocol === 'file:') {
  document.getElementById('login-form').hidden = true;
  document.getElementById('setup-form').hidden = true;
  document.getElementById('access-hint').textContent = '当前为文件协议，无法连接本机 API。请在目录中运行 node server.js，再打开终端显示的本机地址。';
} else {
  request('/state').then(showAccount).catch(() => showAccess());
}
