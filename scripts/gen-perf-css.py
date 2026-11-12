#!/usr/bin/env python3
"""Собирает из стилей сайта два списка бесконечных анимаций для css/v34.css:
  HEAVY — анимируют не transform/opacity (каждый кадр пересчитывают стили и перерисовывают страницу процессором);
  DECOR — остальные декоративные (их делает видеокарта, но на слабых телефонах и они лишние).
Анимации «по делу» (эквалайзер, загрузка, запись голоса, звонок, заставка) в списки не попадают.
Запуск: python3 scripts/gen-perf-css.py   — переписывает хвост css/v34.css (после строки-метки)."""
import re, sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if os.path.exists(os.path.join(ROOT, 'src', 'index.html')): ROOT = os.path.join(ROOT, 'src')  # в репозитории исходники лежат в src/
css = ''
for l in re.findall(r'href="(css/[a-z0-9-]+\.css)', open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()):
    if l.endswith('v34.css'): continue
    css += open(os.path.join(ROOT, l), encoding='utf-8').read() + '\n'
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
kf = {}
for m in re.finditer(r'@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}', css):
    kf.setdefault(m.group(1), set()).update(re.findall(r'([a-z-]+)\s*:', re.sub(r'\([^)]*\)', '', m.group(2))))
COMP = {'transform', 'opacity'}
WORKING = re.compile(r'^(eq|eqS|tgEq|hnEq|tyDot|rec[A-Z]|call[A-Z]|ci[A-Z]|upd[A-Z]|out[A-Z]|offDl|spin|shimmer|skel|sk$|sp\d|lp[A-Z]|id[A-Z]|vGlow|cb[A-Z]|crash)')
heavy, decor = {}, {}
plain = re.sub(r'@(media|supports)[^{]*\{', '{', css)  # правила внутри @media тоже считаем
for m in re.finditer(r'([^{}]+)\{([^{}]*animation[^{}]*)\}', plain):
    names = set()
    for a in re.findall(r'animation(?:-name)?\s*:\s*([^;]+)', m.group(2)):
        for part in a.split(','):
            if 'infinite' in part:
                names.update(w for w in part.split() if w in kf)
    if not names: continue
    for sel in m.group(1).split(','):
        sel = ' '.join(sel.split())
        if not sel or sel.startswith('@') or 'lowpower' in sel or 'reduce' in sel: continue
        for n in names:
            if WORKING.match(n): continue
            (heavy if kf[n] - COMP else decor).setdefault(sel, set()).add(n)

def scope(sel, cls):
    if sel.startswith('html'): return 'html' + cls + sel[4:]
    if sel.startswith(':root'): return ':root' + cls + sel[5:]
    return 'html' + cls + ' ' + sel

def block(title, sels, cls):
    out = ['/* ' + title + ' */']
    line = ',\n'.join(scope(s, cls) for s in sorted(sels))
    out.append(line + ' { animation-duration: .01ms !important; animation-iteration-count: 1 !important; }')
    return '\n'.join(out)

MARK = '/* ==== ниже — список, собранный скриптом scripts/gen-perf-css.py (руками не править) ==== */'

def generated():
    # рамка аватара и переливы ника в шапке профиля — один элемент на экране: на мощных телефонах (q3) они проигрываются
    # два раза при открытии профиля и замирают, на остальных стоят сразу
    hero = [s for s in heavy if ('.hero-avatar' in s or '.hero-nick' in s or s.startswith('.phero.dev')) and 'fxAur' not in heavy[s]]
    out = [MARK, '']
    out.append(block('тяжёлые бесконечные анимации (не transform/opacity): на телефонах выключены', [s for s in heavy if s not in hero], '.touch-dev'))
    out.append('')
    out.append(block('то же для шапки профиля — кроме мощных телефонов', hero, '.touch-dev:not(.q3)'))
    out.append('/* мощные телефоны: украшения шапки профиля играют два раза и замирают */')
    out.append(',\n'.join(scope(s, '.touch-dev.q3') for s in sorted(hero)) + ' { animation-iteration-count: 2 !important; }')
    out.append('')
    out.append(block('лёгкий уровень графики: декоративные бесконечные анимации выключены', [s for s in decor if s not in heavy], '.lite'))
    return '\n'.join(out) + '\n'

if __name__ == '__main__':
    if '--stats' in sys.argv:
        print(len(heavy), 'heavy;', len(decor), 'decor')
        for s, n in sorted(heavy.items()): print('H', s, sorted(n))
        sys.exit()
    path = os.path.join(ROOT, 'css', 'v34.css')
    cur = open(path, encoding='utf-8').read()
    head = cur.split(MARK)[0].rstrip() + '\n\n'
    open(path, 'w', encoding='utf-8').write(head + generated())
    print('v34.css: %d тяжёлых, %d декоративных' % (len(heavy), len(decor)))
