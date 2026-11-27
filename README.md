# 暖邻 · 便民养老与适老化智能服务平台

本项目是本地浏览器应用，老人、家属和社区使用各自账号登录，无需安装 App。保留原生 HTML/CSS/JavaScript 与 Node.js 单文件服务端，不需要 npm 依赖。

> 当前交付是“可验证的本地业务流程 + 明确标注的演示数据”，不是已经连接民政、支付、卫生机构或地图厂商的生产系统。

## 1. 启动与访问

环境要求：Node.js 22 或更新版本，本次实际使用 Node.js 24.22.3。老人端和家属端朗读需要本机 VoiceStudio 0.5.8 运行在 `http://127.0.0.1:3900`，并使用已保存声音“1”；可用环境变量 `VOICE_STUDIO_URL`、`VOICE_STUDIO_VOICE` 覆盖。VoiceStudio 未运行时页面自动回退浏览器语音，其他业务不受影响。

### 推荐方式

1. 双击本目录 `start.cmd`。
2. 启动器检查 Node.js，默认使用 `node server.js` 启动，并在服务就绪后打开浏览器。
3. 保留启动终端；停止服务时按 `Ctrl+C`。
4. 默认地址：<http://127.0.0.1:8765/yanglao.html>。
5. 如果 8765 被其他项目占用，启动器会寻找后续空闲端口，以终端显示的实际地址为准；启动器同时核对静态文件、`/api/health` 和后端构建版本，不会把其他项目或旧后端误认成当前新版。

也可在本目录执行：

```bat
node server.js
```

服务默认只监听 `127.0.0.1`。云端部署时由 Nginx 反向代理到 Node 服务，设置 `NUANLIN_BIND_HOST=127.0.0.1`；直接双击 HTML 不会登录或保存数据。

### 指定端口和隔离数据

Windows 命令提示符示例：

```bat
set NUANLIN_PORT=8876
set NUANLIN_DATA=C:\Users\Q\Desktop\比赛\创新\tools\manual-isolated-data.json
node server.js
```

PowerShell 示例：

```powershell
$env:NUANLIN_PORT = "8876"
$env:NUANLIN_DATA = "C:\Users\Q\Desktop\比赛\创新\tools\manual-isolated-data.json"
node server.js
```

未设置 `NUANLIN_DATA` 时使用项目根目录的 `nuanlin-data.json`。

## 2. 账号初始化与授权

- 数据里已有有效社区账号时，登录页直接提供老人端、家属端、社区端入口，不需要初始化码。
- 没有社区账号时，终端会打印本次进程随机生成的初始化码。请在初始化网页输入该码并设置正式社区管理员账号和密码；文档不保存固定初始化码或正式密码。
- 初始化只创建社区账号。社区登录后建立长者档案，再分别开通老人和家属账号。
- 新关联家属账号的查看、代办、健康报告权限默认关闭。旧版家属权限也需要长者针对新关联账号重新授权。
- 三项权限互不替代：
  - `view`：查看进度、探访和关怀记录；
  - `proxy`：代办、上传材料、跟踪本人提交工单及评价本人代办服务；
  - `health`：单独查看体检报告和健康敏感详情。
- 撤销后，服务端立即收缩返回数据并拒绝越权操作。修改或重置密码会使相应旧会话失效；服务重启后所有用户需要重新登录。

## 3. 数据、备份与旧版迁移

正式数据：`nuanlin-data.json`。本次修改前备份：

`C:\Users\Q\Desktop\比赛\创新\nuanlin-data.backup-20261125-final.json`

备份与修改前正式 JSON 已通过深度一致性校验；隔离验收前后正式文件 SHA-256 均为：

`37a2465ae9ae1dd4bc797a8a9976aa4b4fe394417d3144796c0f98ab5f5dbe48`

当前数据结构为 `schemaVersion: 2`，主要包括：

- `residents`：多位长者、画像、家属授权历史和个人期限；
- `accounts`：独立角色账号、档案关联及 scrypt 密码散列；
- `cases`：四类业务、称呼、资源、状态、历史、完成说明、评分和报告；
- `resources`：类别、项目、费用、电话、地址、容量、坐标和上下架状态；
- `visits`、`resolved`、`auditLog`：探访关怀、预警处置和审计台账。

迁移规则：

- 旧版顶层 `profile`、`family`、`deadlines` 会迁入长者档案；
- 旧工单和探访记录按旧档案归属迁移，保留原 ID、状态和历史；
- 新关联家属账号时重置旧家属授权，等待长者重新授权；
- 已下架资源只补齐缺失字段，不会因重启或迁移被自动重新上架；
- 保存使用临时文件写入后重命名，业务数据持久化，登录会话仅保存在内存中。

恢复备份前请先停止服务，并另存当前正式文件，避免误覆盖后续业务数据。

## 4. 已实现和本地验证范围

