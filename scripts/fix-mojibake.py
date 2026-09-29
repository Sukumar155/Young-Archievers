"""
fix-mojibake.py — repair text that was saved with the wrong codec.

How the damage happened
-----------------------
The file was written as UTF-8, but the bytes were decoded as cp1252/latin-1 on
the way back in and re-encoded as UTF-8. Each round trip adds a layer, so some
strings are double- or triple-encoded:

    "—"        -> "â€"      -> "Ã¢â‚¬â€"
    "°"        -> "Â°"
    "✅"       -> "âœ"     -> "Ã¢Å“â€œ"
    "नमस्ते"    -> "à¤¨à¤®à¤¸à¥"

Repair strategy
---------------
A round trip is only safe if it is idempotent for text that was already fine.
So instead of blanket re-decoding, every candidate line is checked:

  1. It must contain at least one byte-sequence that is invalid as cp1252 or
     invalid as UTF-8 once re-encoded — i.e. there is something to undo.
  2. After repair the line must be strictly "cleaner": fewer mojibake markers
     than before. A repair that does not reduce the damage is rejected.
  3. ASCII-only lines are never touched, which leaves all real code, hex
     colours and import paths alone.

The loop repeats while any line keeps improving, then stops at a fixed point.

Usage
-----
    python scripts/fix-mojibake.py --dry-run     # report, change nothing
    python scripts/fix-mojibake.py --apply       # write, with a .bak backup
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parents[1]
ROOTS = ('src', 'server', 'scripts', 'index.html')
SUFFIXES = ('.ts', '.tsx', '.css', '.html', '.mjs', '.md')
SKIP_DIRS = {'node_modules', 'dist', '.git', 'venv', '__pycache__', '_pre_pg_backup'}

# ── Damage detection ──────────────────────────────────────────────────────────
# An earlier version matched literal mojibake strings ("â€", "à¦", …). That is
# fragile: the literals themselves have to survive being written into this file,
# and one of them silently did not — so all the Bengali text was skipped while
# the report still claimed success. Detection is therefore structural.
#
# Mojibake is Latin-1 text standing in for UTF-8 bytes, so the damage signature
# is the C1 controls, the Latin-1 supplement, and the cp1252 0x80-0x9F specials
# — minus the handful of characters this codebase genuinely uses.
#
# That subtraction matters. `°` appears 2840 times as real content (°C,
# coordinates) and `Â°` is the mojibake for it; `±`, `×` and `·` are likewise
# real. Treating them all as damage produced 57 false "still damaged" lines
# that no repair could ever fix, since a bare `°` does not round-trip.
#
# Allowing them is safe: real mojibake always carries a backbone character that
# is *not* allowed (à, â, Ã, Â, ð, ¤, ¦, ² …), so `Â°` still scores and still
# repairs to `°`.
_ALLOWED = frozenset({
    '\u00a9',   # ©
    '\u00ae',   # ®
    '\u00b0',   # °  degrees
    '\u00b1',   # ±
    '\u00b2',   # ²  m², CO₂
    '\u00b3',   # ³
    '\u00b7',   # ·  middle dot separator
    '\u00d7',   # ×  multiply
})

_DAMAGE_RANGES = (
    (0x0080, 0x00ff),   # C1 controls + Latin-1 supplement
    (0x0152, 0x0153), (0x0160, 0x0161), (0x0178, 0x0178), (0x017d, 0x017e),
    (0x02c6, 0x02c6), (0x02dc, 0x02dc), (0x201a, 0x201a), (0x201e, 0x201e),
    (0x2030, 0x2030), (0x2039, 0x203a), (0x20ac, 0x20ac), (0x2122, 0x2122),
)

# Display markers for the report only; not used for detection.
MARKERS = ('â€', 'Ã¢', 'Ãƒ', 'Ã©', 'Ã¨', 'Ã¼', 'Ã¶',
           'ðŸ', 'Â°', 'Â·', 'ï¸')

MAX_ROUNDS = 6

# ── Reverse codec ─────────────────────────────────────────────────────────────
# The damage was a *mixed* single-byte decode: 0x80-0x9F were resolved through
# cp1252 for the slots it defines (€ … “) but fell through to raw C1 control
# characters for the five undefined slots. Python's own cp1252 therefore refuses
# to encode these lines (it hits U+008D), and latin-1 refuses them a moment
# later (it hits U+2022). Neither codec can undo the round trip, which is why
# the Devanagari/Tamil/Telugu greetings were skipped.
#
# So the byte table is built explicitly: cp1252 semantics for 0x80-0x9F, plain
# Latin-1 identity for 0xA0-0xFF, and the C1 controls mapped to their own byte
# values for the undefined slots. That is the inverse of the decode that caused
# the damage, and it round-trips every character these files actually contain.
_CP1252_HIGH = {
    0x80: '\u20ac', 0x82: '\u201a', 0x83: '\u0192', 0x84: '\u201e',
    0x85: '\u2026', 0x86: '\u2020', 0x87: '\u2021', 0x88: '\u02c6',
    0x89: '\u2030', 0x8a: '\u0160', 0x8b: '\u2039', 0x8c: '\u0152',
    0x8e: '\u017d', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201c',
    0x94: '\u201d', 0x95: '\u2022', 0x96: '\u2013', 0x97: '\u2014',
    0x98: '\u02dc', 0x99: '\u2122', 0x9a: '\u0161', 0x9b: '\u203a',
    0x9c: '\u0153', 0x9e: '\u017e', 0x9f: '\u0178',
}


def _build_reverse_table() -> dict[str, int]:
    table: dict[str, int] = {}
    # C1 controls (the cp1252-undefined slots) keep their own byte value.
    for b in range(0x00, 0xa0):
        table.setdefault(chr(b), b)
    # cp1252 overrides in the 0x80-0x9F block.
    for b, ch in _CP1252_HIGH.items():
        table[ch] = b
    # Latin-1 identity for everything above.
    for b in range(0xa0, 0x100):
        table[chr(b)] = b
    return table


REVERSE = _build_reverse_table()


def score(text: str) -> int:
    """Count characters that can only come from a codec mistake. Lower is better."""
    n = 0
    for ch in text:
        if ch in _ALLOWED:
            continue
        cp = ord(ch)
        for lo, hi in _DAMAGE_RANGES:
            if lo <= cp <= hi:
                n += 1
                break
    return n


def repair_once(line: str) -> str | None:
    """Try to undo one encoding layer. Returns None if nothing improved."""
    if score(line) == 0:
        return None
    try:
        raw = bytes(REVERSE[ch] for ch in line)
    except KeyError:
        # A character with no single-byte origin: this line contains real
        # multi-byte text already, so there is nothing left to undo here.
        return None
    try:
        fixed = raw.decode('utf-8', errors='strict')
    except UnicodeDecodeError:
        return None
    # Accept only a repair that measurably reduces the damage and introduces
    # no replacement characters.
    if score(fixed) < score(line) and '\ufffd' not in fixed:
        return fixed
    return None


def repair_line(line: str) -> tuple[str, int, bool]:
    """Apply repair repeatedly until the line stops improving.

    Returns (text, rounds, fully_repaired). `fully_repaired` is False when the
    line still shows damage after MAX_ROUNDS, which is reported rather than
    silently written back.
    """
    rounds = 0
    current = line
    while rounds < MAX_ROUNDS:
        nxt = repair_once(current)
        if nxt is None:
            break
        current = nxt
        rounds += 1
    return current, rounds, score(current) == 0


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
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true',
                    help='write the repairs (default is a dry run)')
    ap.add_argument('--dry-run', action='store_true',
                    help='explicitly do not write (default behaviour)')
    ap.add_argument('--max-preview', type=int, default=4)
    args = ap.parse_args()

    changed_files = 0
    changed_lines = 0
    total_rounds = 0
    unresolved: list[str] = []

    for f in target_files():
        try:
            text = f.read_text(encoding='utf-8')
        except (UnicodeDecodeError, OSError):
            continue
        if score(text) == 0:
            continue

        out: list[str] = []
        file_lines = 0
        file_rounds = 0
        previews: list[tuple[int, str, str, int]] = []

        for n, line in enumerate(text.splitlines(keepends=True), 1):
            if score(line) == 0:
                out.append(line)
                continue
            fixed, rounds, clean = repair_line(line)
            if not clean:
                unresolved.append(f'{f.relative_to(ROOT)}:{n}  still damaged')
            if fixed != line:
                file_lines += 1
                file_rounds += rounds
                if len(previews) < args.max_preview:
                    previews.append((n, line.rstrip(), fixed.rstrip(), rounds))
            out.append(fixed)

        if file_lines == 0:
            continue

        changed_files += 1
        changed_lines += file_lines
        total_rounds += file_rounds
        rel = f.relative_to(ROOT)
        print(f'\n{rel}  ({file_lines} lines, {file_rounds} rounds)')
        for n, before, after, rounds in previews:
            print(f'  {n:>4}  x{rounds}')
            print(f'        -  {before[:96]}')
            print(f'        +  {after[:96]}')
        if file_lines > len(previews):
            print(f'        ... and {file_lines - len(previews)} more')

        if args.apply:
            backup = f.with_suffix(f.suffix + '.bak')
            if not backup.exists():
                shutil.copy2(f, backup)
            f.write_text(''.join(out), encoding='utf-8', newline='')

    print(f'\n{chr(45) * 62}')
    verb = 'repaired' if args.apply else 'would repair'
    print(f'{verb} {changed_lines} lines across {changed_files} files '
          f'({total_rounds} decode rounds)')
    if unresolved:
        print(f'\n{len(unresolved)} line(s) could not be fully repaired — '
              f'these need a human:')
        for u in unresolved:
            print(f'  {u}')
    if not args.apply and changed_lines:
        print('re-run with --apply to write (a .bak is kept for each file)')
    return 1 if unresolved else 0


if __name__ == '__main__':
    sys.exit(main())
