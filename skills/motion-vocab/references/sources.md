# 指针索引 · 许可（sources.md）

> 状态：**第一版已建（2026-11-22）**，21 条。许可一栏全部按本地仓库里的 LICENSE / `package.json` / 拆解稿实读，**没读到的写「未查」，不凭印象填**。
> 规则：查不到就明说"索引里没有这条"，然后只用 `words.md` 里的词回答；**不许凭印象报仓库名、文件名或行号**。

## 一、这张表怎么用

上库或搬素材前，先在这里定位来源，只看"许可"列：**无 LICENSE、或只有 PolyForm / Commons-Clause / 收费条款的，只当参考书**——名词、参数、代价、验收可以学，代码片段与素材不进商用产出。

## 二、六列

| 名字 | 类型 | 许可 | 它独有什么 | 看哪里 | 什么任务才值得看 |
|---|---|---|---|---|---|
| `react-bits` | 仓库 | **MIT + Commons Clause**（`LICENSE.md`；不可转售，可自用） | 结构型滚动的默认参数就写死在组件里：`ScrollStack` 的 24 / 100 / 15% / 0.05 / 0.8 / 0.2 / 200 | `工具库\仓库\react-bits\src\tailwind\Components\ScrollStack\ScrollStack.jsx` | 只写「结构型滚动 / 堆叠卡片」时；别拿它当通用动画库翻 |
| `anime.js` v4.5.0 | 仓库 | MIT（`LICENSE.md`，2025 Julian Garnier） | 时间线的 `seek` / `playbackRate` / `stagger` 语义——编排册的八种位置写法就出自这里 | `工具库\仓库\anime-master\dist\bundles\anime.umd.js` | 写「多段落时间线、谁先谁后」时；单段动效用 CSS 就够，别上时间线 |
| `swarm-cursors` | 仓库 | **未查**（仓库内无 LICENSE 文件） | 群体光标的 8 / 48 / 18 / 36 / 4000 / 40000 参数与"移动时长"公式 | `工具库\仓库\swarm-cursors\swarm-rebuild\swarm.js`（公式在第 2576 行附近） | 写群体光标、多人协作光标时；**只学参数，代码不搬** |
| `lenis` | 仓库 | MIT（`LICENSE`，2024 darkroom.engineering） | 平滑滚动的 `lerp` 与时长口径，以及"别和原生滚动抢"的边界 | `工具库\仓库\lenis\src` | 滚动驱动要"手感"而不是"位移"时；只做吸顶/视差不必上 |
| `gsap` 3.12.5 | 仓库 | **Standard "no charge" license，非 MIT**（`package.json` 明写；商用条款回 gsap.com 核） | `ScrollTrigger` 的 `scrub` / `pin` / `snap` 参数语义 | `工具库\仓库\gsap` | 需要 ScrollTrigger 级联参数时只抄参数名与区间；**源码不内联进产出** |
| `react-three-fiber` | 仓库 | MIT（`LICENSE`，2019-2025 Poimandres） | React 里 3D 的组件边界：什么时候该 `useFrame`，什么时候该 `useMemo` | `工具库\仓库\react-three-fiber\packages` | 只有 React 工程才值得看；单页 HTML 用不上 |
| `three.js`（r160 单文件） | 仓库 | MIT（上游声明；**本地副本未带 LICENSE 文件，发布前回官网核一次**） | 唯一能在 `file://` 下直接内联的一版：`build/three.min.js` UMD | `拆解\three-js\build\three.min.js` | 单页 HTML 要真 3D 时；**模块版在 `file://` 会被 CORS 拦，r187 会报重复声明** |
| `vanta` | 仓库 | MIT（`LICENSE.md`，2020 Teng Bao） | "一片会动的背景"的最小集成法：一个 canvas + 一个 effect 名 | `工具库\仓库\vanta\src` | 需要背景特效但不想写 shader 时 |
| `liquid-glass-js` | 仓库 | MIT（`LICENSE`，2025 Armagan Amcalar） | 玻璃/折射的 CSS + canvas 实现，比纯 `backdrop-filter` 多一层位移 | `工具库\仓库\liquid-glass-js` | 质感册里写"玻璃"时；性能预算紧就别上 |
| `ammo.js` | 仓库 | zlib（`LICENSE` 为 zlib 文本） | 刚体与碰撞的最小 API：只有它管"撞"，弹簧不管 | `工具库\仓库\ammo.js-main` | 只有需要真碰撞才看；弹簧/磁吸用不着 |
| `neural-creator-dashboard` | 案例 | **PolyForm-Noncommercial-1.0.0**（`LICENSE` + `NOTICE.md`；`0.1.0` 曾 MIT，已授权不撤回） | 遮罩停点调度 + 弹簧目标表 + 分光复用同一 mp4——13 册的原型 | `拆解\neural-creator-dashboard\neural-creator-dashboard·拆解.md` §一 | 写首屏收放、图网络、分光时；**mp4 与代码都不进商用产出** |
| `m3e-canvas` 0.1.0 | 案例 | 据册 14 母本声明 MIT（lnkiai，2026）；**本地副本无 LICENSE 文件，复用前回 npm 核** | 画布拖拽的落点轴 / 让位轴 / 刻度轴三套参数 | `拆解\m3e-canvas` | 写画布拖拽、画板交互时 |
| `cobalt75 键盘官网（第二期）` | 视频 | **未见 LICENSE** | 响应态的三段式（按下 → 回声 → 落定），只有画面没有源码 | `拆解\cobalt75-键盘官网-第二期` | 写"点下去之后"时；只能学节奏，无参数可抄 |
| `remotion` | 仓库 | **未查**（本地无 LICENSE；上游按团队规模收费，商用前回官网核） | 用 React 定义"第几帧"的能力——视频当组件写 | `拆解\remotion` | 只做宣传片/视频时；**不作为单页册素材** |
| `代码可视化原型` | 案例 | **自有**（本册原型，可自由分发） | 唯一可自由分发的 3D 素材：切片闸门 / 空间轴 / 层序轨道的自产实现 | `拆解\代码可视化原型` | 写代码可视化时；也是 15 册唯一不涉第三方许可的来源 |
| `ShowMotion hover 词表` | 站点 | 未查 | 同一个 hover 效果的多种叫法并列，用来补同义词 | `https://showmotion.bohehub.com/hover/` | 词表里某个效果"叫不出名"时 |
| `Bonnie Xu animation playground` | 站点 | 未查 | 36 个模式并排演示，适合找"我要的是哪个" | `https://www.bonniexu.com/animation-playground-index` | 同上，尤其悬停/点击类 |
| `FlowRadar cloneables` | 站点 | 未查 | hover cloneable 的社区分类，能看出哪些效果被反复要做 | `https://www.flowradar.com/cloneable-categories/hover` | 选题、判断"这个词值不值得立册"时 |
| `react-bits` 的 `Commons Clause` 部分 | 条款 | Commons Clause v1.0 | 明确限制"转售软件本体"，自用与作品内使用不受限 | `工具库\仓库\react-bits\LICENSE.md` | 只要打算把组件打包卖，就先读这一条 |

## 三、入库门槛

一条要有：可核的仓库/站点地址、明确许可、至少一处能在源码里定位的行或文件。三样缺一，就别写进来——写进来等于给自己埋一个"以为查过"的坑。

## 四、三条硬结论（写产出时直接引用）

1. **只有 MIT / zlib / Commons-Clause（自用）/ 自有 这几类可以进商用产出**，其余一律只当参考书。
2. **PolyForm-NC 与"未见 LICENSE"的项目**：名词、区间、代价、验收可以搬；素材、代码、品牌字标不搬。13 册与 16 册都按这条写的。
3. **站点类（三行）没有许可可查**，只能拿来看"同一个效果别人怎么叫"，不能截图、不能搬素材进产出。

## 五、待核清单（发布前回官网核对，别在产出里当结论用）

- `three.js` 的 MIT 声明（本地副本无 LICENSE 文件）
- `m3e-canvas` 的 MIT 声明（来源是册 14 的母本注记）
- `remotion` 的收费条款（按团队规模）
- `swarm-cursors` / `swarm-site` / `shadergradient` 的许可（本地仓库内均无 LICENSE）

