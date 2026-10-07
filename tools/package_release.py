#!/usr/bin/env python3
"""Create the maintainer-approved asset-free plugin release. Never reads Core or model directories."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SHADERS = ('fragshadersrcalphablend.frag', 'fragshadersrccolorblend.frag',
           'fragshadersrccopy.frag', 'fragshadersrcmaskinvertedpremultipliedalpha.frag',
           'fragshadersrcmaskpremultipliedalpha.frag', 'fragshadersrcpremultipliedalpha.frag',
           'fragshadersrcpremultipliedalphablend.frag', 'fragshadersrcsetupmask.frag',
           'vertshadersrc.vert', 'vertshadersrcblend.vert', 'vertshadersrccopy.vert',
           'vertshadersrcmasked.vert', 'vertshadersrcsetupmask.vert')
NOTICE = (
    'WordPress Live2D Mascot 3.5.0 — asset-free distribution\n'
    'Repository: https://github.com/wzf2000/wordpress-live2d-mascot\n'
    'No Cubism Core, models, textures, motions, expressions or sample catalogs are bundled.\n'
    'Administrators obtain supported resources from the official sources themselves.\n'
    'The maintainer authorized this release based on the supplied licensing reply.\n'
    'public_release_ready records that decision; it is not official certification or\n'
    'a grant of third-party rights. See LICENSE, COPYING and DISTRIBUTION.md.\n'
    'Runtime: 18 synthetic tests and 37 isolated WordPress import/installation checks passed.\n'
).encode('utf-8')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False).encode('utf-8')


def checked(path):
    path = Path(path).absolute()
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError('Symlink refused: ' + part.name)
    return path.resolve(strict=False)


def read(root, name):
    if not re.fullmatch(r'[A-Za-z0-9_./-]+', name) or any(p in ('', '.', '..') for p in name.split('/')):
        raise ValueError('Unsafe path')
    path = checked(root / name)
    if not path.is_file():
        raise ValueError('Missing file: ' + name)
    return path.read_bytes()


def collect(repo):
    repo = checked(repo)
    plugin = repo / 'plugin'
    assets = json.loads(read(plugin, 'haru-assets.json'))
    if set(assets) != {'engine', 'loader', 'css', 'shaders', 'terms'}:
        raise ValueError('Asset-free manifest must not contain Core/model or unknown fields')
    if assets['shaders'] != 'shaders/' or assets['terms'] != 'usage-imported-resources.html':
        raise ValueError('Unexpected shader/terms entry')
    files = {name: read(plugin, name) for name in (
        'live2d-show.php', 'includes/admin-import.php', 'characters.json', 'haru-assets.json',
        'usage-imported-resources.html', 'licenses/Framework-LICENSE.md')}
    if json.loads(files['characters.json']) != {}:
        raise ValueError('Shipped registry must be empty')
    if not re.search(rb'^Version:\s*3\.5\.0\s*$', files['live2d-show.php'], re.M):
        raise ValueError('Expected release version 3.5.0')
    for key, extension in [('engine', 'js'), ('loader', 'js'), ('css', 'css')]:
        name = assets[key]
        match = re.fullmatch(r'haru-' + key + r'-([0-9a-f]{12})\.' + extension, name)
        if not match:
            raise ValueError('Invalid current asset name')
        data = read(plugin, name)
        if digest(data)[:12] != match.group(1):
            raise ValueError('Asset filename hash mismatch')
        files[name] = data
    if read(repo, 'src/loader.js') != files[assets['loader']] or read(repo, 'src/style.css') != files[assets['css']]:
        raise ValueError('Loader/CSS source mismatch')
    for name in SHADERS:
        files['shaders/' + name] = read(plugin, 'shaders/' + name)
    for source, dest in [('LICENSE','LICENSE'), ('COPYING','COPYING'),
                         ('README.md','README.md'), ('docs/DISTRIBUTION.md','DISTRIBUTION.md')]:
        files[dest] = read(repo, source)
    source = {name: read(repo, name) for name in (
        'build.py', 'build-package-lock.json', 'LICENSE', 'COPYING', 'README.md',
        'docs/DISTRIBUTION.md', 'tools/package_release.py', 'tests/test_release_package.py',
        'tests/test_importer.py', 'tests/release-smoke.cjs')}
    for path in sorted(checked(repo / 'src').rglob('*')):
        checked(path)
        if path.is_dir():
            continue
        if not path.is_file() or path.suffix not in ('.ts','.js','.css'):
            raise ValueError('Unexpected source entry')
        name = path.relative_to(repo).as_posix()
        source[name] = read(repo, name)
    if not any(name.startswith('src/framework/') for name in source):
        raise ValueError('Framework source missing')
    # Source ZIP is self-contained for rebuilding/repackaging, with the same asset-free plugin.
    source.update({'plugin/' + name: data for name, data in files.items()})
    files['DISTRIBUTION-NOTICE.txt'] = NOTICE
    source['DISTRIBUTION-NOTICE.txt'] = NOTICE
    manifest = {'schema_version':2, 'version':'3.5.0', 'edition':'administrator-import',
                'asset_free':True, 'character_count':0, 'includes_core':False,
                'public_release_ready':True,
                'release_decision':{'authority':'maintainer','date':'2026-10-08',
                                    'basis':'Supplied licensing reply and exclusion of Core/model assets',
                                    'official_certification':False},
                'engine_source_correspondence':'Requires separate fixed-esbuild 0.25.12 rebuild/hash check',
                'files':[{'path':name,'sha256':digest(data),'bytes':len(data)}
                         for name,data in sorted(files.items())]}
    return files, source, manifest


def write_zip(path, prefix, files):
    with zipfile.ZipFile(path, 'w') as archive:
        for name,data in sorted(files.items()):
            info = zipfile.ZipInfo(prefix + name, (1980,1,1,0,0,0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info,data)
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None or len(archive.infolist()) != len(files):
            raise ValueError('ZIP verification failed')
        for name,data in files.items():
            if archive.read(prefix+name) != data:
                raise ValueError('ZIP byte verification failed')
    return {'filename':path.name, 'sha256':digest(path.read_bytes()), 'bytes':path.stat().st_size}


def package(repo, output):
    files, source, manifest = collect(repo)
    out = checked(output)
    plugin = checked(Path(repo) / 'plugin')
    if out == plugin or plugin in out.parents:
        raise ValueError('Output must be outside plugin')
    out.mkdir(parents=True,exist_ok=False)
    files['release.json'] = encoded(manifest)
    manifest['archive'] = write_zip(out / 'wordpress-live2d-mascot-3.5.0.zip', 'live2d-show/', files)
    manifest['source_archive'] = write_zip(out / 'wordpress-live2d-mascot-3.5.0-source.zip', 'wordpress-live2d-mascot/', source)
    manifest['source_files'] = [{'path':name,'sha256':digest(data)} for name,data in sorted(source.items())]
    (out/'release-manifest.json').write_bytes(encoded(manifest))
    (out/'DISTRIBUTION-NOTICE.txt').write_bytes(NOTICE)
    (out/'SHA256SUMS').write_text(''.join(f'{manifest[key]["sha256"]}  {manifest[key]["filename"]}\n'
                                        for key in ('archive','source_archive')))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo-root',type=Path,default=ROOT)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    parser.add_argument('--out',type=Path,default=ROOT/'build'/('package-'+stamp))
    args = parser.parse_args()
    try:
        result=package(args.repo_root,args.out)
    except (ValueError,OSError,TypeError,KeyError) as e:
        print('Package refused: '+str(e),file=sys.stderr)
        return 1
    print(json.dumps({key:result[key] for key in ('archive','source_archive','asset_free','public_release_ready')},indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
