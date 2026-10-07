"""Build local review artifacts only; no WordPress deployment."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--esbuild', default=str(ROOT / 'node_modules/.bin/esbuild'))
parser.add_argument('--out', type=Path, default=ROOT / 'build')
args = parser.parse_args()
# package-lock.json pins esbuild; upstream Framework legal comments stay inline.
if subprocess.check_output([args.esbuild, '--version'], text=True).strip() != '0.25.12':
    raise SystemExit('esbuild must be exactly 0.25.12')
args.out.mkdir(parents=True, exist_ok=True)
subprocess.run([args.esbuild, str(ROOT / 'src/engine.ts'), '--bundle', '--format=iife',
                '--target=es2020', '--legal-comments=inline',
                '--outfile=' + str(args.out / 'engine.js')], check=True)
assets = json.loads((ROOT / 'plugin/haru-assets.json').read_text())
for key, path in [('engine', args.out / 'engine.js'), ('loader', ROOT / 'src/loader.js'),
                  ('css', ROOT / 'src/style.css')]:
    data = path.read_bytes()
    name = 'haru-' + key + '-' + hashlib.sha256(data).hexdigest()[:12] + path.suffix
    (args.out / name).write_bytes(data)
    assets[key] = name
(args.out / 'haru-assets.json').write_text(json.dumps(assets))
print('Review build written; deployment requires separate authorization.')
