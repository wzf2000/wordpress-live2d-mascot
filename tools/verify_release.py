#!/usr/bin/env python3
"""Verify immutable, asset-free release files and optional same-run identity proof."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import zipfile

VERSION = r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.[1-9]\d*)?'
RUNTIME_FIXED = {'live2d-show.php','includes/admin-import.php','characters.json','haru-assets.json',
                 'usage-imported-resources.html','licenses/Framework-LICENSE.md','LICENSE','COPYING',
                 'README.md','DISTRIBUTION.md','DISTRIBUTION-NOTICE.txt'}
SOURCE_FIXED = {'build.py','package.json','package-lock.json','LICENSE','COPYING','README.md',
                'docs/DISTRIBUTION.md','tools/package_release.py','tools/ci.py','tools/verify_release.py',
                'tests/test_release_package.py','tests/test_importer.py','tests/test_release_pipeline.py',
                'tests/release-smoke.cjs','DISTRIBUTION-NOTICE.txt'}
SOURCE_TOP = {'src/engine.ts','src/resources.ts','src/loader.js','src/style.css'}
SHADERS = {'fragshadersrcalphablend.frag','fragshadersrccolorblend.frag','fragshadersrccopy.frag',
           'fragshadersrcmaskinvertedpremultipliedalpha.frag','fragshadersrcmaskpremultipliedalpha.frag',
           'fragshadersrcpremultipliedalpha.frag','fragshadersrcpremultipliedalphablend.frag',
           'fragshadersrcsetupmask.frag','vertshadersrc.vert','vertshadersrcblend.vert',
           'vertshadersrccopy.vert','vertshadersrcmasked.vert','vertshadersrcsetupmask.vert'}


def sha(data): return hashlib.sha256(data).hexdigest()


def require(value, message):
    if not value: raise ValueError(message)


def safe(name):
    require(isinstance(name,str) and re.fullmatch(r'[A-Za-z0-9_./-]+',name), 'Unsafe path')
    p=PurePosixPath(name)
    require(not p.is_absolute() and '..' not in p.parts and str(p)==name, 'Unsafe path')


def zip_bytes(path,prefix):
    require(path.stat().st_size<=32*1024*1024,'Archive too large')
    with zipfile.ZipFile(path) as archive:
        items=archive.infolist();names=[i.filename for i in items]
        require(len(items)<=1000 and len(set(n.lower() for n in names))==len(names),'Duplicate/too many ZIP entries')
        require(sum(i.file_size for i in items)<=64*1024*1024,'ZIP expanded size exceeds limit')
        files={}
        for info in items:
            require(info.filename.startswith(prefix),'Unexpected ZIP root')
            name=info.filename[len(prefix):];safe(name)
            mode=(info.external_attr>>16)&0o170000
            require(mode in (0,0o100000) and not info.is_dir(),'Non-regular ZIP entry')
            data=archive.read(info)
            require(len(data)==info.file_size,'ZIP size mismatch')
            files[name]=data
        return files


def verify(root,version,source_sha=None,proof_required=False):
    require(bool(re.fullmatch(VERSION,version)),'Invalid version')
    require(source_sha is None or bool(re.fullmatch(r'[0-9a-f]{40}',source_sha)),'Invalid commit')
    root=Path(root)
    manifest=json.loads((root/'release-manifest.json').read_bytes())
    require(manifest['version']==version and manifest['asset_free'] is True and
            manifest['character_count']==0 and manifest['includes_core'] is False,'Invalid release boundary')
    if source_sha is not None: require(manifest.get('source_commit')==source_sha,'Wrong source commit')
    names={f'wordpress-live2d-mascot-{version}.zip',f'wordpress-live2d-mascot-{version}-source.zip',
           'SHA256SUMS','release-manifest.json','DISTRIBUTION-NOTICE.txt'}
    if proof_required:
        proof=json.loads((root/'release-validation.json').read_bytes())
        require(proof.get('schema')==1 and proof['version']==version and proof['source_commit']==source_sha,'Wrong proof identity')
        require(set(proof['files'])==names,'Wrong proof file set')
        require({p.name for p in root.iterdir()}==names|{'release-validation.json'},'Unexpected artifact files')
        for name in names:
            require((root/name).is_file() and not (root/name).is_symlink(),'Unsafe artifact entry')
            require(sha((root/name).read_bytes())==proof['files'][name],'Proof digest mismatch')
    archives={}
    for key,suffix in [('archive',''),('source_archive','-source')]:
        item=manifest[key];name=f'wordpress-live2d-mascot-{version}{suffix}.zip'
        require(item['filename']==name,'Wrong archive name')
        data=(root/name).read_bytes()
        require(len(data)==item['bytes'] and sha(data)==item['sha256'],'Archive digest mismatch')
        archives[key]=zip_bytes(root/name,'live2d-show/' if key=='archive' else 'wordpress-live2d-mascot/')
    require((root/'SHA256SUMS').read_text()==''.join(f'{manifest[k]["sha256"]}  {manifest[k]["filename"]}\n' for k in ('archive','source_archive')),'Checksum file mismatch')
    runtime=archives['archive'];assets=json.loads(runtime['haru-assets.json'])
    require(set(assets)=={'engine','loader','css','shaders','terms'},'Unexpected asset fields')
    expected=RUNTIME_FIXED|{'shaders/'+n for n in SHADERS}
    for key,extension in [('engine','js'),('loader','js'),('css','css')]:
        name=assets[key];safe(name)
        match=re.fullmatch(r'haru-'+key+r'-([0-9a-f]{12})\.'+extension,name)
        require(match is not None and sha(runtime[name])[:12]==match.group(1),'Hashed asset mismatch')
        expected.add(name)
    require(assets['shaders']=='shaders/' and assets['terms']=='usage-imported-resources.html','Unexpected fixed assets')
    require(set(runtime)==expected|{'release.json'},'Runtime whitelist mismatch')
    require(json.loads(runtime['characters.json'])=={},'Bundled characters')
    require(bool(re.search(rb'^Version:\s*'+re.escape(version.encode())+rb'\s*$',runtime['live2d-show.php'],re.M)),'PHP version mismatch')
    file_rows=manifest['files'];recorded={i['path']:i for i in file_rows}
    require(len(recorded)==len(file_rows) and set(recorded)==expected,'Manifest runtime file set mismatch')
    for name in expected:
        require(sha(runtime[name])==recorded[name]['sha256'] and len(runtime[name])==recorded[name]['bytes'],'Runtime manifest mismatch')
    base={k:v for k,v in manifest.items() if k not in ('archive','source_archive','source_files')}
    require(json.loads(runtime['release.json'])==base,'Embedded manifest mismatch')
    require(runtime['DISTRIBUTION-NOTICE.txt']==(root/'DISTRIBUTION-NOTICE.txt').read_bytes(),'Notice mismatch')
    source=archives['source_archive'];records={r['path']:r['sha256'] for r in manifest['source_files']}
    require(len(records)==len(manifest['source_files']) and set(records)==set(source),'Source manifest set mismatch')
    for name,data in source.items():
        safe(name)
        allowed=(name in SOURCE_FIXED or name in SOURCE_TOP or
                 name.startswith('src/framework/') and name.endswith('.ts') or
                 name.startswith('plugin/') and name[7:] in expected-{'DISTRIBUTION-NOTICE.txt'})
        require(allowed,'Source whitelist mismatch: '+name)
        require(sha(data)==records[name],'Source file hash mismatch')
        if name.startswith('plugin/'): require(data==runtime[name[7:]],'Source/plugin differs')
    require(SOURCE_FIXED<=set(source) and SOURCE_TOP<=set(source),'Missing source files')
    require(any(n.startswith('src/framework/') for n in source),'Missing Framework source')
    return manifest


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory',type=Path);parser.add_argument('--version',required=True)
    parser.add_argument('--source-sha');parser.add_argument('--proof',action='store_true')
    args=parser.parse_args()
    verify(args.directory,args.version,args.source_sha,args.proof)
    print('Asset-free release verified.')
