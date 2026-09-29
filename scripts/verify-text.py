"""
verify-text.py — assert the source tree is clean and the critical strings are
byte-exact.

Repairing ~370 lines of codec damage by script is only safe if the result is
checked, so this asserts three things:

  1. No character that could only come from a codec mistake survives anywhere.
  2. No repair introduced U+FFFD (the replacement character) or a C1 control.
  3. Specific strings that matter are exactly right, code point by code point —
     including the emoji and the five localisations, which a naive repair is
     most likely to mangle.

Everything here is written with \\u escapes. A literal non-ASCII string in a
tooling script is exactly what went wrong the first time round: the literals
themselves get mangled by an editor round trip, so the checks quietly stop
matching. The localised strings were generated from the repaired file rather
than typed by hand.
"""
from __future__ import annotations

import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parents[1]
ROOTS = ('src', 'server', 'scripts', 'index.html')
SUFFIXES = ('.ts', '.tsx', '.css', '.html', '.mjs', '.md')
SKIP_DIRS = {'node_modules', 'dist', '.git', 'venv', '__pycache__', '_pre_pg_backup'}

# Mirrors fix-mojibake.py. The subtraction matters: this codebase legitimately
# uses degree signs (2 840 of them), plus-equals, multiply and a middle-dot
# separator. Flagging those as damage produced false "unrepairable" lines,
# because a bare degree sign does not round-trip through a single-byte codec.
_ALLOWED = frozenset({
    '©',   # (c)
    '®',   # (R)
    '°',   # degrees
    '±',   # plus-equals
    '²',   # squared
    '³',   # cubed
    '·',   # middle dot
    '×',   # multiply
})
_DAMAGE_RANGES = (
    (0x0080, 0x00ff),   # C1 controls + Latin-1 supplement
    (0x0152, 0x0153), (0x0160, 0x0161), (0x0178, 0x0178), (0x017d, 0x017e),
    (0x02c6, 0x02c6), (0x02dc, 0x02dc), (0x201a, 0x201a), (0x201e, 0x201e),
    (0x2030, 0x2030), (0x2039, 0x203a), (0x20ac, 0x20ac), (0x2122, 0x2122),
)

# U+FFFD, plus every C1 control. U+0081 / U+008D / U+008F / U+009D are the
# residue that proved the first repair pass had skipped the Indic lines.
FORBIDDEN = ['�'] + [chr(c) for c in range(0x80, 0xa0)]

# (relative path, substring that must appear, exact codepoints it must be)
ASSERTIONS = [
    # Punctuation that was double-encoded on the panel header.
    ('src/components/vision/YoloUploadPanel.tsx',
     'YOLO Vision \u2022 Local CPU',
     'YOLO Vision \u2022 Local CPU'),
    # Emoji are 4-byte sequences and the easiest thing for a repair to break.
    ('src/components/vision/YoloUploadPanel.tsx',
     "'\U0001f525 Fire / Smoke' : '\U0001f30a Flood'",
     "'\U0001f525 Fire / Smoke' : '\U0001f30a Flood'"),
    # The five localised greetings were the worst of the damage, and the
    # first repair pass silently skipped every one of them.
    ('src/components/chat/NexoraChatbot.tsx', '\u0bb5\u0ba3\u0b95\u0bcd\u0b95\u0bae\u0bcd!', '\u0bb5\u0ba3\u0b95\u0bcd\u0b95\u0bae\u0bcd!'),   # Tamil
    ('src/components/chat/NexoraChatbot.tsx', '\u0928\u092e\u0938\u094d\u0924\u0947!', '\u0928\u092e\u0938\u094d\u0924\u0947!'),   # Hindi
    ('src/components/chat/NexoraChatbot.tsx', '\u0c28\u0c2e\u0c38\u0c4d\u0c15\u0c3e\u0c30\u0c02!', '\u0c28\u0c2e\u0c38\u0c4d\u0c15\u0c3e\u0c30\u0c02!'),   # Telugu
    ('src/components/chat/NexoraChatbot.tsx', '\u0d28\u0d2e\u0d38\u0d4d\u0d15\u0d3e\u0d30\u0d02!', '\u0d28\u0d2e\u0d38\u0d4d\u0d15\u0d3e\u0d30\u0d02!'),   # Malayalam
    ('src/components/chat/NexoraChatbot.tsx', '\u09a8\u09ae\u09b8\u09cd\u0995\u09be\u09b0!', '\u09a8\u09ae\u09b8\u09cd\u0995\u09be\u09b0!'),   # Bengali
]


def damage_chars(text: str) -> set[str]:
    """Characters present that could only have come from a codec mistake."""
    found: set[str] = set()
    for ch in text:
        if ch in _ALLOWED:
            continue
        cp = ord(ch)
        for lo, hi in _DAMAGE_RANGES:
            if lo <= cp <= hi:
                found.add(ch)
                break
    return found


def target_files() -> list[Path]:
    files: list[Path] = []
    for name in ROOTS:
        p = ROOT / name
        if p.is_file():
            files.append(p)
        elif p.is_dir():
            files += [f for f in p.rglob('*')
                      if f.is_file()
                      and f.suffix in SUFFIXES
                      and not any(s in f.parts for s in SKIP_DIRS)]
    return sorted(files)


def main() -> int:
    failures: list[str] = []

    for f in target_files():
        try:
            text = f.read_text(encoding='utf-8')
        except (UnicodeDecodeError, OSError) as e:
            failures.append(f'{f.relative_to(ROOT)}: unreadable ({e})')
            continue
        rel = str(f.relative_to(ROOT))

        dmg = damage_chars(text)
        if dmg:
            shown = ' '.join(f'U+{ord(c):04X}' for c in sorted(dmg)[:8])
            i = min(text.index(c) for c in dmg)
            line = text[:i].count('\n') + 1
            failures.append(f'{rel}:{line}  residual damage: {shown}')

        for ch in FORBIDDEN:
            if ch in text:
                i = text.index(ch)
                line = text[:i].count('\n') + 1
                failures.append(f'{rel}:{line}  forbidden U+{ord(ch):04X}')

    for rel, needle, exact in ASSERTIONS:
        p = ROOT / rel
        try:
            text = p.read_text(encoding='utf-8')
        except OSError as e:
            failures.append(f'{rel}: unreadable ({e})')
            continue
        if needle not in text:
            failures.append(f'{rel}: expected '
                            + ' '.join(f'U+{ord(c):04X}' for c in needle)
                            + ' not found')
        elif needle != exact:
            failures.append(f'{rel}: {needle!r} != {exact!r}')

    print('=' * 62)
    if failures:
        print(f'FAIL — {len(failures)} problem(s):')
        for f in failures:
            print(f'  {f}')
        return 1

    print('PASS — no residual damage, no stray controls,')
    print('       all localised strings byte-exact.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
