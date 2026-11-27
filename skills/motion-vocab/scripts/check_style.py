#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""样式体检：emoji / 圆角取值 / 阴影种类 / 字号档数。

硬失败只有两条：出现 emoji；圆角出现"中间值"（非 0、非 2px、非 999px、非 50%）。
其余为提示，供判断"是不是又长成 SaaS 圆角卡"。

用法： python check_style.py <file.html>
"""
import sys, re

EMOJI = re.compile('[\U0001F300-\U0001FAFF\u2B00-\u2BFF\uFE0F]')
RADII_OK = {'0', '0px', '2px', '999px', '50%', '100%'}

def norm(v):
    v = v.strip().lower()
    v = re.sub(r'\s+', ' ', v)
    return v

def main():
    if len(sys.argv) < 2:
        print('usage: check_style.py <file.html>')
        return 2
    path = sys.argv[1]
    s = open(path, encoding='utf-8').read()
    bad = []

    emo = EMOJI.findall(s)
    if emo:
        bad.append('emoji %d 个（要求 0）：%s' % (len(emo), ''.join(emo[:6])))

    radii = set()
    for m in re.finditer(r"""border-radius:\s*([^;"'<>}]+)""", s):
        for part in re.split(r'[/ ]+', m.group(1)):
            if part.strip():
                radii.add(norm(part))
    odd = [r for r in radii if r not in RADII_OK]
    if odd:
        bad.append('圆角出现中间值：%s（只该用 0 / 2px / 999px / 50%%）' % ', '.join(sorted(odd)))

    shadows = set(norm(m.group(1)) for m in re.finditer(r'box-shadow:\s*([^;}]+)', s))
    fonts = set()
    for m in re.finditer(r"""font-size:\s*([^;"'<>}]+)""", s):
        fonts.add(norm(m.group(1)))

    print('emoji %d | 圆角取值 %d 种 %s | 阴影 %d 种 | 字号 %d 档'
          % (len(emo), len(radii), sorted(radii)[:6], len(shadows), len(fonts)))
    if len(shadows) > 2:
        print('  提示：阴影有 %d 种，超过 2 种容易变成"一堆同款阴影的圆角卡"' % len(shadows))
    if len(fonts) > 8:
        print('  提示：字号 %d 档，正式页目标 ≤5 档（词汇册含标注小字，可放宽）' % len(fonts))
    for b in bad:
        print('FAIL ' + b)
    print('ok' if not bad else 'bad')
    return 0 if not bad else 1

if __name__ == '__main__':
    sys.exit(main())
