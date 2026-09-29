"""
find-mojibake.py — locate double-encoded UTF-8 in the source tree.

A file was written with the wrong codec when the bytes of a valid UTF-8 string
were decoded as cp1252/latin-1 and then re-encoded as UTF-8. The tell-tale
sequences are things like U+00C2/U+00C3 (Â/Ã), U+00E2 followed by U+20AC/U+0080
(â€), and U+00F0 followed by U+009F (ðŸ) for emoji.

Reports file, line and the decoded original so each hit can be reviewed.
"""
import sys
from pathlib import Path

# The Windows console is cp1252 and cannot print the recovered text, which is
# exactly the kind of text this script produces. Force UTF-8 on stdout.
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path(__file__).resolve().parents[1]
TARGETS = ('src', 'server', 'scripts', 'index.html')

# Markers that only appear when UTF-8 was mis-decoded.
MARKERS = ('â€', 'Ã¢', 'Ãƒ', 'Ã©', 'Ã¨', 'Ã¼', 'Ã¶', 'Ã¤', 'Ã±',
           'ðŸ', 'Â°', 'Â·', 'Â«', 'Â»', 'â„¢', 'Â\xad')

SKIP_DIRS = {'node_modules', 'dist', '.git', 'venv', '__pycache__'}


def suspicious(line: str) -> bool:
    return any(m in line for m in MARKERS)


def preview(line: str) -> str:
    """Try to recover what the author originally wrote."""
    for enc in ('cp1252', 'latin-1'):
        try:
            fixed = line.encode(enc, errors='strict').decode('utf-8', errors='strict')
            return fixed.strip()
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
    return line.strip()


def main() -> int:
    files = []
    for target in TARGETS:
        p = ROOT / target
        if p.is_file():
            files.append(p)
        elif p.is_dir():
            files += [f for f in p.rglob('*')
                      if f.is_file()
                      and f.suffix in ('.ts', '.tsx', '.css', '.html', '.mjs', '.md', '.json')
                      and not any(s in f.parts for s in SKIP_DIRS)]

    total_hits = 0
    bad_files = 0
    for f in sorted(files):
        try:
            text = f.read_text(encoding='utf-8')
        except (UnicodeDecodeError, OSError):
            continue
        hits = []
        for n, line in enumerate(text.splitlines(), 1):
            if suspicious(line):
                hits.append((n, line))
        if not hits:
            continue
        bad_files += 1
        total_hits += len(hits)
        rel = f.relative_to(ROOT)
        print(f'\n{rel}  ({len(hits)} lines)')
        for n, line in hits[:4]:
            print(f'  {n:>4}: {preview(line)[:100]}')
        if len(hits) > 4:
            print(f'  ... and {len(hits) - 4} more')

    print(f'\n{'-' * 60}')
    print(f'{bad_files} files, {total_hits} affected lines')
    return 0


if __name__ == '__main__':
    sys.exit(main())
