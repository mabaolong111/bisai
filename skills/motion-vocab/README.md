# motion-vocab ｜ 动效词汇台

![motion-vocab](screenshots/header.jpg)

**把说不出口的动效，拆成一个词。**

你跟 AI 说“高级一点、柔和一点、有科技感”，它给你灰底圆角卡、同款阴影、匀速淡入；你说“遮罩停点 24%→58%、1.1s `cubic-bezier(.4,0,.2,1)`、`scale 1→1.08`、`opacity .75`”，它一次就对。

**形容词没有落点，名词自带参数。** 这个 Skill 做的，就是把那些你叫不出名字的效果，拆成有名字、有参数、有边界的词，再立成一册能照着抄的词汇册。

> MIT 许可 · 可自由使用、修改与商用 · 唯一要求是保留版权声明

## 30 秒装上

```bash
git clone https://github.com/AlphEJ/motion-vocab.git
```

**Claude Code**

```bash
mkdir -p ~/.claude/skills && cp -r motion-vocab ~/.claude/skills/motion-vocab
```

**Codex / 其他支持 skills 的 agent**

```bash
mkdir -p ~/.codex/skills && cp -r motion-vocab ~/.codex/skills/motion-vocab
```

装好后直接说一句：

```
用 motion-vocab 拆 https://example.com，再立一册
```

详细安装、验收与排错见 [`docs/INSTALL.md`](docs/INSTALL.md)。

## 它解决什么

| 你说的 | AI 听到的 | 结果 |
|---|---|---|
| “高级一点、丝滑一点、有科技感” | 没有可匹配的对象，只能猜成最常见的样式 | 灰底圆角卡、均匀阴影、匀速淡入——也就是常说的“AI 味” |
| “收边 1.1s、`cubic-bezier(.4,0,.2,1)`、停点 24%→58%、`scale 1→1.08`” | 一整套现成的参数与曲线 | 一次就能对上 |

你要的那句“再柔一点”，本质是把某个参数挪一格。**能叫出名字，才改得动。**

## 五个入口

| 入口 | 你给它 | 它给你 |
|---|---|---|
| **A 拆解** | 一个项目 / 站点 / 视频 | 六栏拆解稿：来源与许可、骨架分层、模块全量清单、动效清单、视觉风格、可搬元素。每条形效都标 `实测 文件:行` 或 `估`，不混着写 |
| **B 领域** | 一个主题（滚动驱动 / 纵深 / 版式…） | 横评稿：≥5 个可核来源、≥2 个真分歧点、≥1 个当场跑通；凑不齐**不立册**，只进待验清单 |
| **A′ 立册** | 拆解稿或横评稿 | 十节册 html：12 张术语卡、四条边界、速查表、可复制提示词、可拖动的读数和自检 |
| **C 设计** | 一句需求（做个简历站 / 落地页 / 看板） | 按词库给出动效方案，产出能跑的页面 |
| **查词** | “这个效果叫什么” | 词名 + 参数锚点 + 用错的例子 |

## 仓库结构

```text
motion-vocab/
├── SKILL.md                  主入口：五个入口、硬规格、验收口径、署名规则
├── README.md / README.en.md  门面（中 / 英）
├── LICENSE                   MIT
├── CHANGELOG.md              变更记录
├── references/               六份参考文档
│   ├── teardown.md           六栏拆解（来源与许可 / 骨架分层 / 模块 / 动效 / 风格 / 可搬元素）
│   ├── booklet.md            十节册骨架与视觉配方
│   ├── words.md              词表、查重、参数锚点、编号规则
│   ├── intent.md             需求判读：什么时候走哪条入口
│   ├── survey.md             领域横评七段与四条门槛
│   └── sources.md            21 条来源与许可索引
├── scripts/                  六个校验 + 禁词示例
│   ├── run_all.py            一键跑五项（--section / --deny-file / --target-dir）
│   ├── check_struct.py       节数与结构
│   ├── check_js.py           JS 语法（node --check）
│   ├── check_style.py        圆角 / 字号 / emoji 纪律
│   ├── check_overflow.py     390 宽是否溢出（需 playwright）
│   ├── check_privacy.py      邮箱 / 手机号 / 绝对路径 / 署名 / 禁词
│   └── deny-sample.txt       脱敏的禁词表示例
├── assets/                   随包分发
│   ├── 样例-03-版式与组件词汇册.html    起步骨架（3 节）
│   ├── 样例-12-路径与轨道词汇册.html    十节全规格
│   ├── logo.svg / logo-dark.svg        横版标志（浅底 / 暗底）
│   ├── logo-cartoon.svg                圆头卡通版
│   └── favicon.svg                     100×100 方版
├── booklets/                 仓库附带的成品
│   ├── 03-版式与组件词汇册.html
│   ├── 12-路径与轨道词汇册.html
│   └── 索引.md               两册册目 + 其余 14 册的声明
├── docs/
│   └── INSTALL.md            安装 / 验收 / 排错
└── screenshots/
    ├── header.jpg            README 头图
    └── booklet-12.jpg        第 12 册首屏实景
```

