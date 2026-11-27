'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');

const port = Number(process.env.NUANLIN_PORT || 8765);
const bindHost = String(process.env.NUANLIN_BIND_HOST || '127.0.0.1').trim();
const publicHost = String(process.env.NUANLIN_PUBLIC_HOST || '').trim().toLowerCase();
const secureCookies = process.env.NUANLIN_SECURE_COOKIES === '1';
const dataFile = process.env.NUANLIN_DATA || path.join(__dirname, 'nuanlin-data.json');
const sessions = new Map();
const loginAttempts = new Map();
const primaryResidentId = 'resident-demo-1';
const build = 'nuanlin-2026-11-27-5';
const services = {
  annual: ['养老资格认证', '社区人工核验', '家属提交材料'],
  subsidy: ['高龄补贴申请', '首次申请', '补贴年审'],
  home: ['居家养老预约', '助餐配送', '上门助浴', '居家保洁', '陪护照料', '理发修脚', '上门维修', '日间照料'],
  checkup: ['老年体检预约', '免费老年体检', '慢病随访体检', '普惠老年体检', '慢病专项体检']
};
const slots = ['09:00', '10:30', '14:00', '15:30'];
const active = ['待社区审核', '审核通过', '补贴发放中', '已确认'];
const done = ['已完成', '发放完成'];
const flows = {
  annual: ['待社区审核', '审核通过', '已完成'],
  subsidy: ['待社区审核', '审核通过', '补贴发放中', '发放完成'],
  home: ['待社区审核', '已确认', '已完成'],
  checkup: ['待社区审核', '已确认', '已完成']
};
const policies = {
  demonstration: true,
  subsidy: { minAge: 80, localRequired: true, cycleDays: 365 },
  eligibility: { cycleDays: 365 },
  capacities: { home: 4, checkup: 2 },
  cycles: { annual: 365, subsidy: 365, checkup: 365, chronicCheckup: 90 },
  reminderDays: [30, 7, 1],
  ruleNotice: '本地示例配置，仅用于演示，不代表真实政策或资格审核'
};
const newId = () => randomUUID();
const dateFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' });
const reportSource = '社区手工录入（演示）';

