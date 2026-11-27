#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一条命令跑完整套验收，汇总通过/失败/SKIP。有失败则整体返回 1。

用法：
  python run_all.py "<file.html>" [--section 10] [--width 390] [--wait 800]
                    [--deny-file "<禁词文件>"] [--target-dir "<隐私扫描目录>"]

口径（与实际一致，不再一律宣称 5/5）：
  - 传 --deny-file → 五项：结构 / JS 语法 / 样式 / 溢出 / 隐私；
  - 不传 --deny-file → 四项，并明确标注"隐私未检查"，不假装通过；
  - 子脚本退出码 3（依赖缺失、环境未就绪）记为 SKIP，不算页面失败；
  - 隐私项默认扫"被测文件所在目录"（产出物目录），不是 Skill 自己，
    可用 --target-dir 覆盖。
"""
import sys, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL_ROOT = os.path.dirname(HERE)

SKIP = 3


def run(name, script, args):
    cmd = [sys.executable, os.path.join(HERE, script)] + args
    r = subprocess.run(cmd, capture_output=True, text=True)
    code = r.returncode
    tag = 'PASS' if code == 0 else ('SKIP' if code == SKIP else 'FAIL(%d)' % code)
    print('\n[%s] %s' % (name, tag))
    out = (r.stdout + r.stderr).strip()
    for line in out.splitlines():
        print('   ' + line)
    return code


def main():
    av = sys.argv[1:]
    files = [a for a in av if not a.startswith('--')]
    if not files:
        print('usage: run_all.py "<file.html>" [--section N] [--deny-file "<file>"] [--target-dir "<dir>"]')
        return 2
    f = files[0]
    extra = {}
    for i, a in enumerate(av):
        if a.startswith('--') and i + 1 < len(av) and not av[i + 1].startswith('--'):
            extra[a] = av[i + 1]
    sec = ['--section', extra.get('--section', '10')]
    wid = ['--width', extra.get('--width', '390')]
    wai = ['--wait', extra.get('--wait', '800')]
    deny = extra.get('--deny-file')
    target = extra.get('--target-dir') or os.path.dirname(os.path.abspath(f)) or '.'

    results = []
    results.append(run('结构', 'check_struct.py', [f] + sec))
    results.append(run('JS 语法', 'check_js.py', [f]))
    results.append(run('样式', 'check_style.py', [f]))
    results.append(run('溢出', 'check_overflow.py', [f] + wid + wai))
    if deny:
        print('\n[隐私] 扫描目录：%s' % target)
        results.append(run('隐私', 'check_privacy.py', [target, '--deny-file', deny]))
    else:
        print('\n[隐私] SKIP 未传 --deny-file，本项未检查（不等于通过）')

    total = len(results)
    fails = [c for c in results if c != 0 and c != SKIP]
    skips = [c for c in results if c == SKIP]
    passed = total - len(fails) - len(skips)

    parts = ['%d/%d 通过' % (passed, total)]
    if skips:
        parts.append('%d 项 SKIP（环境未就绪，非页面问题）' % len(skips))
    if fails:
        parts.append('%d 项失败' % len(fails))
    if not deny:
        parts.append('隐私未检查')
    print('\n' + ' · '.join(parts))
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(main())