**读仓库的顺序**：想先用起来 → `README` 的“30 秒装上” → `docs/INSTALL.md`；想改 Skill → `SKILL.md` 建个整体印象，再按任务查 `references/`；想核验收 → `scripts/run_all.py`；想看成品长什么样 → `booklets/`。

## 验收

```bash
# 十节册（12）——完整规格
python scripts/run_all.py "booklets/12-路径与轨道词汇册.html" --section 10 --deny-file "scripts/deny-sample.txt"

# 起步骨架（03）——只有 3 个 section，--section 必须给 3
python scripts/run_all.py "booklets/03-版式与组件词汇册.html" --section 3 --deny-file "scripts/deny-sample.txt" --target-dir "booklets"
```

两册都是 **5/5**。注意 `--section` 要跟册子的真实节数对齐：拿 `--section 10` 去跑只有 3 节的 03，结构项必然 FAIL——那是口径错，不是册子坏。

五项通过 = 结构 / JS 语法 / 样式纪律 / 窄屏不溢出 / 隐私扫描。缺 `playwright` 时溢出项会打印 `SKIP` 并返回退出码 3，**SKIP 不算通过**。

`booklets/03` 与 `assets/样例-03` 是**同一份文件的副本**（字节相同），一个是给读者打开看的，一个是给 Skill 内部引用的。

## 只带两册

`booklets/` 里只有 **03 与 12** 两册，其余 14 册（01–02、04–11、13–16）不随仓库分发。

`SKILL.md` 与 `references/words.md` 里的编号 1–16 是作者本地册库的号；在本仓库里查不到对应的册，就按“索引里没有”处理，**不要编**。完整册目见 [`booklets/索引.md`](booklets/索引.md)。

## 许可

[MIT](LICENSE)，Copyright (c) 2026 Alpha_领域。

- **可以**：下载、阅读、修改、二次分发，**包括商用**——做课程、做付费工具、给客户交付、打包进商业产品，都不用另外问我。
- **唯一要求**：任何副本或实质性部分里，必须保留 `LICENSE` 里的版权声明与许可声明（MIT 原文那句 *The above copyright notice and this permission notice shall be included in all copies*）。一句话：**用可以，别把作者抹掉。**
- **覆盖范围**：`SKILL.md`、`references/`、`booklets/`、`scripts/`、`assets/` 全部。
- **例外**：`screenshots/` 等目录里若含第三方图片、字体或素材，其版权属原作者，不在本许可范围内，再分发前请自行核清来源。

## 出处

本项目由 **@Alpha_领域** 创建，首次提交于 2026-11-23，仓库 [AlphEJ/motion-vocab](https://github.com/AlphEJ/motion-vocab)。

引用、转载或基于它二次开发时，请保留仓库链接与作者署名，格式见 [`CITATION.cff`](CITATION.cff)。改过的版本可以自由再分发，但请注明"**基于 motion-vocab 修改**"。

## 作者

- 抖音：[@Alpha_领域](https://www.douyin.com/)
- 小红书：@Alpha_领域
- 微信公众号：@Alpha_领域

用本 Skill 做出的产出物（册子、页面、拆解稿）**不带这些 ID**，只有本仓库与这条 README 署名——产出的东西是给用的人署名的，不是给我打广告的。

