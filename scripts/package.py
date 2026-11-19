"""Deterministic source-only packages. No compiler or third-party dependencies."""
from pathlib import Path
import json, zipfile, hashlib
root = Path(__file__).resolve().parents[1]
out = root / 'dist'
out.mkdir(exist_ok=True)
releases = []
for path in sorted((root / 'plugins').glob('*/manifest.json')):
    manifest = json.loads(path.read_text())
    ident, version = manifest['id'], manifest['version']
    name = f'{ident}-{version}.aerplugin'
    files = {'manifest.json': path.read_bytes(), 'LICENSE': (root / 'LICENSE').read_bytes(),
             'ui/aer.js': (root / 'sdk/aer.js').read_bytes(),
             'ui/config.js': ('export default '+json.dumps(manifest, ensure_ascii=False)+';\n').encode()}
    files.update({'ui/'+p.name: p.read_bytes() for p in (root / 'shared').iterdir() if p.is_file()})
    with zipfile.ZipFile(out / name, 'w', zipfile.ZIP_DEFLATED) as archive:
        for key, data in sorted(files.items()):
            entry = zipfile.ZipInfo(key, date_time=(2026, 1, 1, 0, 0, 0))
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, data)
    data = (out / name).read_bytes()
    releases.append({'id':ident,'version':version,'hostAPI':3,'dataSchema':1,'bytes':len(data),
        'sha256':hashlib.sha256(data).hexdigest(),
        'url':f'https://github.com/aerbrowser/aer-plugins/releases/download/v{version}/{name}'})
(out / 'releases.json').write_text(json.dumps(releases,indent=2)+'\n')
print(f'Packaged {len(releases)} source archives in {out}')
