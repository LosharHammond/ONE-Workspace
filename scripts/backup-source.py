"""Create a code-only snapshot; never copy credentials or local application data."""
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parent.parent
destination = Path(sys.argv[1]).resolve()
excluded = {'.git', 'node_modules', '.next', '.vinext', '.wrangler', '.sites-runtime',
            'dist', 'outputs', 'work', '.agents', '.codex', '__pycache__'}

def include(path):
    rel = path.relative_to(root)
    if any(part in excluded for part in rel.parts):
        return False
    if rel.parts[:3] == ('scripts', 'nvr', 'private'):
        return False
    if path.name.startswith('.env') and path.name != '.env.example':
        return False
    if path.suffix in {'.pem', '.key', '.pfx', '.p12', '.sqlite', '.db', '.tsbuildinfo', '.log'}:
        return False
    return True

import os
files = []
for folder, dirs, names in os.walk(root, followlinks=False):
    base = Path(folder)
    dirs[:] = [d for d in dirs if include(base / d) and not (base / d).is_symlink()]
    files.extend(base / n for n in names if include(base / n) and not (base / n).is_symlink())
with zipfile.ZipFile(destination, 'x', zipfile.ZIP_DEFLATED, strict_timestamps=False) as archive:
    for path in files:
        archive.write(path, 'One Workspace/' + path.relative_to(root).as_posix())
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    names = archive.namelist()
    assert 'One Workspace/package.json' in names and 'One Workspace/app/ui/shell.tsx' in names
    assert not any('/scripts/nvr/private/' in name for name in names)
print(f'Verified source backup: {destination} ({len(files)} files)')