function day(offset = 0, from = dateFormat.format(new Date())) {
  return new Date(Date.parse(from + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clean(value, max = 160) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

const voiceStudioUrl = (process.env.VOICE_STUDIO_URL || 'http://127.0.0.1:3900').replace(/\/+$/, '');
const voiceStudioVoice = process.env.VOICE_STUDIO_VOICE || '1';
const ttsCache = new Map();
const ttsCacheMax = 40;

async function synthesizeSpeech(text, speed) {
  const rate = Number.isFinite(Number(speed)) ? Math.min(4, Math.max(.25, Number(speed))) : 1;
  const cacheKey = rate + '|' + text;
  const cached = ttsCache.get(cacheKey);
  if (cached) return cached;
  const response = await fetch(voiceStudioUrl + '/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'omnivoice', input: text, voice: voiceStudioVoice, language: 'zh', response_format: 'wav', speed: rate }),
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error('VoiceStudio 返回 ' + response.status);
  const audio = Buffer.from(await response.arrayBuffer());
  ttsCache.set(cacheKey, audio);
  if (ttsCache.size > ttsCacheMax) ttsCache.delete(ttsCache.keys().next().value);
  return audio;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) return false;
  const parsed = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function calculateAge(birthDate, onDate = day()) {
  if (!validDate(birthDate) || !validDate(onDate)) return null;
  const birth = new Date(birthDate + 'T00:00:00Z');
  const current = new Date(onDate + 'T00:00:00Z');
  if (birth > current) return null;
  let age = current.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday = current.getUTCMonth() < birth.getUTCMonth() || current.getUTCMonth() === birth.getUTCMonth() && current.getUTCDate() < birth.getUTCDate();
  if (beforeBirthday) age -= 1;
  return age;
}

function estimateBirthDate(age, onDate = day()) {
  if (!Number.isInteger(age) || age < 0 || age > 130 || !validDate(onDate)) return '';
  const current = new Date(onDate + 'T00:00:00Z');
  current.setUTCFullYear(current.getUTCFullYear() - age);
  return current.toISOString().slice(0, 10);
}

function normalizeProfile(value) {
  const source = isObject(value) ? value : {};
  return {
    ...source,
    age: Number.isInteger(source.age) ? source.age : 60,
    district: typeof source.district === 'string' ? source.district : '示例社区',
    local: source.local === true,
    living: ['独居', '与家人同住', '空巢'].includes(source.living) ? source.living : '与家人同住',
    mobility: ['自理', '行动不便', '失能'].includes(source.mobility) ? source.mobility : '自理',
    chronic: source.chronic === true,
    needs: Array.isArray(source.needs) ? source.needs.filter(item => typeof item === 'string') : []
  };
}

function normalizeFamily(value) {
  const source = isObject(value) ? value : {};
  return { ...source, view: source.view === true, proxy: source.proxy === true, health: source.health === true, phone: typeof source.phone === 'string' ? source.phone : '' };
}

function normalizeDeadlines(value) {
  const source = isObject(value) ? value : {};
  return {
    ...source,
    annual: typeof source.annual === 'string' ? source.annual : '',
    subsidy: typeof source.subsidy === 'string' ? source.subsidy : '',
    checkup: typeof source.checkup === 'string' ? source.checkup : '',
    welfare: isObject(source.welfare) ? { ...source.welfare } : {}
  };
}

function normalizeResident(value, fallbackId) {
  const source = isObject(value) ? { ...value } : {};
  const profile = normalizeProfile(source.profile);
  let birthDate = validDate(source.birthDate) ? source.birthDate : validDate(profile.birthDate) ? profile.birthDate : '';
  let birthDateEstimated = source.birthDateEstimated === true;
  if (!birthDate && Number.isInteger(profile.age)) {
    birthDate = estimateBirthDate(profile.age);
    birthDateEstimated = Boolean(birthDate);
  }
  if (birthDate) profile.age = calculateAge(birthDate) ?? profile.age;
  return {
    ...source,
    id: clean(source.id, 100) || fallbackId || newId(),
    name: clean(source.name, 40) || clean(profile.name, 40) || '演示长者',
    birthDate,
    birthDateEstimated,
    profile,
    family: normalizeFamily(source.family),
    familyHistory: Array.isArray(source.familyHistory) ? source.familyHistory.filter(isObject) : [],
    deadlines: normalizeDeadlines(source.deadlines),
    createdAt: clean(source.createdAt, 40),
    updatedAt: clean(source.updatedAt, 40)
  };
}

function defaultCapacity(kind) {
  return services.checkup.slice(1).includes(kind) || ['checkup', '体检'].includes(kind) ? policies.capacities.checkup : policies.capacities.home;
}

function normalizeResource(value) {
  const source = isObject(value) ? { ...value } : {};
  const kind = clean(source.kind, 40);
  const capacity = Number.isInteger(source.capacity) && source.capacity > 0 ? source.capacity : defaultCapacity(kind);
  return {
    ...source,
    id: clean(source.id, 100) || newId(),
    name: clean(source.name, 40) || '未命名资源',
    kind,
    category: clean(source.category, 40) || kind,
    projects: Array.isArray(source.projects) ? source.projects.filter(item => typeof item === 'string') : kind ? [kind] : [],
    fee: Number.isFinite(source.fee) && source.fee >= 0 ? source.fee : 0,
    phone: typeof source.phone === 'string' ? source.phone : '',
    address: typeof source.address === 'string' ? source.address : '',
    x: Number.isFinite(source.x) ? source.x : 0,
    y: Number.isFinite(source.y) ? source.y : 0,
    enabled: source.enabled !== false,
    capacity,
    coordinatesDemo: true,
    createdAt: clean(source.createdAt, 40),
    updatedAt: clean(source.updatedAt, 40)
  };
}

function resourceMatches(resource, type, option) {
  if (!resource) return false;
  if (type === 'home') return resource.kind === option;
  if (type === 'checkup') return resource.kind === option || (Array.isArray(resource.projects) && resource.projects.includes(option)) || ['checkup', '体检'].includes(resource.category);
  return false;
}

function resourceForCase(data, item) {
  if (!item || !['home', 'checkup'].includes(item.type)) return null;
  if (item.resourceId) {
    const byId = data.resources.find(resource => resource.id === item.resourceId);
    if (byId) return byId;
  }
  const name = item.resourceName || item.resource;
  if (!name) return null;
  return data.resources.find(resource => resource.name === name && (!item.option || resourceMatches(resource, item.type, item.option))) || null;
}

function caseResourceAvailable(data, item) {
  if (!['home', 'checkup'].includes(item?.type)) return true;
  if (item.type === 'checkup' && !item.resourceId && !item.resourceName && !item.resource) return true;
  const resource = resourceForCase(data, item);
  return Boolean(resource && resource.enabled && resourceMatches(resource, item.type, item.option));
}

function resourceBookingCount(data, type, dateValue, slot, resourceId, excludeId = '') {
  return data.cases.filter(item => item.id !== excludeId && item.type === type && item.date === dateValue && item.slot === slot && active.includes(item.status) && resourceForCase(data, item)?.id === resourceId).length;
}

function normalizeCase(value, elderId, resources) {
  const source = isObject(value) ? { ...value } : {};
  const history = Array.isArray(source.history) ? source.history.filter(isObject) : [];
  const resourceName = clean(source.resourceName, 40) || clean(source.resource, 40);
  const matched = resources.find(resource => resource.id === source.resourceId) || resources.find(resource => resource.name === resourceName && (!source.option || resourceMatches(resource, source.type, source.option)));
  const createdAt = clean(source.createdAt, 40) || clean(history[0]?.at, 40);
  const item = {
    ...source,
    id: clean(source.id, 100) || newId(),
    elderId: clean(source.elderId, 100) || elderId,
    name: clean(source.name, 40),
    by: clean(source.by, 20),
    byAccount: clean(source.byAccount, 100),
    status: clean(source.status, 40) || '待社区审核',
    note: typeof source.note === 'string' ? source.note : '',
    history,
    resourceId: clean(source.resourceId, 100) || matched?.id || '',
    resourceName: resourceName || matched?.name || '',
    resource: resourceName || matched?.name || '',
    createdAt,
    updatedAt: clean(source.updatedAt, 40) || clean(history.at(-1)?.at, 40) || createdAt,
    reportHistory: Array.isArray(source.reportHistory) ? source.reportHistory.filter(isObject) : []
  };
  if (['home', 'checkup'].includes(item.type)) {
    const linked = item.type === 'home' || Boolean(item.resourceId || item.resourceName || item.resource);
    item.resourceAvailable = linked ? Boolean(matched && matched.enabled && resourceMatches(matched, item.type, item.option)) : true;
  }
  return item;
}

function normalizeVisit(value, elderId) {
  const source = isObject(value) ? { ...value } : {};
  const at = clean(source.at, 40) || clean(source.createdAt, 40);
  return {
    ...source,
    id: clean(source.id, 100) || newId(),
    elderId: clean(source.elderId, 100) || elderId,
    type: ['探访', '关怀'].includes(source.type) ? source.type : '探访',
    by: clean(source.by, 40),
    byAccount: clean(source.byAccount, 100),
    at,
    date: validDate(source.date) ? source.date : validDate(at?.slice(0, 10)) ? at.slice(0, 10) : day(),
    note: typeof source.note === 'string' ? source.note : '',
    createdAt: clean(source.createdAt, 40) || at,
    updatedAt: clean(source.updatedAt, 40) || at
  };
}

function initialResources() {
  return [
    ['长者食堂', '助餐配送', 0.8, 0.2, 12],
    ['上门照护站', '陪护照料', -0.6, 0.8, 39],
    ['日间照料中心', '日间照料', 1.3, -0.5, 0],
    ['助浴服务站', '上门助浴', -1.7, -0.6, 29],
    ['便民服务点', '上门维修', 2.6, 1, 20],
    ['社区居家保洁示例点', '居家保洁', -0.9, -1.2, 25],
    ['社区理发修脚示例点', '理发修脚', 1.1, 1.2, 18]
  ].map(([name, kind, x, y, fee]) => normalizeResource({ id: newId(), name, kind, x, y, fee, enabled: true, phone: '' }));
}

function ensureDefaultResources(resources) {
  const defaults = [
    { name: '社区居家保洁示例点', kind: '居家保洁', x: -0.9, y: -1.2, fee: 25 },
    { name: '社区理发修脚示例点', kind: '理发修脚', x: 1.1, y: 1.2, fee: 18 }
  ];
  for (const value of defaults) {
    if (!resources.some(resource => resource.kind === value.kind)) resources.push(normalizeResource({ id: newId(), ...value, enabled: true, phone: '' }));
  }
  return resources;
}

function initial() {
  const profile = { name: '演示长者', age: 82, district: '示例社区', local: true, living: '独居', mobility: '行动不便', chronic: false, needs: ['助餐配送', '陪护照料'] };
  return {
    schemaVersion: 2,
    residents: [normalizeResident({ id: primaryResidentId, name: '演示长者', profile, family: { view: false, proxy: false, health: false, phone: '' }, deadlines: { annual: day(7), subsidy: day(30), checkup: day(1), welfare: {} } })],
    accounts: [],
    hotline: '',
    cases: [],
    visits: [],
    resolved: [],
    resources: initialResources(),
    auditLog: []
  };
}

function safeAuditDetail(value) {
  if (Array.isArray(value)) return value.map(safeAuditDetail).filter(item => item !== undefined);
  if (isObject(value)) {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/password|hash|salt|token|secret|attachment|evidence|report|birthDate|hotline|phone/i.test(key)) continue;
      const safe = safeAuditDetail(entry);
      if (safe !== undefined) result[clean(key, 60)] = safe;
    }
    return result;
  }
  if (typeof value === 'string') return clean(value, 200);
  if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') return value;
  return undefined;
}

function safeAuditLog(entries) {
  return (Array.isArray(entries) ? entries : []).filter(isObject).map(item => ({
    id: clean(item.id, 100),
    action: clean(item.action, 40),
    targetId: clean(item.targetId, 100),
    by: clean(item.by, 40),
    at: clean(item.at, 40),
    detail: safeAuditDetail(item.detail) || {}
  }));
}

function recordAudit(data, action, targetId, account, detail = {}) {
  data.auditLog ||= [];
  data.auditLog.push({ id: newId(), action, targetId: clean(targetId, 100), by: clean(account?.username, 40), at: new Date().toISOString(), detail: safeAuditDetail(detail) || {} });
}

function migrate(value) {
  const source = isObject(value) ? structuredClone(value) : initial();
  const hadResidents = Array.isArray(source.residents);
  const residentInputs = hadResidents ? source.residents.filter(isObject).map(item => ({ ...item })) : [];
  const hasLegacyProfile = isObject(source.profile) || isObject(source.family) || isObject(source.deadlines);
  if (hasLegacyProfile) {
    const legacy = normalizeResident({ id: primaryResidentId, name: source.profile?.name, profile: source.profile, family: source.family, deadlines: source.deadlines }, primaryResidentId);
    const index = residentInputs.findIndex(item => item.id === primaryResidentId);
    if (index < 0) residentInputs.unshift(legacy);
    else {
      const current = residentInputs[index];
      current.name ||= legacy.name;
      current.profile = { ...legacy.profile, ...(isObject(current.profile) ? current.profile : {}) };
      current.family = { ...legacy.family, ...(isObject(current.family) ? current.family : {}) };
      current.deadlines = { ...legacy.deadlines, ...(isObject(current.deadlines) ? current.deadlines : {}), welfare: { ...legacy.deadlines.welfare, ...(isObject(current.deadlines?.welfare) ? current.deadlines.welfare : {}) } };
      if (!current.birthDate && !validDate(current.profile?.birthDate)) {
        current.birthDate = estimateBirthDate(normalizeProfile(current.profile).age);
        current.birthDateEstimated = true;
      }
    }
  }
  if (!residentInputs.length && source.schemaVersion !== 2) residentInputs.push(normalizeResident({ id: primaryResidentId, name: '演示长者', profile: { age: 82 } }, primaryResidentId));
  const residents = residentInputs.map((item, index) => normalizeResident(item, index === 0 && !hadResidents ? primaryResidentId : undefined));
  const resources = source.schemaVersion === 2 || Array.isArray(source.resources) ? ensureDefaultResources((Array.isArray(source.resources) ? source.resources : []).map(normalizeResource)) : initialResources();
  const fallbackElderId = residents.find(item => item.id === primaryResidentId)?.id || residents[0]?.id || '';
  const forceLegacyOwner = hasLegacyProfile && !hadResidents;
  const cases = (Array.isArray(source.cases) ? source.cases : []).map(item => normalizeCase(item, forceLegacyOwner ? primaryResidentId : fallbackElderId, resources));
  if (forceLegacyOwner) for (const item of cases) item.elderId = primaryResidentId;
  for (const item of cases) if (!item.name) item.name = residents.find(resident => resident.id === item.elderId)?.name || '';
  const visits = (Array.isArray(source.visits) ? source.visits : []).map(item => normalizeVisit(item, forceLegacyOwner ? primaryResidentId : fallbackElderId));
  if (forceLegacyOwner) for (const item of visits) item.elderId = primaryResidentId;
  const resolved = (Array.isArray(source.resolved) ? source.resolved : []).map(item => typeof item === 'string' ? item : isObject(item) ? {
    ...item,
    id: clean(item.id, 160),
    elderId: clean(item.elderId, 100),
    caseId: clean(item.caseId, 100),
    by: clean(item.by, 40),
    byAccount: clean(item.byAccount, 100),
    at: clean(item.at, 40),
    note: typeof item.note === 'string' ? item.note : ''
  } : item);
  const result = {
    ...source,
    schemaVersion: 2,
    residents,
    accounts: Array.isArray(source.accounts) ? source.accounts.filter(isObject) : [],
    cases,
    visits,
    resources,
    hotline: typeof source.hotline === 'string' ? source.hotline : '',
    resolved,
    auditLog: safeAuditLog(source.auditLog)
  };
  delete result.profile;
  delete result.family;
  delete result.deadlines;
  return result;
}

let db = migrate(fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : initial());
let setupCode = db.accounts.some(validCommunityAccount) ? '' : randomBytes(16).toString('hex');

function save(next) {
  next.schemaVersion = 2;
  next.auditLog ||= [];
  for (const resident of next.residents) {
    const age = calculateAge(resident.birthDate);
    if (age !== null) resident.profile.age = age;
  }
  for (const item of next.cases) {
    if (!item.name) item.name = next.residents.find(resident => resident.id === item.elderId)?.name || '';
    if (['home', 'checkup'].includes(item.type)) item.resourceAvailable = caseResourceAvailable(next, item);
  }
  delete next.profile;
  delete next.family;
  delete next.deadlines;
  const temp = dataFile + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(temp, dataFile);
  db = next;
}

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function validPassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) fail('密码须为 8 至 128 个字符');
  return value;
}

