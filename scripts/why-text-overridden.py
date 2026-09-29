"""
Locate the exact cascade context of two rules in the built stylesheet.

The earlier attempt tracked braces naively and mis-detected the layer nesting.
This does proper brace matching (skipping strings, comments and url() data) and
reports, for each rule, the full @layer stack that encloses it.

Why it matters: under CSS Cascade Level 5, an *unlayered* declaration outranks
every declaration in *any* layer, regardless of specificity. So if Tailwind's
`.text-white` sits in `@layer utilities` while the design-system `p` rule is
unlayered, the `p` rule wins even though a class beats an element on specificity.
"""
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parents[1]
built = sorted((ROOT / 'dist' / 'assets').glob('index-*.css'))
if not built:
    print('no built CSS — run `npm run build`')
    sys.exit(2)
path = built[0]
css = path.read_text(encoding='utf-8')
print(f'{path.name}  ({len(css):,} bytes)\n')


def layer_stack(css_text: str, upto: int) -> list[str]:
    """Full @layer nesting enclosing offset `upto`, via real brace matching."""
    stack: list[tuple[str, int]] = []
    i = 0
    n = len(css_text)
    while i < n and i < upto:
        ch = css_text[i]
        if ch == '"' or ch == "'":
            quote = ch
            i += 1
            while i < n and css_text[i] != quote:
                i += 2 if css_text[i] == '\\' else 1
            i += 1
            continue
        if ch == '/' and i + 1 < n and css_text[i + 1] == '*':
            end = css_text.find('*/', i + 2)
            i = (end + 2) if end != -1 else n
            continue
        if ch == '@' and css_text.startswith('@layer', i):
            m = re.match(r'@layer\s+([\w, \-]+?)\s*([;{])', css_text[i:])
            if m:
                names = [x.strip() for x in m.group(1).split(',')]
                if m.group(2) == '{':
                    for nm in names:
                        stack.append((nm, i))
                    i += m.end()
                    continue
                i += m.end()
                continue
        if ch == '{':
            # Plain rule or at-rule: find its block and skip past it, unless it
            # is a @layer we already handled above.
            depth = 0
            j = i
            while j < n:
                c2 = css_text[j]
                if c2 == '"' or c2 == "'":
                    q = c2
                    j += 1
                    while j < n and css_text[j] != q:
                        j += 2 if css_text[j] == '\\' else 1
                elif c2 == '{':
                    depth += 1
                elif c2 == '}':
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            i = j + 1
            continue
        if ch == '}':
            if stack:
                stack.pop()
            i += 1
            continue
        i += 1
    return [name for name, _ in stack]


def report(label: str, pattern: str) -> list[str] | None:
    m = re.search(pattern, css)
    if not m:
        print(f'{label:<22} NOT FOUND')
        return None
    ctx = layer_stack(css, m.start())
    where = ' > '.join(ctx) if ctx else 'UNLAYERED'
    print(f'{label:<22} {m.group(0)[:46]:<48} {where}')
    return ctx


print('rule                                                  text                                        layer context')
print('-' * 118)
p_ctx = report('design-system p', r'p\s*\{\s*color:\s*var\(--color-text-secondary\)')
w_ctx = report('tailwind .text-white', r'\.text-white\s*\{[^}]*\}')

print('\n' + '-' * 118)
print('Cascade Layer 5: an unlayered declaration outranks every layered one,')
print('regardless of specificity.\n')

if p_ctx is None or w_ctx is None:
    print('Could not compare — one of the rules is missing.')
    sys.exit(1)

p_unlayered = not p_ctx
w_unlayered = not w_ctx

if p_unlayered and not w_unlayered:
    print('>>> CONFIRMED: `p` is unlayered, `.text-white` is layered.')
    print('    The unlayered `p` rule therefore WINS over `.text-white`, even though')
    print('    the class has higher specificity (0,1,0 vs 0,0,1).')
    print('    This is why the description renders dark despite `text-white`.')
    print('    Adding more specificity to a Tailwind class will NOT fix it.')
elif w_unlayered and p_unlayered:
    print('>>> Both unlayered — specificity decides and .text-white (0,1,0) wins.')
    print('    The override must be coming from somewhere else.')
else:
    print('>>> Both are layered; the later layer in source order wins.')
    print(f'    p in {" > ".join(p_ctx) or "unlayered"}; '
          f'text-white in {" > ".join(w_ctx) or "unlayered"}')
