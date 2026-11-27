#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抽内联 <script> 到临时文件，跑 node --check。外部 src 的脚本跳过。

用法： python check_js.py <file.html>
退出码：0 = 全部通过；1 = 有语法错或缺 node。
"""
import sys, re, subprocess, tempfile, os

def main():
    if len(sys.argv) < 2:
        print('usage: check_js.py <file.html>')
        return 2
    path = sys.argv[1]
    s = open(path, encoding='utf-8').read()
    blocks = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', s, re.S)
    if not blocks:
        print('no inline script')
        return 0
    body = '\n;\n'.join(blocks)
    fd, tmp = tempfile.mkstemp(suffix='.js')
    os.close(fd)
    open(tmp, 'w', encoding='utf-8').write(body)
    try:
        r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
        if r.returncode == 0:
            print('node --check ok (%d block, %d chars)' % (len(blocks), len(body)))
            return 0
        print(r.stderr.strip()[:400])
        return 1
    finally:
        os.unlink(tmp)

if __name__ == '__main__':
    sys.exit(main())