function validCommunityAccount(account) {
  return account?.role === 'community' && typeof account.id === 'string' && Boolean(account.id) && /^[a-z0-9_-]{3,32}$/.test(account.username || '') && typeof account.salt === 'string' && Boolean(account.salt) && /^[a-f0-9]{128}$/i.test(account.hash || '');
}

function verifyPassword(account, password) {
  if (!account || typeof password !== 'string' || typeof account.salt !== 'string' || !/^[a-f0-9]{128}$/i.test(account.hash || '')) return false;
  const actual = scryptSync(password, account.salt, 64);
  const expected = Buffer.from(account.hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function setPassword(account, password) {
  const salt = randomBytes(16).toString('hex');
  account.salt = salt;
  account.hash = scryptSync(password, salt, 64).toString('hex');
}

function accountFields(body) {
  const username = clean(body.username).toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/.test(username)) fail('账号须为 3 至 32 位英文字母、数字、下划线或短横线');
  return { username, password: validPassword(body.password) };
}

function createAccount(data, body, role, elderId) {
  const { username, password } = accountFields(body);
  if (data.accounts.some(account => account.username === username || (elderId && account.elderId === elderId && account.role === role))) fail('账号已存在，或当前档案已配有该身份的账号', 409);
  const account = { id: newId(), username, role, elderId, salt: '', hash: '' };
  setPassword(account, password);
  data.accounts.push(account);
  return account;
}

function phone(value) {
  const number = clean(value, 24);
  if (number && !/^\+?[0-9][0-9 -]{4,20}$/.test(number)) fail('请输入有效的联系电话');
  return number;
}

function date(value) {
  if (!validDate(value)) fail('请选择有效日期');
  return value;
}

function currentProfile(resident) {
  const profile = { ...normalizeProfile(resident?.profile) };
  const age = calculateAge(resident?.birthDate);
  if (age !== null) profile.age = age;
  return profile;
}

function subsidyEligibility(resident, onDate = day()) {
  const profile = currentProfile(resident);
  const age = calculateAge(resident?.birthDate, onDate) ?? profile.age;
  const local = profile.local === true;
  const agePassed = Number.isInteger(age) && age >= policies.subsidy.minAge;
  const localPassed = !policies.subsidy.localRequired || local;
  return {
    type: 'subsidy',
    passed: agePassed && localPassed,
    demo: true,
    demonstration: true,
    rule: 'local-demo-v2',
    minAge: policies.subsidy.minAge,
    localRequired: policies.subsidy.localRequired,
    age,
    birthDate: resident?.birthDate || '',
    birthDateEstimated: resident?.birthDateEstimated === true,
    local,
    basis: [
      `按档案出生日期计算年龄：${Number.isInteger(age) ? age + ' 岁' : '未知'}`,
      `档案户籍：${local ? '本地户籍' : '非本地户籍'}`,
      `补贴规则：年满 ${policies.subsidy.minAge} 岁，${policies.subsidy.localRequired ? '须为本地户籍' : '不限制户籍'}（local-demo-v2）`
    ],
    checks: [
      { key: 'age', passed: agePassed, text: `年龄须年满 ${policies.subsidy.minAge} 岁` },
      { key: 'local', passed: localPassed, text: policies.subsidy.localRequired ? '须为本地户籍' : '户籍不作为限制条件' }
    ],
    notice: '仅为本地演示规则初审，不构成真实资格审核结果'
  };
}

function resolvedId(item) {
  return typeof item === 'string' ? item : clean(item?.id, 160);
}

function isResolved(data, id) {
  return data.resolved.some(item => resolvedId(item) === id);
}

function reminders(data) {
  const items = new Map();
  for (const resident of data.residents) {
    const deadlines = [];
    for (const type of ['annual', 'subsidy', 'checkup']) deadlines.push({ type, due: resident.deadlines[type] });
    for (const [key, due] of Object.entries(resident.deadlines.welfare || {})) deadlines.push({ type: 'welfare', welfareType: key, due });
    for (const entry of deadlines) {
      if (!validDate(entry.due)) continue;
      const days = Math.round((Date.parse(entry.due + 'T00:00:00Z') - Date.parse(day() + 'T00:00:00Z')) / 86400000);
      if (days > policies.reminderDays[0]) continue;
      const level = days < 0 ? '已逾期' : days <= 1 ? '1天提醒' : days <= 7 ? '7天提醒' : '30天提醒';
      const suffix = entry.type === 'welfare' ? 'welfare:' + entry.welfareType : entry.type;
      const id = resident.id + ':' + suffix + ':' + entry.due;
      items.set(id, { id, elderId: resident.id, residentName: resident.name, type: entry.type, welfareType: entry.welfareType, due: entry.due, days, level, text: days < 0 ? '已逾期 ' + -days + ' 天' : days === 0 ? '今天到期' : '还有 ' + days + ' 天到期' });
    }
  }
  const now = Date.now();
  for (const item of data.cases) {
    if (!validDate(item.date) || !slots.includes(item.slot) || !['home', 'checkup'].includes(item.type) || !active.includes(item.status)) continue;
    const deadline = Date.parse(item.date + 'T' + item.slot + ':00+08:00') + 90 * 60000;
    if (now < deadline || items.has(item.id)) continue;
    items.set(item.id, { id: item.id, caseId: item.id, elderId: item.elderId, residentName: data.residents.find(resident => resident.id === item.elderId)?.name, type: item.type, due: item.date, days: -1, level: '服务超时', text: item.option + ' 超时未完成' });
  }
  return [...items.values()].filter(item => !isResolved(data, item.id)).sort((a, b) => a.days - b.days || a.id.localeCompare(b.id));
}

function recommend(data, profile, safeReason = false) {
  const p = normalizeProfile(profile);
  return data.resources.filter(resource => resource.enabled).map(resource => {
    const distance = Math.hypot(resource.x, resource.y);
    const preferred = !safeReason && (p.needs.includes(resource.kind) || (p.mobility !== '自理' && ['陪护照料', '上门助浴'].includes(resource.kind)) || (p.age >= 80 && p.living === '独居' && resource.kind === '日间照料'));
    const free = !safeReason && p.age >= 80 && p.local && resource.fee === 0;
    return { ...resource, distance, score: Number(distance <= 3) * 100 + Number(preferred) * 20 + Number(free) * 10 - distance,
      reason: safeReason ? distance.toFixed(1) + ' 公里' : [distance.toFixed(1) + ' 公里', preferred && '符合照护需求', free && '符合示例免费服务条件'].filter(Boolean).join(' · ') };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function decorateCase(data, item) {
  const result = { ...item, name: item.name || data.residents.find(resident => resident.id === item.elderId)?.name || '' };
  if (['home', 'checkup'].includes(item.type)) {
    const resource = resourceForCase(data, item);
    result.resourceId = item.resourceId || resource?.id || '';
    result.resourceName = item.resourceName || item.resource || resource?.name || '';
    result.resource = item.resource || result.resourceName;
    result.resourceAvailable = caseResourceAvailable(data, item);
  }
  return result;
}

function safeCaseHistory(entries) {
  return (Array.isArray(entries) ? entries : []).filter(isObject).map(item => ({
    status: clean(item.status, 40),
    note: clean(item.note, 500),
    by: clean(item.by, 40),
    byAccount: clean(item.byAccount, 100),
    role: clean(item.role, 20),
    at: clean(item.at, 40)
  }));
}

function trimFamilyCase(data, item) {
  const full = decorateCase(data, item);
  return {
    id: full.id,
    elderId: full.elderId,
    name: full.name,
    type: full.type,
    option: full.type === 'checkup' ? '体检预约' : full.option,
    project: full.type === 'checkup' ? '体检预约' : full.project,
    date: full.date,
    slot: full.slot,
    status: full.status,
    by: full.by,
    byAccount: full.byAccount,
    resourceId: full.resourceId,
    resourceName: full.resourceName,
    resource: full.resource,
    resourceAvailable: full.resourceAvailable,
    rating: full.rating,
    ratedAt: full.ratedAt,
    history: safeCaseHistory(full.history),
    createdAt: full.createdAt,
    updatedAt: full.updatedAt
  };
}

function familyHealthCase(data, item) {
  const full = decorateCase(data, item);
  const result = trimFamilyCase(data, item);
  for (const key of ['report', 'reportSource', 'reportBy', 'reportAt']) if (full[key] !== undefined) result[key] = full[key];
  return result;
}

function familyEligibility(value) {
  return { ...value, birthDate: '', birthDateEstimated: false };
}

function familyCase(data, item, account, family) {
  const own = item.byAccount === account.id;
  const ownProxy = family.proxy && own;
  const healthCase = family.health && item.type === 'checkup';
  if (!family.view && !ownProxy && !healthCase) return null;
  if (!family.view) return healthCase ? familyHealthCase(data, item) : trimFamilyCase(data, item);
  if (item.type === 'checkup' && !family.health) return trimFamilyCase(data, item);
  const result = decorateCase(data, item);
  delete result.attachment;
  delete result.evidence;
  if (result.eligibility) result.eligibility = familyEligibility(result.eligibility);
  return result;
}

function safeFamilyHistory(entries) {
  return (Array.isArray(entries) ? entries : []).map(item => ({
    id: clean(item.id, 100),
    by: clean(item.by, 40),
    byAccount: clean(item.byAccount, 100),
    at: clean(item.at, 40),
    view: (item.permissions?.view ?? item.view) === true,
    proxy: (item.permissions?.proxy ?? item.proxy) === true,
    health: (item.permissions?.health ?? item.health) === true,
    status: clean(item.status, 40),
    note: clean(item.note, 200),
    pending: item.pending === true
  }));
}

function integrationStatus(name) {
  const prefix = 'NUANLIN_' + name.toUpperCase();
  const configured = ['URL', 'KEY', 'TOKEN', 'SECRET', 'CONFIG'].some(suffix => clean(process.env[prefix + '_' + suffix], 1));
  return { configured, mode: configured ? 'configured-not-verified' : 'local-demo' };
}

function integrationSnapshot() {
  return Object.fromEntries(['identity', 'sms', 'face', 'ocr', 'payment', 'health', 'map', 'push'].map(name => [name, integrationStatus(name)]));
}

function resolutionHistory(data) {
  return data.resolved.map(entry => {
    if (typeof entry !== 'string') return { ...entry };
    const linkedCase = data.cases.find(item => item.id === entry);
    const elderId = linkedCase?.elderId || (entry.includes(':') ? entry.split(':')[0] : '');
    return { id: entry, elderId, caseId: linkedCase?.id || '', by: '', byAccount: '', at: '', note: '', legacy: true };
  });
}

function buildStats(data) {
  const ageStructure = { '60-69': 0, '70-79': 0, '80-89': 0, '90+': 0, other: 0, unknown: 0 };
  const serviceNeeds = Object.fromEntries(services.home.slice(1).map(kind => [kind, 0]));
  for (const resident of data.residents) {
    const profile = currentProfile(resident);
    const age = calculateAge(resident.birthDate) ?? profile.age;
    if (!Number.isInteger(age)) ageStructure.unknown += 1;
    else if (age >= 90) ageStructure['90+'] += 1;
    else if (age >= 80) ageStructure['80-89'] += 1;
    else if (age >= 70) ageStructure['70-79'] += 1;
    else if (age >= 60) ageStructure['60-69'] += 1;
    else ageStructure.other += 1;
    for (const need of profile.needs) serviceNeeds[need] = (serviceNeeds[need] || 0) + 1;
  }
  const subsidyStatus = {};
  const byStatus = {};
  const byType = Object.fromEntries(Object.keys(services).map(type => [type, { total: 0, completed: 0 }]));
  let completed = 0;
  for (const item of data.cases) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    if (item.type === 'subsidy') subsidyStatus[item.status] = (subsidyStatus[item.status] || 0) + 1;
    if (!byType[item.type]) byType[item.type] = { total: 0, completed: 0 };
    byType[item.type].total += 1;
    if (done.includes(item.status)) {
      byType[item.type].completed += 1;
      completed += 1;
    }
  }
  return {
    residentCount: data.residents.length,
    ageStructure,
    serviceNeeds,
    subsidyStatus,
    processingVolume: { total: data.cases.length, completed, byType },
    completionRate: data.cases.length ? Math.round(completed / data.cases.length * 10000) / 100 : 0,
    resolvedAlertCount: new Set(data.resolved.map(resolvedId).filter(Boolean)).size,
    byStatus
  };
}

function snapshot(account, selectedDate, selectedElderId) {
  const { role, elderId, username } = account;
  const admin = role === 'community';
  const resident = db.residents.find(entry => entry.id === elderId);
  const recommendationResident = admin && selectedElderId ? db.residents.find(entry => entry.id === selectedElderId) : null;
  const family = normalizeFamily(resident?.family);
  const readable = role !== 'family' || family.view;
  const canBook = role === 'elder' || (role === 'family' && family.proxy);
  const visible = db.cases.filter(item => admin || item.elderId === elderId).map(item => {
    if (admin || role === 'elder') return decorateCase(db, item);
    return familyCase(db, item, account, family);
  }).filter(Boolean);
  const visibleIds = new Set(visible.map(item => item.id));
  const alerts = reminders(db)
    .filter(alert => admin || (alert.elderId === elderId && (readable || visibleIds.has(alert.id))))
    .map(alert => role === 'family' && !(family.view && family.health) && alert.type === 'checkup' ? { ...alert, text: '体检预约超时未完成' } : alert);
  const affectedAppointments = admin ? db.cases.filter(item => ['home', 'checkup'].includes(item.type) && active.includes(item.status) && !decorateCase(db, item).resourceAvailable).map(item => {
    const decorated = decorateCase(db, item);
    return { id: decorated.id, elderId: decorated.elderId, residentName: db.residents.find(entry => entry.id === decorated.elderId)?.name || decorated.name, type: decorated.type, option: decorated.option, date: decorated.date, slot: decorated.slot, status: decorated.status, resourceId: decorated.resourceId, resourceName: decorated.resourceName, resourceAvailable: false };
  }) : [];
  let resourceList;
  if (admin) {
    resourceList = db.resources.map(resource => ({ ...resource, affectedCaseIds: affectedAppointments.filter(item => item.resourceId === resource.id).map(item => item.id) }));
    if (recommendationResident) {
      const ranked = recommend(db, currentProfile(recommendationResident));
      const suggestions = new Map(ranked.map((resource, index) => [resource.id, { ...resource, index }]));
      resourceList = resourceList.map(resource => {
        const suggested = suggestions.get(resource.id);
        return suggested ? { ...resource, distance: suggested.distance, score: suggested.score, reason: suggested.reason } : resource;
      }).sort((a, b) => (suggestions.get(a.id)?.index ?? ranked.length) - (suggestions.get(b.id)?.index ?? ranked.length));
    }
  } else resourceList = resident && readable ? recommend(db, currentProfile(resident), role === 'family' && !family.proxy) : db.resources.filter(resource => resource.enabled).map(resource => ({ ...resource }));
  const queryDate = validDate(selectedDate) ? selectedDate : day();
  const integrations = integrationSnapshot();
  const eligibility = resident && (role === 'elder' || role === 'family' && family.view) ? subsidyEligibility(resident) : null;
  const checkupGuidance = resident && (role === 'elder' || role === 'family' && family.proxy) ? Object.fromEntries(services.checkup.slice(1).map(option => [option, checkupAdvice(db, resident, option, role === 'elder' || family.health)])) : {};
  return {
    build,
    role,
    username,
    canBook,
    family: role === 'elder' ? family : { view: family.view, proxy: family.proxy, health: family.health, phone: role === 'family' && family.view ? family.phone : '' },
    residentName: resident?.name,
    residentDistrict: resident ? currentProfile(resident).district : undefined,
    profile: role === 'elder' && resident ? currentProfile(resident) : null,
    birthDate: role === 'elder' ? resident?.birthDate || '' : undefined,
    birthDateEstimated: role === 'elder' ? resident?.birthDateEstimated === true : undefined,
    eligibility: role === 'family' && eligibility ? familyEligibility(eligibility) : eligibility,
    checkupAdvice: checkupGuidance,
    linkedFamily: role === 'elder' ? db.accounts.some(item => item.role === 'family' && item.elderId === elderId) : undefined,
    familyUsername: role === 'elder' ? db.accounts.find(item => item.role === 'family' && item.elderId === elderId)?.username || '' : undefined,
    familyHistory: role === 'elder' ? safeFamilyHistory(resident?.familyHistory) : undefined,
    residents: admin ? db.residents.map(entry => ({
      ...entry,
      profile: currentProfile(entry),
      family: normalizeFamily(entry.family),
      familyHistory: safeFamilyHistory(entry.familyHistory),
      deadlines: normalizeDeadlines(entry.deadlines),
      district: currentProfile(entry).district,
      accounts: db.accounts.filter(item => item.elderId === entry.id).map(({ id, role, username }) => ({ id, role, username }))
    })) : [],
    hotline: db.hotline,
    services,
    policies: structuredClone(policies),
    integrations,
    navigation: { configured: integrations.map.configured, mode: integrations.map.configured ? 'configured-not-verified' : 'coordinates-demo', coordinatesDemo: true, url: null },
    stats: admin ? buildStats(db) : null,
    auditLog: admin ? safeAuditLog(db.auditLog) : [],
    resolutionHistory: admin ? resolutionHistory(db) : [],
    resolved: admin ? structuredClone(db.resolved) : [],
    affectedAppointments,
    today: day(),
    tomorrow: day(1),
    cases: visible,
    reminders: alerts,
    visits: readable ? db.visits.filter(visit => admin || visit.elderId === elderId).map(visit => ({ ...visit })) : [],
    resources: resourceList,
    slots: slots.map(slot => ({
      slot,
      booked: db.cases.filter(item => item.type === 'checkup' && item.date === queryDate && item.slot === slot && active.includes(item.status)).length,
      homeBooked: db.cases.filter(item => item.type === 'home' && item.date === queryDate && item.slot === slot && active.includes(item.status)).length,
      resourceBooked: Object.fromEntries(db.resources.map(resource => [resource.id, db.cases.filter(item => item.type === 'home' && item.date === queryDate && item.slot === slot && active.includes(item.status) && resourceForCase(db, item)?.id === resource.id).length])),
      checkupResourceBooked: Object.fromEntries(db.resources.map(resource => [resource.id, db.cases.filter(item => item.type === 'checkup' && item.date === queryDate && item.slot === slot && active.includes(item.status) && resourceForCase(db, item)?.id === resource.id).length]))
    }))
  };
}

function profileFromBody(body, resident) {
  const current = resident || { name: '', birthDate: '', birthDateEstimated: false, profile: normalizeProfile({}), deadlines: normalizeDeadlines({}) };
  const profile = currentProfile(current);
  const name = clean(body.name, 40) || current.name;
  if (!name) fail('请填写长者称呼');
  let birthDate = current.birthDate || '';
  let birthDateEstimated = current.birthDateEstimated === true;
  let age;
  if (clean(body.birthDate, 10)) {
    birthDate = date(body.birthDate);
    age = calculateAge(birthDate);
    birthDateEstimated = body.birthDateEstimated === true;
  } else {
    age = body.age === undefined ? profile.age : body.age;
    if (!Number.isInteger(age)) fail('年龄须为整数');
    if (birthDate && body.age === undefined) age = calculateAge(birthDate) ?? age;
    else if (!birthDate || calculateAge(birthDate) !== age || body.reestimateBirthDate === true) {
      birthDate = estimateBirthDate(age);
      birthDateEstimated = true;
    }
  }
  if (!Number.isInteger(age) || age < 60 || age > 130) fail('年龄须为 60 至 130 岁，或填写对应的有效出生日期');
  const living = body.living === undefined ? profile.living : body.living;
  const mobility = body.mobility === undefined ? profile.mobility : body.mobility;
  if (!['独居', '与家人同住', '空巢'].includes(living) || !['自理', '行动不便', '失能'].includes(mobility)) fail('请选择有效的居住和自理情况');
  return {
    name,
    birthDate,
    birthDateEstimated,
    profile: {
      ...profile,
      age,
      district: body.district === undefined ? profile.district : clean(body.district, 30),
      local: typeof body.local === 'boolean' ? body.local : profile.local,
      living,
      mobility,
      chronic: typeof body.chronic === 'boolean' ? body.chronic : profile.chronic,
      needs: Array.isArray(body.needs) ? services.home.slice(1).filter(kind => body.needs.includes(kind)) : profile.needs
    }
  };
}

function checkupAdvice(data, resident, option, includeHealth = true) {
  if (!includeHealth) return '已按所选项目和低峰名额提供预约建议；年龄、慢病和既往体检建议需在相应授权范围内显示。具体准备事项以社区卫生机构告知为准。';
  const profile = currentProfile(resident);
  const age = calculateAge(resident?.birthDate) ?? profile.age;
  const records = data.cases.filter(item => item.elderId === resident?.id && item.type === 'checkup' && done.includes(item.status));
  const latest = records.slice().sort((a, b) => String(b.date || b.updatedAt || '').localeCompare(String(a.date || a.updatedAt || '')))[0];
  const parts = [];
  if (Number.isInteger(age)) {
    if (option === '免费老年体检') parts.push(`档案年龄 ${age} 岁，可向社区咨询免费老年体检的适用条件，是否免费仍以当地政策和卫生机构答复为准`);
    else parts.push(`档案年龄 ${age} 岁，请结合行动和自理情况安排陪同，优先选择有名额的低峰时段`);
  } else parts.push('档案缺少可计算年龄的出生日期，请先由社区核对档案');
  if (option.includes('慢病') || profile.chronic) parts.push('档案有慢病关注或本次选择慢病项目，建议携带既往随访和用药资料；本建议不构成诊断');
  if (latest) parts.push(`档案已有 ${records.length} 条已办结体检记录，最近预约日期为 ${latest.date || '未记录'}，可携带既往报告供医生参考`);
  else parts.push('当前没有已办结体检记录，可按社区通知安排首次或年度体检');
  return parts.join('；') + '。以上仅为本地预约建议，不替代卫生机构意见。';
}

function updateDeadline(owner, item) {
  if (!owner || !['annual', 'subsidy', 'checkup'].includes(item.type)) return false;
  const chronic = String(item.option || '').includes('慢病') || String(item.project || '').includes('慢病');
  const cycle = item.type === 'annual' ? policies.cycles.annual : item.type === 'subsidy' ? policies.cycles.subsidy : chronic ? policies.cycles.chronicCheckup : policies.cycles.checkup;
  owner.deadlines[item.type] = day(cycle);
  return true;
}

function mutate(account, action, body, currentToken) {
  const next = structuredClone(db);
  const { role, elderId } = account;
  const resident = next.residents.find(entry => entry.id === elderId);
  const admin = role === 'community';
  const elder = role === 'elder';
  let revokeAccountId = '';
  let revokeExceptToken = '';
  const communityActions = new Set(['review', 'resource', 'visit', 'settings', 'resident', 'account', 'resolve', 'result', 'reassign', 'password', 'resetPassword']);
  const elderActions = new Set(['apply', 'family', 'profile', 'rate', 'password']);
  const familyActions = new Set(['apply', 'rate', 'password']);
  if (admin && !communityActions.has(action)) fail('社区账号不能执行该个人操作', 403);
  if (elder && !elderActions.has(action)) fail('老人账号不能执行该社区操作', 403);
  if (role === 'family' && !familyActions.has(action)) fail('家属账号不能执行该操作', 403);
  if (!admin && !elder && role !== 'family') fail('当前角色无法执行该操作', 403);

  if (action === 'apply') {
    if (!resident || !(elder || (role === 'family' && resident.family.proxy))) fail('需要长者授权代办', 403);
    const { type } = body;
    if (!Object.hasOwn(services, type) || !services[type].slice(1).includes(body.option)) fail('请选择办理项目');
    const at = new Date().toISOString();
    const record = {
      id: newId(),
      elderId: resident.id,
      name: clean(body.name, 40) || resident.name,
      type,
      option: body.option,
      by: role,
      byAccount: account.id,
      status: '待社区审核',
      note: clean(body.note),
      history: [],
      createdAt: at,
      updatedAt: at
    };
    if (type === 'subsidy') record.eligibility = subsidyEligibility(resident);
    if (type === 'home' || type === 'checkup') {
      record.date = date(body.date);
      record.slot = clean(body.slot, 5);
      if (!slots.includes(record.slot) || Date.parse(record.date + 'T' + record.slot + ':00+08:00') <= Date.now()) fail('请选择尚未开始的时段');
      if (record.date > day(366)) fail('预约日期不能超过今天起 366 天');
      if (next.cases.some(item => item.elderId === resident.id && item.type === type && item.option === record.option && item.date === record.date && item.slot === record.slot && active.includes(item.status))) fail('已有相同事项正在办理', 409);
      const requestedResourceId = clean(body.resourceId || body.resource, 100);
      if (type === 'home') {
        const resource = requestedResourceId ? next.resources.find(item => item.id === requestedResourceId && item.enabled && resourceMatches(item, type, record.option)) : recommend(next, currentProfile(resident)).find(item => item.kind === record.option);
        if (!resource) fail('该服务当前无可用资源，请选择其他项目', 409);
        if (resourceBookingCount(next, type, record.date, record.slot, resource.id) >= resource.capacity) fail('该资源此时段已约满，请选择其他时段', 409);
        record.resourceId = resource.id;
        record.resourceName = resource.name;
        record.resource = resource.name;
        record.resourceAvailable = true;
      } else {
        let selectedResource = null;
        if (requestedResourceId) {
          selectedResource = next.resources.find(item => item.id === requestedResourceId && item.enabled && resourceMatches(item, type, record.option));
          if (!selectedResource) fail('该体检资源当前不可预约', 409);
          record.resourceId = selectedResource.id;
          record.resourceName = selectedResource.name;
          record.resource = selectedResource.name;
        }
        const booked = selectedResource ? resourceBookingCount(next, type, record.date, record.slot, selectedResource.id) : next.cases.filter(item => item.type === 'checkup' && item.date === record.date && item.slot === record.slot && active.includes(item.status)).length;
        if (booked >= (selectedResource?.capacity || policies.capacities.checkup)) fail('这个时段已约满，请选择其他时段', 409);
        record.resourceAvailable = true;
        record.project = record.option;
        record.advice = checkupAdvice(next, resident, record.option, elder || resident.family.health === true);
      }
    } else if (next.cases.some(item => item.elderId === resident.id && item.type === type && item.option === record.option && active.includes(item.status))) fail('已有相同事项正在办理', 409);
    if (body.attachment && ['annual', 'subsidy'].includes(type)) record.attachment = attachment(body.attachment);
    record.history.push({ status: record.status, at, by: account.username, byAccount: account.id, role });
    next.cases.unshift(record);
  } else if (action === 'family') {
    const linked = next.accounts.find(item => item.role === 'family' && item.elderId === elderId);
    if (!linked) fail('请先由社区开通关联家属账号');
    if (linked.username !== clean(body.username).toLowerCase()) fail('家属关联账号与当前档案不匹配', 403);
    const updated = { view: body.view === true, proxy: body.proxy === true, health: body.health === true, phone: phone(body.phone) };
    const changed = ['view', 'proxy', 'health'].some(key => resident.family[key] !== updated[key]);
    resident.family = { ...resident.family, ...updated };
    if (changed) {
      const at = new Date().toISOString();
      resident.familyHistory ||= [];
      resident.familyHistory.push({ id: newId(), by: account.username, byAccount: account.id, at, view: updated.view, proxy: updated.proxy, health: updated.health, permissions: { view: updated.view, proxy: updated.proxy, health: updated.health } });
      resident.updatedAt = at;
    }
  } else if (action === 'profile') {
    if (!resident) fail('长者档案不存在', 404);
    Object.assign(resident, profileFromBody(body, resident));
    resident.updatedAt = new Date().toISOString();
    recordAudit(next, 'profile', resident.id, account, { fields: ['profile'] });
  } else if (action === 'review') {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (!ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length || !['next', 'reject'].includes(body.decision)) fail('请选择要处理的工单和操作');
    if (!isObject(body.expected)) fail('缺少工单状态校验，请刷新后重试');
    const review = clean(body.note, 500);
    for (const id of ids) {
      const item = next.cases.find(entry => entry.id === id);
      if (!item || !Object.hasOwn(body.expected, id) || body.expected[id] !== item.status) fail('工单状态已变更，请刷新', 409);
      if (!active.includes(item.status)) fail('工单状态已变更，请刷新', 409);
      const flow = flows[item.type];
      const index = Array.isArray(flow) ? flow.indexOf(item.status) : -1;
      if (index < 0 || body.decision === 'next' && index >= flow.length - 1) fail('工单流程状态无效', 409);
      if (body.decision === 'reject' && (item.status !== '待社区审核' || !review)) fail('仅能退回待审核工单，且须填写原因');
      if (body.decision === 'next' && ['home', 'checkup'].includes(item.type) && !caseResourceAvailable(next, item)) fail('关联资源已下架或不匹配，请先改派', 409);
      if (body.decision === 'next' && item.type === 'home' && item.status === '已确认') fail('请先填写上门服务完成说明', 409);
      const at = new Date().toISOString();
      item.status = body.decision === 'reject' ? '已退回' : flow[index + 1];
      item.history ||= [];
      item.history.push({ status: item.status, at, note: review, by: account.username, byAccount: account.id, role });
      item.updatedAt = at;
      const owner = next.residents.find(entry => entry.id === item.elderId);
      if (done.includes(item.status) && updateDeadline(owner, item)) recordAudit(next, 'deadline', owner.id, account, { caseId: item.id, type: item.type });
      recordAudit(next, body.decision === 'reject' ? 'reject' : 'review', item.id, account, { status: item.status, note: review, elderId: item.elderId });
    }
  } else if (action === 'reassign') {
    const item = next.cases.find(entry => entry.id === clean(body.id, 100));
    if (!item || !['home', 'checkup'].includes(item.type) || !['待社区审核', '已确认'].includes(item.status)) fail('仅可改派待审核或已确认的预约工单', 409);
    if (body.expected !== item.status) fail('工单状态已变更，请刷新', 409);
    const resource = next.resources.find(entry => entry.id === clean(body.resourceId, 100));
    if (!resource || !resource.enabled || !resourceMatches(resource, item.type, item.option)) fail('请选择启用且匹配该预约的资源', 409);
    if (resourceBookingCount(next, item.type, item.date, item.slot, resource.id, item.id) >= resource.capacity) fail('新资源此时段已约满，请选择其他资源或时段', 409);
    const at = new Date().toISOString();
    const previousResourceId = item.resourceId || '';
    const previousResourceName = item.resourceName || item.resource || '';
    item.resourceId = resource.id;
    item.resourceName = resource.name;
    item.resource = resource.name;
    item.resourceAvailable = true;
    item.history ||= [];
    item.history.push({ status: item.status, at, note: `预约资源由 ${previousResourceName || '未关联资源'} 改派至 ${resource.name}`, by: account.username, byAccount: account.id, role, action: 'reassign', previousResourceId, previousResourceName, resourceId: resource.id, resourceName: resource.name });
    item.updatedAt = at;
    recordAudit(next, 'reassign', item.id, account, { previousResourceId, resourceId: resource.id, status: item.status });
  } else if (action === 'resource') {
    const resource = body.id ? next.resources.find(item => item.id === body.id) : null;
    if (body.id && !resource) fail('资源不存在', 404);
    const at = new Date().toISOString();
    let auditedResource = resource;
    if (resource) {
      if (body.name !== undefined) {
        const name = clean(body.name, 40);
        if (!name) fail('请填写资源名称');
        resource.name = name;
      }
      if (body.kind !== undefined) {
        if (![...services.home.slice(1), ...services.checkup.slice(1)].includes(body.kind)) fail('请选择有效的资源类型');
        resource.kind = body.kind;
      }
      if (body.category !== undefined) resource.category = clean(body.category, 40);
      if (body.projects !== undefined) {
        if (!Array.isArray(body.projects) || body.projects.some(item => typeof item !== 'string')) fail('资源项目格式错误');
        resource.projects = body.projects.map(item => clean(item, 40)).filter(Boolean);
      }
      for (const key of ['x', 'y', 'fee']) {
        if (body[key] === undefined) continue;
        if (!Number.isFinite(body[key]) || key !== 'fee' && Math.abs(body[key]) > 20 || key === 'fee' && (body[key] < 0 || body[key] > 100000)) fail('请检查资源坐标和费用');
        resource[key] = body[key];
      }
      if (body.capacity !== undefined) {
        if (!Number.isInteger(body.capacity) || body.capacity < 1 || body.capacity > 10000) fail('资源容量须为 1 至 10000 的整数');
        resource.capacity = body.capacity;
      }
      if (body.enabled !== undefined) resource.enabled = body.enabled === true;
      if (body.phone !== undefined) resource.phone = phone(body.phone);
      if (body.address !== undefined) resource.address = clean(body.address, 200);
      resource.category ||= resource.kind;
      resource.projects = Array.isArray(resource.projects) && resource.projects.length ? resource.projects : [resource.kind];
      resource.coordinatesDemo = true;
      resource.updatedAt = at;
    } else {
      const name = clean(body.name, 40);
      if (!name || ![...services.home.slice(1), ...services.checkup.slice(1)].includes(body.kind) || ![body.x, body.y, body.fee].every(Number.isFinite) || Math.abs(body.x) > 20 || Math.abs(body.y) > 20 || body.fee < 0 || body.fee > 100000) fail('请检查资源名称、类型、坐标和费用');
      if (body.capacity !== undefined && (!Number.isInteger(body.capacity) || body.capacity < 1 || body.capacity > 10000)) fail('资源容量须为 1 至 10000 的整数');
      auditedResource = normalizeResource({ id: newId(), name, kind: body.kind, category: clean(body.category, 40) || body.kind, projects: Array.isArray(body.projects) ? body.projects : [body.kind], x: body.x, y: body.y, fee: body.fee, enabled: body.enabled !== false, capacity: body.capacity || defaultCapacity(body.kind), phone: phone(body.phone), address: clean(body.address, 200), createdAt: at, updatedAt: at });
      next.resources.push(auditedResource);
    }
    recordAudit(next, 'resource', auditedResource.id, account, { operation: resource ? body.enabled !== undefined ? 'update-or-toggle' : 'update' : 'create', fields: Object.keys(body).filter(key => !['action', 'id'].includes(key)), enabled: auditedResource.enabled });
  } else if (action === 'visit') {
    const note = clean(body.note, 500);
    if (!note) fail('请填写探访或关怀记录');
    if (!next.residents.some(entry => entry.id === body.elderId)) fail('请选择老人档案');
    if (body.type !== undefined && !['探访', '关怀'].includes(body.type)) fail('请选择有效的记录类型');
    const at = new Date().toISOString();
    const recordDate = body.date === undefined || body.date === '' ? day() : date(body.date);
    next.visits.unshift({ id: newId(), elderId: body.elderId, type: body.type || '探访', by: account.username, byAccount: account.id, at, date: recordDate, note, createdAt: at, updatedAt: at });
  } else if (action === 'settings') {
    const changedFields = [];
    if (body.hotline !== undefined) {
      next.hotline = phone(body.hotline);
      changedFields.push('hotline');
    }
    const target = next.residents.find(entry => entry.id === body.elderId);
    if (!target) fail('请选择老人档案');
    const values = isObject(body.deadlines) ? { ...body.deadlines, ...body } : body;
    for (const type of ['annual', 'subsidy', 'checkup']) {
      if (values[type] === undefined) continue;
      target.deadlines[type] = values[type] === '' ? '' : date(values[type]);
      changedFields.push(type);
    }
    const welfare = isObject(values.welfare) ? values.welfare : null;
    if (welfare) {
      target.deadlines.welfare ||= {};
      for (const [rawKey, value] of Object.entries(welfare)) {
        const key = clean(rawKey, 40);
        if (!key || ['__proto__', 'prototype', 'constructor'].includes(key)) fail('福利期限名称无效');
        target.deadlines.welfare[key] = value === '' ? '' : date(value);
      }
      changedFields.push('welfare');
    }
    target.updatedAt = new Date().toISOString();
    recordAudit(next, 'settings', target.id, account, { fields: changedFields, elderId: target.id });
  } else if (action === 'resident') {
    const targetId = clean(body.id || body.residentId || body.elderId, 100);
    const target = targetId ? next.residents.find(entry => entry.id === targetId) : null;
    if (targetId && !target) fail('长者档案不存在', 404);
    const at = new Date().toISOString();
    let auditedTarget = target;
    if (target) {
      Object.assign(target, profileFromBody(body, target));
      if (isObject(body.deadlines)) {
        for (const type of ['annual', 'subsidy', 'checkup']) if (body.deadlines[type] !== undefined) target.deadlines[type] = body.deadlines[type] === '' ? '' : date(body.deadlines[type]);
        if (isObject(body.deadlines.welfare)) for (const [key, value] of Object.entries(body.deadlines.welfare)) {
          if (!clean(key, 40) || ['__proto__', 'prototype', 'constructor'].includes(key)) fail('福利期限名称无效');
          target.deadlines.welfare[key] = value === '' ? '' : date(value);
        }
      }
      target.updatedAt = at;
    } else {
      const created = profileFromBody(body, null);
      const deadlines = normalizeDeadlines(body.deadlines);
      for (const type of ['annual', 'subsidy', 'checkup']) {
        const value = body[type] !== undefined ? body[type] : deadlines[type];
        deadlines[type] = value === '' || value === undefined ? '' : date(value);
      }
      if (isObject(body.welfare)) for (const [key, value] of Object.entries(body.welfare)) {
        if (!clean(key, 40) || ['__proto__', 'prototype', 'constructor'].includes(key)) fail('福利期限名称无效');
        deadlines.welfare[key] = value === '' ? '' : date(value);
      }
      auditedTarget = { id: newId(), ...created, family: { view: false, proxy: false, health: false, phone: '' }, familyHistory: [], deadlines, createdAt: at, updatedAt: at };
      next.residents.push(auditedTarget);
    }
    recordAudit(next, 'resident', auditedTarget.id, account, { operation: target ? 'update' : 'create', fields: target && !isObject(body.deadlines) ? ['profile'] : ['profile', 'deadlines'] });
  } else if (action === 'account') {
    const target = next.residents.find(entry => entry.id === body.elderId);
    if (!target || !['elder', 'family'].includes(body.role)) fail('请选择档案和账号身份');
    const created = createAccount(next, body, body.role, target.id);
    if (body.role === 'family' && !target.familyHistory?.length) {
      const at = new Date().toISOString();
      target.family = { ...normalizeFamily(target.family), view: false, proxy: false, health: false };
      target.familyHistory = [{ id: newId(), by: account.username, byAccount: account.id, at, view: false, proxy: false, health: false, permissions: { view: false, proxy: false, health: false }, status: '待长者重新授权', note: '旧版家属权限已重置，待长者重新授权', pending: true }];
      target.updatedAt = at;
    }
    recordAudit(next, 'account', created.id, account, { role: created.role, elderId: target.id });
  } else if (action === 'password') {
    const target = next.accounts.find(entry => entry.id === account.id);
    if (!target || !verifyPassword(target, body.oldPassword)) fail('旧密码不正确', 403);
    setPassword(target, validPassword(body.newPassword));
    recordAudit(next, 'password', target.id, account, { role: target.role });
    revokeAccountId = target.id;
    revokeExceptToken = currentToken || '';
  } else if (action === 'resetPassword') {
    const username = clean(body.username).toLowerCase();
    const target = next.accounts.find(entry => entry.username === username && ['elder', 'family'].includes(entry.role) && next.residents.some(resident => resident.id === entry.elderId));
    if (!target) fail('本档案账号不存在', 404);
    setPassword(target, validPassword(body.newPassword));
    recordAudit(next, 'resetPassword', target.id, account, { role: target.role, elderId: target.elderId });
    revokeAccountId = target.id;
    revokeExceptToken = '';
  } else if (action === 'resolve') {
    const id = clean(body.id, 160);
    const note = clean(body.note, 500);
    if (!note) fail('请填写服务超时预警的处置说明');
    if (isResolved(next, id)) fail('该预警已处置，不能重复核销', 409);
    const alert = reminders(next).find(item => item.id === id && item.level === '服务超时');
    if (!alert) fail('仅可核销当前未处置的服务超时预警');
    next.resolved.push({ id: alert.id, elderId: alert.elderId, caseId: alert.caseId || alert.id, by: account.username, byAccount: account.id, at: new Date().toISOString(), note });
  } else if (action === 'result') {
    const item = next.cases.find(entry => entry.id === body.id);
    if (item?.type === 'checkup' && item.status === '已完成') {
      const report = clean(body.note, 500);
      if (!report) fail('请填写示例报告摘要');
      if (item.report && body.overwrite !== true && body.confirmOverwrite !== true) fail('已有体检报告，须明确确认后才能修改', 409);
      const at = new Date().toISOString();
      item.reportHistory ||= [];
      if (item.report && !item.reportHistory.length) item.reportHistory.push({ report: item.report, source: item.reportSource || '', by: item.reportBy || '', byAccount: item.reportByAccount || '', at: item.reportAt || item.updatedAt || '', legacy: true });
      item.report = report;
      item.reportSource = reportSource;
      item.reportBy = account.username;
      item.reportByAccount = account.id;
      item.reportAt = at;
      item.reportHistory.push({ report, source: reportSource, by: account.username, byAccount: account.id, at });
      item.updatedAt = at;
    } else if (item?.type === 'home' && (item.status === '已确认' || item.status === '已完成' && !item.serviceResult)) {
      if (item.status === '已确认' && !caseResourceAvailable(next, item)) fail('关联资源已下架或不匹配，请先改派', 409);
      const note = clean(body.note, 500);
      if (!note) fail('请填写服务完成说明，照片可选');
      if (body.attachment) item.evidence = attachment(body.attachment);
      const at = new Date().toISOString();
      const legacy = item.status === '已完成';
      item.serviceResult = { note, at, by: account.username, byAccount: account.id, source: reportSource };
      item.status = '已完成';
      item.history ||= [];
      item.history.push({ status: legacy ? '补录服务结果' : item.status, at, note, by: account.username, byAccount: account.id, role });
      item.updatedAt = at;
      updateDeadline(next.residents.find(entry => entry.id === item.elderId), item);
    } else fail('工单状态不支持录入结果', 409);
  } else if (action === 'rate') {
    const item = next.cases.find(entry => entry.id === body.id && entry.elderId === elderId && entry.type === 'home' && done.includes(entry.status));
    const allowed = elder || role === 'family' && resident?.family.proxy === true && item?.byAccount === account.id;
    if (!item || !allowed || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) fail('请选择自己可评价的有效服务工单');
    item.rating = body.rating;
    item.ratingBy = account.username;
    item.ratingByAccount = account.id;
    item.ratedAt = new Date().toISOString();
    item.updatedAt = item.ratedAt;
  } else fail('当前角色无法执行该操作', 403);
  save(next);
  if (revokeAccountId) for (const [sessionToken, session] of sessions) {
    if (session.accountId === revokeAccountId && sessionToken !== revokeExceptToken) sessions.delete(sessionToken);
  }
}

function attachment(value) {
  if (typeof value !== 'string' || value.length > 1000000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) fail('请选择可压缩的演示图片');
  return value;
}

const assets = {
  '/': ['yanglao.html', 'text/html'], '/index.html': ['yanglao.html', 'text/html'],
  '/yanglao.html': ['yanglao.html', 'text/html'],
  '/assets/elder-community-home.jpg': ['assets/elder-community-home.jpg', 'image/jpeg'],
  '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css']
};

async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail('需要 JSON 请求', 415);
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1100000) fail('请求内容过大', 413);
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail('请求格式错误'); }
  if (!isObject(body)) fail('请求格式错误');
  return body;
}

