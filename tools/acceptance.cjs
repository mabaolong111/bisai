'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const root = path.resolve(__dirname, '..');
const dataFile = path.join(__dirname, 'acceptance-isolated-data.json');
const reportFile = path.join(__dirname, 'acceptance-report.json');
const productionFile = path.join(root, 'nuanlin-data.json');
const password = 'Test-Only-2026!';
const results = [];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const productionHash = hash(productionFile);
const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' });
const today = () => dateFormat.format(new Date());
const day = offset => new Date(Date.parse(today() + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
let child = null;
let port = 0;
let setupCode = '';
let output = '';

function pass(name, detail = '') {
  results.push({ name, status: '通过', detail });
  console.log('PASS ' + name + (detail ? '：' + detail : ''));
}
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
async function start(reset = false) {
  if (reset) fs.writeFileSync(dataFile, JSON.stringify({ schemaVersion: 2, residents: [], accounts: [], resources: [], cases: [], visits: [], resolved: [], auditLog: [] }, null, 2));
  port = await freePort();
  setupCode = '';
  output = '';
  child = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root,
    env: { ...process.env, NUANLIN_PORT: String(port), NUANLIN_DATA: dataFile },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  const capture = chunk => {
    output += chunk.toString();
    setupCode ||= output.match(/初始化码：([a-f0-9]+)/)?.[1] || '';
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  let healthError = '尚无健康检查结果';
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error('测试服务提前退出：' + output);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1200) });
      if (response.ok) return;
      healthError = `HTTP ${response.status}：${await response.text()}`;
    } catch (error) { healthError = String(error.cause || error); }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('测试服务启动超时：' + output + '\n最后健康检查：' + healthError);
}
async function stop() {
  if (!child || child.exitCode !== null) { child = null; return; }
  const current = child;
  const exited = once(current, 'exit');
  current.kill();
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 4000))]);
  if (current.exitCode === null) current.kill('SIGKILL');
  child = null;
}
async function api(client, route, { method = 'GET', body, status = 200 } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (client.cookie) headers.Cookie = client.cookie;
  const response = await fetch(`http://127.0.0.1:${port}/api${route}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000)
  });
  const cookie = response.headers.get('set-cookie');
  if (cookie) client.cookie = cookie.split(';')[0];
  const result = await response.json();
  assert.equal(response.status, status, `${method} ${route}：${JSON.stringify(result)}`);
  return result;
}
async function login(username, portal) {
  const client = { cookie: '' };
  const state = await api(client, '/session', { method: 'POST', body: { username, password, portal } });
  assert.equal(state.role, portal);
  return client;
}
const action = (client, name, body = {}, status = 200) => api(client, '/action', { method: 'POST', body: { action: name, ...body }, status });
const state = (client, query = '') => api(client, '/state' + query);
const resident = (data, id) => data.residents.find(item => item.id === id);
const oneCase = (data, id) => data.cases.find(item => item.id === id);

async function main() {
  await start(true);
  const anonymous = { cookie: '' };
  assert.equal((await api(anonymous, '/setup')).required, true);
  assert.ok(setupCode, '未捕获隔离服务初始化码');
  await api(anonymous, '/setup', { method: 'POST', body: { code: setupCode, username: 'community_test', password } });
  let admin = await login('community_test', 'community');
  pass('隔离启动、网页初始化和社区独立账号登录', `临时端口 ${port}`);

  const createResident = async body => {
    const data = await action(admin, 'resident', body);
    return data.residents.find(item => item.name === body.name);
  };
  const a = await createResident({
    name: '张奶奶', birthDate: '1944-05-20', district: '测试一社区', local: true,
    living: '独居', mobility: '失能', chronic: true, needs: ['助餐配送', '陪护照料'],
    deadlines: { annual: day(10), subsidy: day(30), checkup: day(7), welfare: { '测试福利': day(1) } }
  });
  const b = await createResident({
    name: '李爷爷', birthDate: '1939-03-15', district: '测试二社区', local: false,
    living: '与家人同住', mobility: '自理', chronic: false, needs: ['上门维修'],
    deadlines: { annual: day(60), subsidy: day(90), checkup: day(120), welfare: {} }
  });
  for (const [elderId, username, role] of [[a.id, 'elder_a_test', 'elder'], [b.id, 'elder_b_test', 'elder'], [a.id, 'family_a_test', 'family']]) {
    await action(admin, 'account', { elderId, username, role, password });
  }
  const elderA = await login('elder_a_test', 'elder');
  const elderB = await login('elder_b_test', 'elder');
  const family = await login('family_a_test', 'family');
  await api({ cookie: '' }, '/session', { method: 'POST', body: { username: 'elder_a_test', password, portal: 'family' }, status: 403 });
  let adminState = await state(admin);
  assert.equal(resident(adminState, a.id).family.view, false);
  assert.equal(resident(adminState, a.id).family.proxy, false);
  assert.equal(resident(adminState, a.id).family.health, false);
  pass('两位长者、独立账号、角色端口校验及旧家属权限重置');

  await action(elderA, 'profile', {
    name: '张奶奶', birthDate: '1944-05-20', district: '测试一社区', local: true,
    living: '独居', mobility: '失能', chronic: true, needs: ['助餐配送', '陪护照料', '上门维修']
  });
  const profileState = await state(elderA);
  assert.deepEqual(profileState.profile.needs.sort(), ['助餐配送', '上门维修', '陪护照料'].sort());
  assert.equal(profileState.residentName, '张奶奶');
  assert.equal((await state(elderB)).residentName, '李爷爷');
  pass('长者画像和整行服务需求保存、刷新保留及跨档案资料隔离');

  let data = await state(admin);
  const resource = kind => data.resources.find(item => item.kind === kind && item.enabled);
  let careA = resource('陪护照料');
  const cleaning = resource('居家保洁');
  const createResource = async body => {
    data = await action(admin, 'resource', body);
    return data.resources.find(item => item.name === body.name);
  };
  careA ||= await createResource({ name: '测试主照护站', kind: '陪护照料', category: '上门照护', projects: ['陪护照料'], x: 0.8, y: 0.7, fee: 35, capacity: 4, phone: '010-12345677', address: '虚构照护路 1 号', enabled: true });
  const careB = await createResource({ name: '测试备用照护站', kind: '陪护照料', category: '上门照护', projects: ['陪护照料'], x: 1, y: 1, fee: 30, capacity: 4, phone: '010-12345678', address: '虚构照护路 2 号', enabled: true });
  const clinic = await createResource({ name: '测试社区卫生服务站', kind: '免费老年体检', category: '义诊', projects: ['免费老年体检', '普惠老年体检', '慢病专项体检', '慢病随访体检'], x: 0.4, y: 0.5, fee: 0, capacity: 1, phone: '010-12345679', address: '虚构健康路 3 号', enabled: true });
  const institution = await createResource({ name: '测试养老机构', kind: '日间照料', category: '养老机构', projects: ['日间照料'], x: 2, y: 1, fee: 80, capacity: 3, phone: '010-12345670', address: '虚构养老路 4 号', enabled: true });
  const renovation = await createResource({ name: '测试适老化改造点', kind: '上门维修', category: '适老化改造', projects: ['上门维修'], x: 1.5, y: 1, fee: 50, capacity: 2, phone: '010-12345671', address: '虚构改造路 5 号', enabled: true });
  assert.equal(institution.category, '养老机构');
  assert.equal(renovation.category, '适老化改造');
  assert.equal(clinic.category, '义诊');
  pass('食堂、日照、养老机构、上门照护、义诊和适老化改造资源维护');

  await action(family, 'apply', { type: 'home', option: '陪护照料', date: day(1), slot: '09:00', resourceId: careA.id, name: '越权称呼' }, 403);
  await action(elderA, 'family', { username: 'family_a_test', view: true, proxy: true, health: false, phone: '13800000000' });
  assert.equal((await state(family)).canBook, true);
  const annual = (await action(elderA, 'apply', { type: 'annual', option: '社区人工核验', name: '张奶奶本人称呼' })).cases[0];
  const subsidy = (await action(elderA, 'apply', { type: 'subsidy', option: '首次申请', name: '张奶奶补贴称呼' })).cases[0];
  assert.equal(annual.name, '张奶奶本人称呼');
  assert.equal(subsidy.name, '张奶奶补贴称呼');
  assert.equal(subsidy.eligibility.passed, true);
  assert.ok(subsidy.eligibility.basis.join('').includes('82 岁'));
  const home = (await action(family, 'apply', { type: 'home', option: '陪护照料', date: day(1), slot: '09:00', resourceId: careA.id, name: '张奶奶家属代办', note: '需要提前电话' })).cases[0];
  const checkup = (await action(family, 'apply', { type: 'checkup', option: '免费老年体检', date: day(1), slot: '09:00', resourceId: clinic.id, name: '张奶奶体检代办' })).cases[0];
  assert.equal(home.name, '张奶奶家属代办');
  assert.equal(home.byAccount, (await state(family)).cases.find(item => item.id === home.id).byAccount);
  assert.equal(checkup.advice, undefined, '未获健康授权的家属不应收到年龄、慢病和既往体检建议');
  pass('四类业务提交、称呼随工单保存、补贴初审及家属授权代办');

  data = await state(family, '?date=' + day(1));
  assert.equal(data.slots.find(item => item.slot === '09:00').checkupResourceBooked[clinic.id], 1);
  await action(elderA, 'apply', { type: 'checkup', option: '慢病专项体检', date: day(1), slot: '09:00', resourceId: clinic.id, name: '容量测试' }, 409);
  await action(family, 'apply', { type: 'home', option: '陪护照料', date: day(1), slot: '09:00', resourceId: careA.id, name: '重复预约' }, 409);
  await action(elderA, 'apply', { type: 'home', option: '陪护照料', date: day(-1), slot: '09:00', resourceId: careA.id, name: '过期预约' }, 400);
  pass('体检独立资源余量、容量、重复预约和过期时段拦截');

  data = await action(admin, 'review', { ids: [annual.id, subsidy.id], decision: 'next', expected: { [annual.id]: '待社区审核', [subsidy.id]: '待社区审核' }, note: '批量材料核验通过' });
  assert.equal(oneCase(data, annual.id).status, '审核通过');
  assert.equal(oneCase(data, subsidy.id).status, '审核通过');
  assert.ok(data.auditLog.some(item => item.action === 'review' && item.targetId === annual.id && item.detail.note === '批量材料核验通过'));
  data = await action(admin, 'review', { ids: [annual.id], decision: 'next', expected: { [annual.id]: '审核通过' }, note: '社区人工核验完成' });
  assert.equal(oneCase(data, annual.id).status, '已完成');
  data = await action(admin, 'review', { ids: [subsidy.id], decision: 'next', expected: { [subsidy.id]: '审核通过' }, note: '进入本地演示发放流程' });
  data = await action(admin, 'review', { ids: [subsidy.id], decision: 'next', expected: { [subsidy.id]: '补贴发放中' }, note: '本地演示办结，非真实支付' });
  assert.equal(oneCase(data, subsidy.id).status, '发放完成');
  assert.equal(resident(data, a.id).deadlines.annual, day(365));
  assert.equal(resident(data, a.id).deadlines.subsidy, day(365));
  assert.equal(resident(data, b.id).deadlines.annual, day(60));
  pass('单笔与批量审核留痕、四类状态和按人员更新期限');

  const rejected = (await action(elderB, 'apply', { type: 'annual', option: '社区人工核验', name: '李爷爷' })).cases[0];
  await action(admin, 'review', { ids: [rejected.id], decision: 'reject', expected: { [rejected.id]: '待社区审核' }, note: '' }, 400);
  data = await action(admin, 'review', { ids: [rejected.id], decision: 'reject', expected: { [rejected.id]: '待社区审核' }, note: '请补充清晰户籍材料' });
  assert.equal(oneCase(data, rejected.id).status, '已退回');
  const bState = await state(elderB);
  assert.ok(bState.cases.length > 0);
  assert.ok(bState.cases.every(item => item.elderId === b.id));
  assert.equal(oneCase(bState, rejected.id).history.at(-1).note, '请补充清晰户籍材料');
  await action(elderB, 'review', { ids: [rejected.id], decision: 'next', expected: { [rejected.id]: '已退回' } }, 403);
  pass('退回原因、补正历史、跨工单隔离和社区权限服务端校验');

  await action(admin, 'review', { ids: [home.id], decision: 'next', expected: { [home.id]: '待社区审核' }, note: '已安排照护人员' });
  await action(admin, 'review', { ids: [home.id], decision: 'next', expected: { [home.id]: '已确认' } }, 409);
  await action(admin, 'result', { id: home.id, note: '' }, 400);
  data = await action(admin, 'result', { id: home.id, note: '已完成陪护照料，长者状态平稳' });
  assert.equal(oneCase(data, home.id).status, '已完成');
  assert.equal(oneCase(data, home.id).serviceResult.note, '已完成陪护照料，长者状态平稳');
  assert.equal(oneCase(data, home.id).evidence, undefined);
  assert.equal(oneCase(data, home.id).history.at(-1).by, 'community_test');
  data = await action(family, 'rate', { id: home.id, rating: 5 });
  assert.equal(oneCase(data, home.id).rating, 5);
  pass('无照片办结、完成说明强制留痕及本人代办服务评价');

  const affected = (await action(elderA, 'apply', { type: 'home', option: '陪护照料', date: day(1), slot: '10:30', resourceId: careA.id, name: '张奶奶改派测试' })).cases[0];
  await action(admin, 'review', { ids: [affected.id], decision: 'next', expected: { [affected.id]: '待社区审核' } });
  data = await action(admin, 'resource', { id: careA.id, enabled: false });
  assert.ok(data.affectedAppointments.some(item => item.id === affected.id));
  await action(admin, 'result', { id: affected.id, note: '不应绕过下架限制' }, 409);
  await action(elderA, 'apply', { type: 'home', option: '陪护照料', date: day(2), slot: '09:00', resourceId: careA.id, name: '下架预约' }, 409);
  assert.ok(!(await state(elderA)).resources.some(item => item.id === careA.id));
  data = await action(admin, 'reassign', { id: affected.id, resourceId: careB.id, expected: '已确认' });
  assert.equal(oneCase(data, affected.id).resourceId, careB.id);
  data = await action(admin, 'result', { id: affected.id, note: '改派后服务完成' });
  assert.equal(oneCase(data, affected.id).status, '已完成');
  pass('资源下架同步推荐与预约、受影响工单改派及办结限制');

  await action(admin, 'review', { ids: [checkup.id], decision: 'next', expected: { [checkup.id]: '待社区审核' } });
  data = await action(admin, 'review', { ids: [checkup.id], decision: 'next', expected: { [checkup.id]: '已确认' } });
  assert.equal(oneCase(data, checkup.id).status, '已完成');
  assert.equal(resident(data, a.id).deadlines.checkup, day(365));
  data = await action(admin, 'result', { id: checkup.id, note: '演示摘要：血压记录已提供，请按卫生机构原报告复诊，本文字不构成诊断' });
  assert.equal(oneCase(data, checkup.id).reportSource, '社区手工录入（演示）');
  assert.ok(oneCase(await state(elderA), checkup.id).report.includes('演示摘要'));
  let familyState = await state(family);
  assert.equal(oneCase(familyState, checkup.id).report, undefined);
  assert.equal(oneCase(familyState, checkup.id).option, '体检预约');
  await action(elderA, 'family', { username: 'family_a_test', view: true, proxy: true, health: true, phone: '13800000000' });
  assert.ok(oneCase(await state(family), checkup.id).report.includes('演示摘要'));
  const guidance = (await state(family)).checkupAdvice['慢病专项体检'];
  assert.ok(guidance.includes('82 岁') && guidance.includes('慢病') && guidance.includes('已办结体检记录'));
  pass('体检办结、报告手工来源、通俗摘要、个体化建议及健康单独授权');

  await action(admin, 'visit', { elderId: a.id, type: '关怀', date: today(), note: '电话关怀并确认居家安全' });
  assert.equal((await state(family)).visits.length, 1);
  await action(elderA, 'family', { username: 'family_a_test', view: false, proxy: true, health: false, phone: '13800000000' });
  familyState = await state(family);
  assert.equal(familyState.visits.length, 0);
  assert.ok(familyState.cases.every(item => item.byAccount && item.by === 'family'));
  assert.ok(!familyState.cases.some(item => item.id === annual.id || item.id === subsidy.id));
  assert.equal(oneCase(familyState, checkup.id).report, undefined);
  await action(elderA, 'family', { username: 'family_a_test', view: false, proxy: false, health: false, phone: '13800000000' });
  assert.equal((await state(family)).cases.length, 0);
  await action(family, 'apply', { type: 'annual', option: '社区人工核验', name: '撤权后代办' }, 403);
  pass('仅代办权跟踪本人提交工单、探访分权及撤权即时生效');

  data = await action(admin, 'settings', { elderId: a.id, deadlines: { annual: day(-2), subsidy: day(30), checkup: day(7), welfare: { '测试福利': day(1) } } });
  assert.equal(resident(data, b.id).deadlines.annual, day(60));
  const remindersA = (await state(admin)).reminders.filter(item => item.elderId === a.id);
  assert.ok(remindersA.some(item => item.type === 'annual' && item.level === '已逾期'));
  assert.ok(remindersA.some(item => item.type === 'subsidy' && item.level === '30天提醒'));
  assert.ok(remindersA.some(item => item.type === 'welfare' && item.level === '1天提醒'));
  assert.equal(new Set(remindersA.map(item => item.id)).size, remindersA.length);
  assert.ok((await state(elderB)).reminders.every(item => item.elderId === b.id));
  assert.equal(data.stats.residentCount, 2);
  assert.equal(data.stats.processingVolume.total, data.cases.length);
  assert.ok(data.stats.processingVolume.total >= 6);
  pass('个人期限互不影响、30/7/1 天与逾期提醒、去重及实际统计');

  const overdue = (await action(elderA, 'apply', { type: 'home', option: '陪护照料', date: day(1), slot: '15:30', resourceId: careB.id, name: '张奶奶超时测试' })).cases[0];
  await action(admin, 'review', { ids: [overdue.id], decision: 'next', expected: { [overdue.id]: '待社区审核' } });
  const legacy = (await action(elderA, 'apply', { type: 'home', option: '陪护照料', date: day(2), slot: '14:00', resourceId: careB.id, name: '张奶奶旧工单' })).cases[0];
  await action(admin, 'review', { ids: [legacy.id], decision: 'next', expected: { [legacy.id]: '待社区审核' } });
  await action(admin, 'resource', { id: cleaning.id, enabled: false });
  await stop();

  const isolated = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  oneCase(isolated, overdue.id).date = day(-1);
  oneCase(isolated, overdue.id).slot = '09:00';
  oneCase(isolated, legacy.id).status = '已完成';
  delete oneCase(isolated, legacy.id).serviceResult;
  fs.writeFileSync(dataFile, JSON.stringify(isolated, null, 2));
  await start();
  admin = await login('community_test', 'community');
  adminState = await state(admin);
  const cleaningAfterRestart = adminState.resources.filter(item => item.kind === '居家保洁');
  assert.equal(cleaningAfterRestart.length, 1);
  assert.equal(cleaningAfterRestart[0].enabled, false);
  assert.deepEqual((await state(await login('elder_a_test', 'elder'))).profile.needs.sort(), ['助餐配送', '上门维修', '陪护照料'].sort());
  assert.equal(adminState.reminders.filter(item => item.id === overdue.id && item.level === '服务超时').length, 1);
  pass('重启后业务恢复、服务需求保留、下架不复活及超时预警唯一生成');

  await action(admin, 'resolve', { id: overdue.id, note: '' }, 400);
  data = await action(admin, 'resolve', { id: overdue.id, note: '已电话核查并重新约定服务时间' });
  assert.ok(!data.reminders.some(item => item.id === overdue.id));
  assert.equal(data.resolutionHistory.find(item => item.id === overdue.id).by, 'community_test');
  await action(admin, 'resolve', { id: overdue.id, note: '重复处置' }, 409);
  data = await action(admin, 'result', { id: legacy.id, note: '旧版已办结工单补录完成说明' });
  assert.equal(oneCase(data, legacy.id).serviceResult.note, '旧版已办结工单补录完成说明');
  await stop();
  await start();
  data = await state(await login('community_test', 'community'));
  assert.ok(!data.reminders.some(item => item.id === overdue.id));
  assert.equal(data.resources.filter(item => item.kind === '居家保洁').length, 1);
  assert.equal(data.resources.find(item => item.kind === '居家保洁').enabled, false);
  assert.ok(oneCase(data, legacy.id).serviceResult);
  pass('预警核查处置、禁止重复核销、旧工单补录及再次重启恢复');

  const legacyMigration = require(path.join(root, 'server.js')).migrate({
    profile: { age: 82, district: '旧社区', local: true, needs: ['上门维修'] },
    family: { view: true, proxy: true, health: true },
    cases: [{ id: 'legacy-case', type: 'annual', option: '社区人工核验', status: '待社区审核', history: [] }],
    deadlines: { annual: day(20), subsidy: day(30), checkup: day(40) }
  });
  assert.equal(legacyMigration.residents.length, 1);
  assert.equal(legacyMigration.cases[0].elderId, legacyMigration.residents[0].id);
  assert.equal(legacyMigration.schemaVersion, 2);
  pass('旧版单档案数据迁移及业务归属保留');
}

(async () => {
  try {
    await main();
    assert.equal(hash(productionFile), productionHash, '正式业务数据在隔离验收中发生变化');
    pass('正式 nuanlin-data.json 未被隔离验收修改', 'SHA-256 前后一致');
    fs.writeFileSync(reportFile, JSON.stringify({ success: true, generatedAt: new Date().toISOString(), temporaryPort: port, isolatedDataFile: dataFile, productionBackup: path.join(root, 'nuanlin-data.backup-20261125-final.json'), productionSha256: productionHash, results }, null, 2));
    console.log(`ACCEPTANCE_OK ${results.length} 项通过`);
  } catch (error) {
    results.push({ name: '验收中断', status: '未通过', detail: error.stack || error.message });
    fs.writeFileSync(reportFile, JSON.stringify({ success: false, generatedAt: new Date().toISOString(), temporaryPort: port, isolatedDataFile: dataFile, productionSha256: productionHash, results }, null, 2));
    console.error(error);
    process.exitCode = 1;
  } finally {
    await stop();
  }
})();
