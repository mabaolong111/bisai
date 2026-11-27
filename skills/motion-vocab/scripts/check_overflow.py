#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""390px 横向溢出检查：找出比视口宽的元素（用于定位是哪一块撑开的）。

用法： python check_overflow.py <file.html> [--width 390] [--wait 800]
说明：先等 load，再尽量等 networkidle（3s 超时），最后再多等 --wait 毫秒，
      给"晚渲染"的元素留时间；仍漏判就加大 --wait。
依赖： playwright（python -m pip install playwright），用本机 Edge 免下载浏览器。
退出码：0 通过 / 1 有溢出 / 2 用法错 / 3 依赖缺失（SKIP，不代表页面有问题）。
"""
import sys, os

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        print('usage: check_overflow.py <file.html> [--width 390] [--wait 800]')
        return 2
    width, wait = 390, 800
    av = sys.argv
    for i, a in enumerate(av):
        if a == '--width' and i + 1 < len(av):
            width = int(av[i + 1])
        if a == '--wait' and i + 1 < len(av):
            wait = int(av[i + 1])
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('SKIP 依赖 playwright 未安装，请先 python -m pip install playwright')
        print('skip')
        return 3
    uri = 'file:///' + os.path.abspath(args[0]).replace('\\', '/')
    with sync_playwright() as p:
        try:
            b = p.chromium.launch(channel='msedge', headless=True)
        except Exception:
            b = p.chromium.launch(headless=True)
        pg = b.new_page(viewport={'width': width, 'height': 844})
        pg.goto(uri, wait_until='load')
        try:
            pg.wait_for_load_state('networkidle', timeout=3000)
        except Exception:
            pass
        pg.wait_for_timeout(wait)
        info = pg.evaluate("""(w) => {
          const out = [];
          document.querySelectorAll('*').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width > w + 0.5 || r.right > w + 0.5) {
              out.push((el.tagName + '.' + (el.className||'')).slice(0, 60)
                       + ' w=' + Math.round(r.width) + ' right=' + Math.round(r.right));
            }
          });
          return {x: document.documentElement.scrollWidth > w + 0.5, bad: out.slice(0, 12)};
        }""", width)
        b.close()
    print('W=%d wait=%dms overflow=%s' % (width, wait, info['x']))
    for x in info['bad']:
        print('   ' + x)
    print('ok' if not info['x'] else 'bad')
    return 0 if not info['x'] else 1

if __name__ == '__main__':
    sys.exit(main())
