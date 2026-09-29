"""
check-css-comments.py — catch nested comment terminators in CSS.

CSS has no nested comments. A `*` `/` sequence anywhere inside a comment closes
it early, and everything after that point is parsed as real CSS. The failure is
nasty because it is silent in a production build: Vite/Tailwind just drops the
malformed tail (including any rule that followed), `npm run build` still exits 0,
and the missing rule only shows up as a visual regression. In dev it surfaces as
a PostCSS parse error and a 500, which is at least loud.

This walks each stylesheet, tracks comment state, and reports any `*` `/` that
appears before its own comment's real terminator.
"""
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parents[1]
FILES = sorted(
    list((ROOT / 'src').rglob('*.css'))
    + list((ROOT / 'server').rglob('*.css'))
    + [ROOT / 'index.html']
)

# `*` immediately followed by `/` — the only sequence that can close a comment.
CLOSER = re.compile(r'\*/')

problems = []
for f in FILES:
    try:
        text = f.read_text(encoding='utf-8')
    except (UnicodeDecodeError, OSError):
        continue

    i = 0
    line = 1
    n = len(text)
    while i < n:
        c = text[i]
        if c == '\n':
            line += 1
            i += 1
            continue
        if text.startswith('/*', i):
            start_line = line
            # Find every candidate terminator; the first one ends the comment.
            # Anything that looks like an opener *inside* is a nesting bug.
            j = i + 2
            nested = []
            while j < n - 1:
                if text[j] == '\n':
                    line += 1
                if text.startswith('/*', j):
                    nested.append((line, j))
                if text.startswith('*/', j):
                    break
                j += 1
            if nested:
                for nl, pos in nested:
                    problems.append(
                        f'{f.relative_to(ROOT)}:{nl}  nested comment opener inside '
                        f'the comment that starts on line {start_line}')
            i = j + 2
            line += text.count('\n', i, i + 0) or 0
            continue
        i += 1

print('=' * 62)
if problems:
    print(f'FAIL — {len(problems)} nested-comment problem(s):')
    for p in problems:
        print(f'  {p}')
    print('\nCSS has no nested comments: the inner */ closes the block early and')
    print('everything after it is parsed as CSS. Reword the comment to avoid the')
    print('sequence, or move the example into a separate comment.')
    sys.exit(1)

print(f'PASS — {len(FILES)} stylesheet(s) checked, no nested comment terminators.')
