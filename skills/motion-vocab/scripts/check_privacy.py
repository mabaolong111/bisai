#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""隐私扫描：邮箱 / 手机号 / 身份号 / 本地绝对路径里的用户名 / 自定义禁词。

禁词不写死在脚本里（写死等于把敏感词又存进 Skill 一份）。
把真名等词写在本机任意一个文本文件（每行一个），用 --deny-file 传入。

用法：
  python check_privacy.py <dir> [--deny-file C:\\path\\deny.txt]
退出码：0 = 干净；1 = 有命中。
"""
import sys, os, re

PATTERNS = [
    ('email', re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')),
    ('phone', re.compile(r'(?<!\d)1[3-9]\d{9}(?!\d)')),
    ('idcard', re.compile(r'(?<!\d)[1-8]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)')),
    ('secret', re.compile(r'(?i)(api[_\-]?key|secret|token|password)\s*[:=]\s*["\']?[A-Za-z0-9_\-]{16,}')),
    # 署名与账号：本 Skill 不留署名，任何落款行或平台账号字样都算命中
    ('byline', re.compile(r'(?m)^[ \t>*]*(作者|撰文|出品|Author|Powered by)\s*[:：]')),
    # 账号落款：平台名必须和「同名 / 持续更新 / 主页」同现，才算署名；正文里讨论平台不算
    ('account', re.compile(r'(?m)^(?=.*(?:抖音|小红书|视频号|公众号|bilibili))(?=.*(?:同名|持续更新|主页)).*$')),
]
TEXT_EXT = {'.md', '.txt', '.py', '.json', '.html', '.css', '.js', '.yaml', '.yml'}

def main():
    if len(sys.argv) < 2:
        print('usage: check_privacy.py <dir> [--deny-file <file>]')
        return 2
    root = sys.argv[1]
    deny_file = None
    for i, a in enumerate(sys.argv):
        if a == '--deny-file' and i + 1 < len(sys.argv):
            deny_file = sys.argv[i + 1]
    denies = []
    if deny_file and os.path.exists(deny_file):
        denies = [l.strip() for l in open(deny_file, encoding='utf-8') if l.strip()]
    hits = []
    skip = {os.path.abspath(__file__)}
    if deny_file:
        skip.add(os.path.abspath(deny_file))  # 禁词表本身天然含禁词，不能自我命中
    for dp, _, fs in os.walk(root):
        for f in fs:
            if os.path.splitext(f)[1].lower() not in TEXT_EXT:
                continue
            p = os.path.join(dp, f)
            if os.path.abspath(p) in skip:
                continue  # 扫描器自身与禁词表跳过
            try:
                s = open(p, encoding='utf-8').read()
            except Exception:
                continue
            for d in denies:
                if d in s:
                    hits.append('deny | %s | %s' % (os.path.relpath(p, root), d))
            is_root_skill_md = (f == 'SKILL.md' and os.path.abspath(dp) == os.path.abspath(root))
            if is_root_skill_md:
                # SKILL.md 允许且仅允许一处「作者 + 同名平台」署名，位置在文件末尾
                # 规则：byline 行恰好 1 处；account 字样只能出现在该行或其下一行
                by_lines, ac_lines = [], []
                for name, rx in PATTERNS:
                    if name not in ('byline', 'account'):
                        for m in rx.finditer(s):
                            hits.append('%s | %s | %s' % (name, 'SKILL.md', m.group(0)[:48]))
                        continue
                    for m in rx.finditer(s):
                        ln = s.count('\n', 0, m.start()) + 1
                        (by_lines if name == 'byline' else ac_lines).append(ln)
                if len(by_lines) != 1:
                    hits.append('byline-count | SKILL.md | 署名行 %d 处（只允许 1 处）' % len(by_lines))
                    continue
                for ln in ac_lines:
                    if ln not in (by_lines[0], by_lines[0] + 1):
                        hits.append('account | SKILL.md | 账号字样出现在第 %d 行（只允许署名行或其下一行）' % ln)
                continue
            for name, rx in PATTERNS:
                for m in rx.finditer(s):
                    hits.append('%s | %s | %s' % (name, os.path.relpath(p, root), m.group(0)[:48]))
    for h in hits[:30]:
        print('HIT ' + h)
    print('hits=%d' % len(hits))
    print('ok' if not hits else 'bad')
    return 0 if not hits else 1

if __name__ == '__main__':
    sys.exit(main())
