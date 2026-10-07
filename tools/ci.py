#!/usr/bin/env python3
"""Read-only feature/build/package checks; no Core/model downloads or publication."""
import argparse
import datetime
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tools.package_release import collect, digest, encoded, package, plugin_version
from tools.verify_release import verify


def run(*args,cwd=ROOT): subprocess.run(list(args),cwd=cwd,check=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,default=ROOT/'build'/('ci-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')))
    parser.add_argument('--version');parser.add_argument('--source-sha');parser.add_argument('--require-clean',action='store_true')
    parser.add_argument('--esbuild',default=str(ROOT/'node_modules/.bin/esbuild'))
    args=parser.parse_args()
    version=plugin_version(ROOT,args.version)
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    if args.source_sha is not None and args.source_sha!=commit: raise ValueError('Checkout differs from source SHA')
    if args.require_clean and subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip(): raise ValueError('CI requires a clean checkout')
    # Verify source and committed resource hashes before anything can rebuild them.
    collect(ROOT,version,commit)
    run(sys.executable,'-m','unittest','discover','-s','tests','-p','test_*.py')
    for name in ['plugin/live2d-show.php','plugin/includes/admin-import.php']:run('php','-l',name)
    for name in ['src/loader.js','tests/release-smoke.cjs']:run('node','--check',name)
    run('node','tests/release-smoke.cjs','plugin')
    with tempfile.TemporaryDirectory(prefix='mascot-ci-') as temporary:
        temp=Path(temporary);rebuilt=temp/'rebuilt'
        run(sys.executable,'build.py','--esbuild',args.esbuild,'--out',str(rebuilt))
        committed=json.loads((ROOT/'plugin/haru-assets.json').read_bytes())
        generated=json.loads((rebuilt/'haru-assets.json').read_bytes())
        if committed!=generated:raise ValueError('Rebuilt manifest differs from committed assets')
        for key in ('engine','loader','css'):
            if (rebuilt/generated[key]).read_bytes()!=(ROOT/'plugin'/committed[key]).read_bytes():raise ValueError('Rebuilt resource differs: '+key)
        report=package(ROOT,args.out,version,commit)
        verify(args.out,version,commit)
        with zipfile.ZipFile(args.out/report['source_archive']['filename']) as archive:archive.extractall(temp/'source')
        source=temp/'source/wordpress-live2d-mascot';repacked=temp/'repacked'
        run(sys.executable,str(source/'tools/package_release.py'),'--out',str(repacked),'--version',version,'--source-sha',commit,cwd=source)
        second=json.loads((repacked/'release-manifest.json').read_bytes())
        if any(report[key]['sha256']!=second[key]['sha256'] for key in ('archive','source_archive')):raise ValueError('Self-contained source repackage differs')
    names=[report[key]['filename'] for key in ('archive','source_archive')]+['SHA256SUMS','release-manifest.json','DISTRIBUTION-NOTICE.txt']
    proof={'schema':1,'version':version,'source_commit':commit,
           'scope':'synthetic fixtures, syntax, zero-resource PHP smoke, fixed-esbuild rebuild and asset-free package/source consistency only',
           'real_core_model_rendering_tested':False,
           'files':{name:digest((args.out/name).read_bytes()) for name in names}}
    (args.out/'release-validation.json').write_bytes(encoded(proof))
    verify(args.out,version,commit,True)
    print(json.dumps({'version':version,'source_commit':commit,'output':str(args.out)},indent=2))


if __name__=='__main__':main()
