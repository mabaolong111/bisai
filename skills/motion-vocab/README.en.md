# motion-vocab

![motion-vocab](screenshots/header.jpg)

**Give the effect you can't describe a name.**

Tell an AI "make it premium, soft, techy" and you get a gray rounded card with a uniform shadow. Tell it "`mask stop 24% → 58%`, `1.1s cubic-bezier(.4,0,.2,1)`, `scale 1 → 1.08`, `opacity .75`" and it lands first try. Adjectives have no anchor; nouns carry parameters. This Skill turns unwritable motion into named, parameterised, bounded terms — then compiles them into booklets you can copy from.

## Install (30 seconds)

```bash
git clone https://github.com/AlphEJ/motion-vocab.git
mkdir -p ~/.claude/skills && cp -r motion-vocab ~/.claude/skills/motion-vocab   # Claude Code
mkdir -p ~/.codex/skills && cp -r motion-vocab ~/.codex/skills/motion-vocab    # Codex
```

Then just say: `use motion-vocab to tear down https://example.com and compile a booklet`

## What it solves

| You say | AI matches | Outcome |
|---|---|---|
| "premium, silky, techy" | nothing specific | the generic AI look |
| "stop 24%→58%, `cubic-bezier(.4,0,.2,1)`, `scale 1→1.08`" | a full set of parameters | right on the first pass |

## Five entries

- **A teardown** — a project / site / video → six-column report, every motion tagged `verified file:line` or `estimated`
- **B survey** — a topic → comparison report, needs ≥5 checkable sources, ≥2 real disagreements, ≥1 run locally
- **A′ booklet** — report → ten-section HTML booklet: 12 term cards, four boundaries, cheat sheet, copy-ready prompts
- **C design** — one request → a page with motion chosen from the vocabulary
- **lookup** — "what's this effect called" → name + parameters + counter-example

## Repository layout

```text
motion-vocab/
├── SKILL.md                  entry point: five routes, hard specs, verification, byline rules
├── README.md / README.en.md  front pages (zh / en)
├── LICENSE                   MIT
├── CHANGELOG.md              change log
├── references/               six reference docs
│   ├── teardown.md           six-column teardown (source+license / layers / modules / motion / style / transferable)
│   ├── booklet.md            ten-section booklet skeleton and visual recipe
│   ├── words.md              vocabulary, dedupe, parameter anchors, numbering
│   ├── intent.md             which route to take for a request
│   ├── survey.md             domain survey: seven sections, four thresholds
│   └── sources.md            21 sources with licenses
├── scripts/                  six checks + deny-word sample
│   ├── run_all.py            runs all five (--section / --deny-file / --target-dir)
│   ├── check_struct.py       section count and structure
│   ├── check_js.py           JS syntax (node --check)
│   ├── check_style.py        radius / type scale / emoji discipline
│   ├── check_overflow.py     390px overflow (needs playwright)
│   ├── check_privacy.py      email / phone / absolute paths / byline / deny words
│   └── deny-sample.txt       sanitised deny-word sample
├── assets/                   bundled with the skill
│   ├── 样例-03-版式与组件词汇册.html    starter skeleton (3 sections)
│   ├── 样例-12-路径与轨道词汇册.html    full ten-section spec
│   ├── logo.svg / logo-dark.svg        wordmark (light / dark)
│   ├── logo-cartoon.svg                rounded cartoon mark
│   └── favicon.svg                     100×100 square
├── booklets/                 finished booklets shipped here
│   ├── 03-版式与组件词汇册.html
│   ├── 12-路径与轨道词汇册.html
│   └── 索引.md               index of two + note on the other 14
├── docs/
│   └── INSTALL.md            install / verify / troubleshooting
└── screenshots/
    ├── header.jpg            README header image
    └── booklet-12.jpg        booklet 12 first screen
```

**Where to start**: to use it → “Install (30 seconds)” then `docs/INSTALL.md`; to modify the skill → `SKILL.md`, then the matching file in `references/`; to verify output → `scripts/run_all.py`; to see what a finished booklet looks like → `booklets/`.

## Verify

```bash
python scripts/run_all.py "booklets/12-路径与轨道词汇册.html" --section 10 --deny-file "scripts/deny-sample.txt"
python scripts/run_all.py "booklets/03-版式与组件词汇册.html" --section 3  --deny-file "scripts/deny-sample.txt" --target-dir "booklets"
```

## Scope

Only booklets **03** and **12** ship here; the other 14 stay local with the author. Numbers 1–16 are the author's own booklet numbers — if a number isn't in this repo, treat it as missing, don't guess.

## License and credit

[MIT](LICENSE), Copyright (c) 2026 Alpha_领域.

Use it, change it, redistribute it, **commercial use included** — courses, paid tools, client work, bundling into a product: all fine, no separate permission required. The one condition is MIT's own: keep the copyright notice and this permission notice in all copies or substantial portions. In short: **use it freely, don't erase the author.**

Created by **@Alpha_领域**, first commit 2026-11-23, at [AlphEJ/motion-vocab](https://github.com/AlphEJ/motion-vocab). If you cite or repost it, keep the repository link and the author name; the citation format is in `CITATION.cff`. Modified versions may be redistributed — please mark them as "based on motion-vocab".

## Author

**@Alpha_领域** on Douyin / Xiaohongshu / WeChat Official Accounts.

