"""Перед публикацией: подставляет номер сборки в адреса файлов игры.

GitHub Pages разрешает браузеру держать файлы в кэше 10 минут, и после обновления игра собиралась
из старых файлов. С номером сборки в адресе (main.js?v=…, style.css?v=…, все модули через import map)
браузеру достаточно получить свежую страницу — остальное у него в кэше быть не может.
Номер же кладётся в version.txt: по нему меню узнаёт, что вышла новая сборка.

    python tools/stamp.py <номер сборки>
"""
import json
import os
import re
import sys

build = sys.argv[1]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
page = os.path.join(root, 'index.html')
s = open(page, encoding='utf-8').read()

m = re.search(r'<script type="importmap">\s*(\{.*?\})\s*</script>', s, re.S)
imap = json.loads(m.group(1))
mods = sorted(f for f in os.listdir(os.path.join(root, 'src')) if f.endswith('.js'))
for f in mods:
    imap['imports'][f'./src/{f}'] = f'./src/{f}?v={build}'
s = s[:m.start(1)] + json.dumps(imap, ensure_ascii=False, indent=1) + s[m.end(1):]

for a, b in [("'__BUILD__'", f"'{build}'"), ('src="src/main.js"', f'src="src/main.js?v={build}"'), ('href="style.css"', f'href="style.css?v={build}"')]:
    assert s.count(a) == 1, a
    s = s.replace(a, b)

open(page, 'w', encoding='utf-8').write(s)
open(os.path.join(root, 'version.txt'), 'w', encoding='utf-8').write(build + '\n')
print('сборка', build, '· модулей', len(mods))
