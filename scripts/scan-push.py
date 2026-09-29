"""
scan-push.py — inspect exactly what a git push would publish.

Pushing is irreversible in practice: once a secret or a stray 42 MB weight lands
on a remote, the commit has to be rewritten and the secret rotated. This walks
the set of files git would add or modify and reports anything that should not
be published:

  * credentials and API keys in tracked source and config
  * database URLs carrying a password
  * large binaries (model weights, archives) that belong in .gitignore
  * phone numbers and other personal-looking identifiers
  * files that .gitignore claims to exclude but that are already tracked
    (a file stays tracked forever once added, so an ignore rule alone is not
    enough)

Read-only. It does not stage, commit, or push.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = Path.cwd()
TEXT_EXT = {'.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.html', '.json',
            '.md', '.py', '.sql', '.yaml', '.yml', '.toml', '.txt', '.example'}
BINARY_EXT = {'.pt', '.onnx', '.pth', '.bin', '.zip', '.7z', '.tar', '.gz',
              '.exe', '.dll', '.so', '.dylib', '.npy', '.npz'}

# (label, regex) — matched against file contents.
SECRET_PATTERNS = [
    ('AWS access key id',      re.compile(r'\bAKIA[0-9A-Z]{16}\b')),
    ('AWS secret access key',  re.compile(r'(?i)aws_?secret_?access_?key\s*[=:]\s*["\']?[A-Za-z0-9/+=]{40}')),
    ('Google API key',         re.compile(r'\bAIza[0-9A-Za-z\-_]{35}\b')),
    ('GitHub token',           re.compile(r'\bgh[pousr]_[A-Za-z0-9]{36,}\b')),
    ('GitHub PAT (classic)',   re.compile(r'\bghp_[A-Za-z0-9]{36}\b')),
    ('Slack token',            re.compile(r'\bxox[baprs]-[A-Za-z0-9-]{10,}\b')),
    ('Stripe key',             re.compile(r'\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b')),
    ('OpenAI key',             re.compile(r'\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b')),
    ('Anthropic key',          re.compile(r'\bsk-ant-[A-Za-z0-9_-]{20,}\b')),
    ('Twilio SID',             re.compile(r'\bAC[0-9a-fA-F]{32}\b')),
    ('Twilio token',           re.compile(r'(?i)twilio.{0,20}(auth_?token|secret)\s*[=:]\s*["\']?[A-Za-z0-9]{16,}')),
    ('private key block',      re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----')),
    ('password in URL',        re.compile(r'(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^\s:@/]+:[^\s@/]+@')),
    ('hardcoded password',     re.compile(r'(?i)\b(?:pass(?:word|wd)?|secret|api[_-]?key|auth[_-]?token)\s*[=:]\s*["\'][^"\']{6,}["\']')),
]

# 10-digit runs that look like Indian mobile numbers (with or without +91).
PHONE = re.compile(r'(?:\+?91[\s-]?)?[6-9]\d{9}\b')
# Known-fake / demo numbers that are fine to publish.
DEMO = {'9000000002', '9000000003', '9000000004', '7904678280', '9812345678',
        '9435100294', '7904678281', '9999999999'}


def git(*args: str) -> str:
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True,
                          text=True, errors='replace').stdout


def changed_files() -> list[str]:
    """Every path git would add or modify, plus already-tracked files."""
    out = git('status', '--porcelain')
    paths = []
    for line in out.splitlines():
        if not line.strip():
            continue
        path = line[3:].strip()
        if ' -> ' in path:          # rename
            path = path.split(' -> ')[-1].strip()
        path = path.strip('"')
        if path.endswith('/'):
            path = path[:-1]
        paths.append(path)
    tracked = git('ls-files').splitlines()
    return paths, tracked


def expand(rel: str) -> list[Path]:
    p = ROOT / rel
    if p.is_file():
        return [p]
    if p.is_dir():
        return [f for f in p.rglob('*') if f.is_file()]
    return []


def main() -> int:
    pending, tracked = changed_files()
    tracked_set = set(tracked)

    # Directories git lists with ?? need expanding to individual files.
    files: list[Path] = []
    for rel in pending:
        files.extend(expand(rel))
    files = sorted(set(files))

    # Only files that are NOT already ignored matter for the new commit.
    ignored = set(
        l[3:].strip().rstrip('/')
        for l in git('status', '--porcelain', '--ignored').splitlines()
        if l.startswith('!! ')
    )

    print(f'pending paths (git status) : {len(pending)}')
    print(f'expanded files to consider : {len(files)}')
    print(f'already tracked            : {len(tracked)}')
    print(f'ignored (will not publish) : {len(ignored)}\n')

    findings: list[tuple[str, str, str]] = []   # severity, file, detail
    total_bytes = 0
    large: list[tuple[str, float]] = []

    for f in files:
        rel = f.relative_to(ROOT).as_posix()
        if rel in ignored or any(rel.startswith(i + '/') for i in ignored):
            continue
        if f.name == 'package-lock.json':
            continue

        size_mb = f.stat().st_size / (1024 * 1024)
        total_bytes += f.stat().st_size
        if size_mb >= 1.0:
            large.append((rel, size_mb))
        if f.suffix.lower() in BINARY_EXT:
            findings.append(('HIGH', rel, f'binary {f.suffix} ({size_mb:.1f} MB) would be published'))
            continue
        if f.suffix.lower() not in TEXT_EXT and f.suffix:
            continue

        try:
            text = f.read_text(encoding='utf-8', errors='replace')
        except OSError:
            continue

        for line_no, line in enumerate(text.splitlines(), 1):
            for label, rx in SECRET_PATTERNS:
                m = rx.search(line)
                if m:
                    snippet = m.group(0)
                    snippet = (snippet[:6] + '…' + snippet[-4:]) if len(snippet) > 14 else snippet
                    findings.append(('HIGH', f'{rel}:{line_no}', f'{label}: {snippet}'))
            for m in PHONE.finditer(line):
                num = m.group(0)
                digits = re.sub(r'\D', '', num)[-10:]
                if digits in DEMO:
                    continue
                findings.append(('REVIEW', f'{rel}:{line_no}', f'phone-like: {num}'))

    # Files that .gitignore excludes but git still tracks.
    for t in sorted(tracked):
        if t in ignored:
            findings.append(('HIGH', t, 'listed in .gitignore but still tracked'))

    print('=' * 66)
    if large:
        print(f'files >= 1 MB that would be published:')
        for rel, mb in sorted(large, key=lambda x: -x[1])[:10]:
            print(f'   {mb:7.1f} MB  {rel}')
        print()

    high = [x for x in findings if x[0] == 'HIGH']
    review = [x for x in findings if x[0] == 'REVIEW']

    if high:
        print(f'HIGH — {len(high)} item(s) to resolve before pushing:')
        for _, where, detail in high[:40]:
            print(f'   [{where}] {detail}')
        print()
    if review:
        print(f'REVIEW — {len(review)} phone-like value(s) (demo data is filtered out):')
        for _, where, detail in review[:25]:
            print(f'   [{where}] {detail}')
        if len(review) > 25:
            print(f'   ... and {len(review) - 25} more')
        print()

    if not high and not review:
        print('CLEAN — no credentials, no large binaries, no personal-looking numbers.')
    else:
        print('Decide on the items above before publishing.')
    print(f'\ntotal bytes to add: {total_bytes/1024/1024:.1f} MB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
