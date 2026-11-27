# 安装与验收（INSTALL）

## 前置

| 项 | 要求 | 说明 |
|---|---|---|
| Python | 3.9+ | 校验脚本是纯标准库，`run_all.py` 只调子脚本 |
| Playwright | 可选 | 只有“窄屏溢出”这一项需要；没装就打印 `SKIP`、退出码 3 |
| Agent | 支持 skills 的 | Claude Code / Codex / 其他能读 `SKILL.md` 的 agent |

装 Playwright（想跑满五项才需要）：

```bash
pip install playwright
python -m playwright install chromium
```

Windows 上如果默认浏览器是 Edge，`check_overflow.py` 会自动用 Edge 通道，不必另装 Chromium。

## 三种装法

### 1. Claude Code

```bash
git clone https://github.com/你的账号/motion-vocab.git
mkdir -p ~/.claude/skills
cp -r motion-vocab ~/.claude/skills/motion-vocab
```

### 2. Codex

```bash
mkdir -p ~/.codex/skills
cp -r motion-vocab ~/.codex/skills/motion-vocab
```

### 3. 手动拷目录（任何 agent）

把整个 `motion-vocab/` 放到你的 skills 目录，目录名保持 `motion-vocab`，让 agent 能读到 `SKILL.md`。

> Windows 路径提示：`cp -r` 在 PowerShell 里不存在，用
> `Copy-Item -Recurse motion-vocab "$env:USERPROFILE\.claude\skills\motion-vocab"`。

## 装完先跑这一句

```
用 motion-vocab 拆 https://example.com，再立一册
```

不想联网就拆本地项目目录：`用 motion-vocab 拆 D:\my-project`。

## 验收（两册分开口径）

```bash
# 十节册
python scripts/run_all.py "booklets/12-路径与轨道词汇册.html" --section 10 --deny-file "scripts/deny-sample.txt"

# 起步骨架只有 3 节，--section 必须给 3，否则结构项一定 FAIL
python scripts/run_all.py "booklets/03-版式与组件词汇册.html" --section 3 --deny-file "scripts/deny-sample.txt" --target-dir "booklets"
```

期望末行：**两册都是 `5/5 通过`**。

**三项口径，别误读：**

1. **不传 `--deny-file` 就只跑四项**，末行会写“隐私未检查”——那不是全绿。
2. **`SKIP` 不是通过**。缺 Playwright 时溢出项 SKIP，退出码 3。
3. **`--section` 要跟册子的真实节数对齐**。拿 `--section 10` 去跑 3 节的起步骨架，结构项必然 FAIL，这是口径错，不是册子坏。

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 结构项 FAIL，提示 section 数不足 | `--section` 给多了 | 按册子实际节数给（03 是 3，12 是 10） |
| 溢出项 `SKIP`，退出码 3 | 没装 Playwright | `pip install playwright && python -m playwright install chromium` |
| 溢出项 FAIL 但截图看不出问题 | 容器内滚动被当成页面溢出 | 看 `--width 390` 下的 `documentElement.scrollWidth`，表格应在 `.tw` 容器内横滑 |
| 隐私项命中 | 产出里带手机号/邮箱/本机绝对路径 | 改成本地相对路径；禁词清单可换成你自己的 |
| 中文乱码 | Windows 控制台编码 | `chcp 65001` 或设 `PYTHONIOENCODING=utf-8` |

## 更新

```bash
cd motion-vocab && git pull
```

Skill 目录是纯文件，没有构建步骤，覆盖即生效。