function json(res, payload, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function attemptKey(username, req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return username + '|' + (forwarded || req.socket.remoteAddress || 'local');
}

function checkLoginRate(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (entry?.blockedUntil > now) fail('登录失败次数过多，请稍后再试', 429);
  if (entry && now - entry.firstAt > 600000) loginAttempts.delete(key);
}

function recordLoginFailure(key) {
  const now = Date.now();
  const previous = loginAttempts.get(key);
  const entry = previous && now - previous.firstAt <= 600000 ? previous : { firstAt: now, failures: 0, blockedUntil: 0 };
  entry.failures += 1;
  if (entry.failures >= 5) entry.blockedUntil = now + 600000;
  loginAttempts.set(key, entry);
  if (loginAttempts.size > 1000) {
    for (const [storedKey, value] of loginAttempts) if (value.blockedUntil <= now && now - value.firstAt > 600000) loginAttempts.delete(storedKey);
    while (loginAttempts.size > 1000) loginAttempts.delete(loginAttempts.keys().next().value);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const allowedHosts = ['127.0.0.1:' + port, 'localhost:' + port, '[::1]:' + port];
    if (publicHost) allowedHosts.push(publicHost, publicHost + ':80', publicHost + ':443');
    if (!allowedHosts.includes(String(req.headers.host || '').toLowerCase())) fail('仅开放本机访问', 403);
    const originHeader = req.headers.origin;
    const originAllowed = !originHeader
      || originHeader === 'http://' + req.headers.host
      || (publicHost && originHeader === 'https://' + req.headers.host);
    if (!originAllowed) fail('请求来源不受支持', 403);
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { fail('请求地址无效'); }
    if (req.method === 'GET' && Object.hasOwn(assets, url.pathname)) {
      const [name, type] = assets[url.pathname];
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(path.join(__dirname, name)));
      return;
    }
    const token = req.headers.cookie?.match(/(?:^|; )nuanlin=([^;]+)/)?.[1];
    if (req.method === 'GET' && url.pathname === '/api/health') {
      json(res, { name: 'nuanlin', build });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/setup') {
      json(res, { required: Boolean(setupCode), build });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/setup') {
      const body = await readBody(req);
      if (!setupCode || body.code !== setupCode) fail('初始化码无效或初始化已完成', 403);
      const next = structuredClone(db);
      const created = createAccount(next, body, 'community');
      recordAudit(next, 'account', created.id, created, { role: 'community' });
      save(next);
      setupCode = '';
      json(res, { required: false, build });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      sessions.delete(token);
      res.setHeader('Set-Cookie', 'nuanlin=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/');
      json(res, { ok: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/session') {
      const body = await readBody(req);
      const { username, password } = accountFields(body);
      if (body.portal !== undefined && !['elder', 'family', 'community'].includes(body.portal)) fail('登录端口无效');
      const key = attemptKey(username, req);
      checkLoginRate(key);
      const account = db.accounts.find(entry => entry.username === username);
      const verified = verifyPassword(account, password);
      if (!verified) {
        recordLoginFailure(key);
        fail('账号或密码不正确', 401);
      }
      if (body.portal !== undefined && account.role !== body.portal) fail('账号与所选端口不匹配', 403);
      loginAttempts.delete(key);
      sessions.delete(token);
      if (sessions.size >= 200) sessions.delete(sessions.keys().next().value);
      const sessionToken = newId();
      sessions.set(sessionToken, { accountId: account.id, expires: Date.now() + 8 * 3600000 });
      res.setHeader('Set-Cookie', 'nuanlin=' + sessionToken + '; Max-Age=28800; HttpOnly; SameSite=Strict; Path=/' + (secureCookies ? '; Secure' : ''));
      json(res, snapshot(account));
      return;
    }
    const session = sessions.get(token);
    const account = session?.expires > Date.now() && db.accounts.find(entry => entry.id === session.accountId);
    if (!account) {
      sessions.delete(token);
      if (req.method === 'GET' && url.pathname === '/api/state') {
        json(res, { error: '请先登录', build }, 401);
        return;
      }
      fail('请先登录', 401);
    }
    if (req.method === 'GET' && url.pathname === '/api/state') json(res, snapshot(account, url.searchParams.get('date'), url.searchParams.get('elderId')));
    else if (req.method === 'POST' && url.pathname === '/api/tts') {
      if (account.role === 'community') fail('社区端不提供语音朗读', 403);
      const body = await readBody(req);
      if (sessions.get(token) !== session || session.expires <= Date.now()) fail('登录已失效，请重新登录', 401);
      const text = clean(body.text, 1200);
      if (!text) fail('朗读内容为空');
      let audio;
      try { audio = await synthesizeSpeech(text, body.speed); }
      catch (error) { console.error('语音合成失败', error.message); fail('语音服务暂不可用，请稍后重试', 502); }
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length, 'Cache-Control': 'no-store' });
      res.end(audio);
    }
    else if (req.method === 'POST' && url.pathname === '/api/action') {
      const body = await readBody(req);
      if (sessions.get(token) !== session || session.expires <= Date.now()) fail('登录已失效，请重新登录', 401);
      mutate(account, body.action, body, token);
      json(res, snapshot(account));
    } else fail('找不到此页面', 404);
  } catch (error) {
    if (!error.status) console.error(error);
    json(res, { error: error.status ? error.message : '保存或读取失败，请检查本地服务' }, error.status || 500);
  }
});

if (require.main === module) {
  server.listen(port, bindHost, () => {
    console.log('暖邻服务 http://' + bindHost + ':' + port + '/yanglao.html');
    if (setupCode) console.log('在网页创建首个社区账号时输入本次启动的初始化码：' + setupCode);
  });
}

module.exports = { calculateAge, estimateBirthDate, subsidyEligibility, migrate };
