"""
probe-encoding.py — identify the exact codec chain that damaged a line.

Prints the code points and raw bytes of a suspect line, then tries the known
repair candidates so the correct one can be chosen from evidence rather than
guesswork.
"""
from __future__ import annotations

import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

path = Path(sys.argv[1])
lineno = int(sys.argv[2])

raw = path.read_bytes()
text = raw.decode('utf-8')
line = text.splitlines()[lineno - 1]

print(f'{path.name}:{lineno}')
print(f'length: {len(line)} chars\n')

# Which non-ASCII code points are present, and where they sit in each codec?
non_ascii = sorted({c for c in line if ord(c) > 127})
print('non-ASCII code points:')
for c in non_ascii:
    print(f'  U+{ord(c):04X}  {c!r}')

print('\nencode-ability of the line:')
for enc in ('cp1252', 'latin-1', 'cp437', 'mac_roman'):
    try:
        line.encode(enc)
        print(f'  {enc:<10} OK')
    except UnicodeEncodeError as e:
        bad = line[e.start:e.end]
        print(f'  {enc:<10} FAILS at U+{ord(bad[0]):04X} {bad[0]!r}')

# The candidate repair: the file's UTF-8 bytes were read as some single-byte
# codec, so undo it by re-encoding with that codec and decoding as UTF-8.
print('\nrepair candidates (encode back, then decode as utf-8):')
for enc in ('cp1252', 'latin-1', 'cp437', 'mac_roman'):
    try:
        fixed = line.encode(enc, errors='strict').decode('utf-8', errors='strict')
    except (UnicodeEncodeError, UnicodeDecodeError) as e:
        print(f'  {enc:<10} no: {type(e).__name__}')
        continue
    print(f'  {enc:<10} -> {fixed}')