- 适老化：老人端为暖色长辈版，正文 21–24px、主要标题 40px 以上、主要按钮 22px、触控区域至少 60px，单列大卡片、整卡可点、无装饰照片；家属端正文 20px、主要标题 24px；社区端标准正文为 16px；三档字号、标准/夜间/高对比度、本地保存和一键重置；电脑与 390px 手机布局。
- 语音：老人和家属端所有朗读（页面摘要、表单、进度、审核、退回原因、政策、报告摘要、资源推荐理由、提醒）统一调用本机 VoiceStudio 已保存的声音“1”（OmniVoice 零样本克隆，`http://127.0.0.1:3900`），支持暂停、继续、重播和语速；VoiceStudio 不可用时回退浏览器语音。首页“朗读本页”从当前提醒开始播报。语音识别输入面板已移除。社区端不提供语音朗读入口。
- 四类业务：资格认证、补贴申请与年审、七类居家服务、免费/普惠/慢病体检；包含档案带入、演示资格初审、图片压缩、资源容量、低峰推荐、状态历史和个人期限。
- 居家办结：完成说明必填、照片可选、经办人和时间留痕；单笔和批量均不能跳过，旧已办结工单可补录。
- 家属：三项独立授权、本人代办记录跟踪、报告单独授权、撤权即时生效。
- 资源：按距离、需求、高龄独居、行动/自理情况和本地演示免费资格排序；老人和家属端最多显示 3 条推荐及可朗读理由；社区端推荐预览不显示距离、朗读入口和相对位置示意图；目录、拨号、预约、下架和改派。
- 资源类别可维护食堂、日间照料中心、养老机构、上门照护、义诊和适老化改造。主服务类型决定预约流程，类别和项目由社区维护。
- 提醒与台账：30/7/1 天及逾期提醒、服务超时预警、核查核销、去重、筛选、统计和审计。

### 语音验证边界

- 已实测 `/api/tts` 经本机 VoiceStudio 返回 WAV（RIFF 音频头、约 130KB、热启动约 0.8 秒），页面朗读统一走该接口。
- 音色为 VoiceStudio 已保存的声音“1”（profile `cbaa81a5`，中文、男声、老年、极低音高）；可用 `VOICE_STUDIO_VOICE`、`VOICE_STUDIO_URL` 覆盖。
- 无头环境未进行扬声器听感确认，不能把“实际听到声音”列为已验证。
- VoiceStudio 未运行时自动回退浏览器 `speechSynthesis`；语音识别输入面板已移除，不再提供麦克风转写。

## 5. 隔离验收

不需要安装测试依赖。先执行业务验收，再执行浏览器验收：

```bat
node tools\acceptance.cjs
node tools\browser-acceptance.cjs
```

业务验收使用随机空闲端口和 `tools/acceptance-isolated-data.json`，自动启动、停止并两次重启测试服务，包含 17 组断言。报告：

`tools/acceptance-report.json`

浏览器验收使用另一份 `tools/browser-isolated-data.json`，调用本机 Edge 调试协议，完成后关闭测试浏览器和服务，包含 11 组实际操作（含真实浏览器图片压缩与 VoiceStudio 音色1 朗读接口）。报告和截图：

- `tools/browser-acceptance-report.json`
- `tools/browser-desktop-home.png`
- `tools/browser-family-home.png`
- `tools/browser-desktop-form.png`
- `tools/browser-mobile-home.png`
- `tools/browser-mobile-form.png`
- `tools/browser-community.png`
- `tools/browser-mobile-login.png`

测试账号只存在于隔离数据：`community_test`、`elder_a_test`、`elder_b_test`、`family_a_test`，统一虚构测试密码为 `Test-Only-2026!`。不要把这些账号当作正式账号，也不要把正式启动的 `NUANLIN_DATA` 指向验收文件。

浏览器验收依赖本机 Edge 路径：

`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`

若 Edge 安装位置不同，需要调整 `tools/browser-acceptance.cjs` 中的 `edge` 路径。

## 6. 外部服务接入状态

当前未检测到 `NUANLIN_` 外部服务环境变量。实名、短信、人脸、OCR、补贴支付、卫生报告、地图导航和外部推送均没有真实服务响应验证，全部不得报告为真实接入成功。

| 能力 | 当前可验证实现 | 尚未验证/缺少的条件 |
| --- | --- | --- |
| 实名、短信、人脸 | 社区人工核验和本地申请留痕 | 对应厂商接口、凭证、用户授权、签名/回调和真实响应 |
| OCR | 拍照、选图、家属代传、浏览器 JPEG 压缩、人工核对 | OCR 端点、凭证、字段映射及识别结果核对流程 |
| 补贴支付 | 本地演示状态流转，明确不是实际到账 | 民政/支付接口、发放回执、对账和真实状态映射 |
| 卫生报告 | 社区手工录入并标注“演示”，保留来源和修改历史 | 卫生机构接口、报告授权、签名验签及真实报告响应 |
| 地图导航 | 明示为演示坐标的目录和相对位置图 | 地图 Key、地理编码、合法坐标和导航 URL/API 验证 |
| 外部推送 | 当前登录会话可用的站内提醒 | 短信/推送服务、订阅凭证、跨设备部署和送达回执 |

`NUANLIN_IDENTITY_*`、`NUANLIN_SMS_*`、`NUANLIN_FACE_*`、`NUANLIN_OCR_*`、`NUANLIN_PAYMENT_*`、`NUANLIN_HEALTH_*`、`NUANLIN_MAP_*`、`NUANLIN_PUSH_*` 中的 `URL`、`KEY`、`TOKEN`、`SECRET` 或 `CONFIG` 目前只用于显示“已配置但未验证”。**仅设置这些变量不会发起外部请求，也不会完成接入。** 需要按具体供应商文档补充适配器、错误处理、隐私授权和真实响应验收。

## 7. 主要文件

- `server.js`：本机 HTTP 服务、权限、业务、迁移和持久化；
- `app.js`：三端界面、表单、语音、授权和社区管理；
- `yanglao.html`、`style.css`：入口和适老化响应式样式；
- `start.cmd`、`tools/launch-project.cjs`、`tools/start-project.ps1`：启动入口；
- `tools/acceptance.cjs`：隔离业务验收；
- `tools/browser-acceptance.cjs`：Edge 浏览器验收；
- `启动说明.txt`：快速启动说明。
