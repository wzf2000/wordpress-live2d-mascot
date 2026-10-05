"""Build local review artifacts only. Does not deploy to WordPress."""
from pathlib import Path
import hashlib,json,subprocess,argparse
r=Path(__file__).resolve().parent
parser=argparse.ArgumentParser();parser.add_argument('--esbuild',default=str(r/'node_modules/.bin/esbuild'));args=parser.parse_args()
# Explicitly pinned in build-package-lock.json; framework source retains upstream license.
assert subprocess.check_output([args.esbuild,'--version'],text=True).strip()=='0.25.12'
out=r/'build';out.mkdir(exist_ok=True)
subprocess.run([args.esbuild,str(r/'src/engine.ts'),'--bundle','--format=iife','--target=es2020','--legal-comments=inline','--outfile='+str(out/'engine.js')],check=True)
assets=json.loads((r/'plugin/haru-assets.json').read_text())
for key,path in [('engine',out/'engine.js'),('loader',r/'src/loader.js'),('css',r/'src/style.css')]:
 data=path.read_bytes();name='haru-'+key+'-'+hashlib.sha256(data).hexdigest()[:12]+path.suffix;(out/name).write_bytes(data);assets[key]=name
(out/'haru-assets.json').write_text(json.dumps(assets))
print('Review build written to build/; deployment requires conflict check and backup.')
