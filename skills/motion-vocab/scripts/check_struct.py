#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""结构计数：section / h2 / 占位符 / 表格 / 可见占位文字。

硬失败：注释占位符未清空、h2 与 section 不等、section 数不符预期。
仅提示：页面上还留着"待填写 / TODO"这类给人看的占位字样。

用法： python check_struct.py <file.html> [--section 10]
"""
import sys, re

VISIBLE = re.compile(r'待填写|待补充|待定稿|待更新|TODO|XXX|占位')

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        print('usage: check_struct.py <file.html> [--section N]')
        return 2
    path = args[0]
    expect = None
    for i, a in enumerate(sys.argv):
        if a == '--section' and i + 1 < len(sys.argv):
            expect = int(sys.argv[i + 1])
    s = open(path, encoding='utf-8').read()
    sec = len(re.findall(r'<section[^>]*class="[^"]*\bsec\b', s))
    h2 = len(re.findall(r'<h2', s))
    ph = re.findall(r'<!--\s*(?:SEC\d+|TODO|PLACEHOLDER)\s*-->', s, re.I)
    tbl = len(re.findall(r'<table', s))
    body = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', s, flags=re.S)
    body = re.sub(r'<[^>]+>', ' ', body)
    vis = VISIBLE.findall(body)
    print('section %d | h2 %d | table %d | 注释占位 %d | 可见占位 %d | bytes %d'
          % (sec, h2, tbl, len(ph), len(vis), len(s.encode('utf-8'))))
    bad = []
    if ph:
        bad.append('还有 %d 处注释占位符未清空' % len(ph))
    if expect is not None and sec != expect:
        bad.append('section 数 %d，期望 %d' % (sec, expect))
    if h2 != sec:
        bad.append('h2(%d) 与 section(%d) 不等' % (h2, sec))
    if vis:
        print('  提示：正文里还有 %d 处"待填/占位"字样（%s），交付前确认是有意为之'
              % (len(vis), '、'.join(sorted(set(vis)))))
    for b in bad:
        print('FAIL ' + b)
    print('ok' if not bad else 'bad')
    return 0 if not bad else 1

if __name__ == '__main__':
    sys.exit(main())
