#!/usr/bin/env python3
"""Package current runtime dependencies as a private, license-pending installation candidate."""
import argparse
import datetime
import json
import pathlib
import re
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from model_tools import digest, encoded, local_file, no_symlinks, parse_json, safe, validate

# Cubism SDK Web 5 R5 shader dependency set. Review when upgrading Framework.
SHADERS = (
    'fragshadersrcalphablend.frag', 'fragshadersrccolorblend.frag',
    'fragshadersrccopy.frag', 'fragshadersrcmaskinvertedpremultipliedalpha.frag',
    'fragshadersrcmaskpremultipliedalpha.frag', 'fragshadersrcpremultipliedalpha.frag',
    'fragshadersrcpremultipliedalphablend.frag', 'fragshadersrcsetupmask.frag',
    'vertshadersrc.vert', 'vertshadersrcblend.vert', 'vertshadersrccopy.vert',
    'vertshadersrcmasked.vert', 'vertshadersrcsetupmask.vert',
)
LICENSES = ('Core-LICENSE.md', 'Core-RedistributableFiles.txt',
            'Framework-LICENSE.md', 'Samples-LICENSE.md')
OFFICIAL_CHARACTERS = frozenset((
    'haru', 'mao', 'hiyori', 'mark', 'rice', 'wanko', 'ren', 'epsilon',
    'chitose', 'hibiki', 'izumi', 'haruto', 'koharu', 'ni-j', 'nico',
    'nietzsche', 'nipsilon', 'nito', 'shizuku', 'tororo', 'hijiki',
    'gantzert_felixander',
))
LOADER_COLLECTION_TEXT = '角色包括 Live2D 官方样例与本站使用 AIGC 工具制作的同人模型。'
LOADER_OFFICIAL_TEXT = '角色包括 Live2D 官方样例。'
SITE_TERMS_VERSION = '2026-09-15-collection-v3'
OFFICIAL_TERMS_VERSION = '2026-10-06-official-candidate-v1'
SOURCE_README = '''# Live2D Show — official samples edition

This source candidate corresponds to the accompanying installation ZIP and its
SHA256SUMS/release-manifest.json. It contains 22 official sample characters in its
configuration. User-created character assets are excluded. Original code uses
GPL-2.0-or-later with the additional Web 5 R5 permission specified in LICENSE;
third-party components retain their separate licenses. Local candidate status
does not authorize public redistribution: read LICENSE, COPYING and
docs/DISTRIBUTION.md before distribution.

The installation ZIP has a live2d-show/ root and contains all runtime resources.
The source ZIP has a live2d-show-source/ root; its plugin/ initially contains only
configuration, PHP, notices and terms. Binary models and Core are in the matching
installation ZIP. To reproduce or package, unpack both ZIPs and copy the contents
of live2d-show/ into live2d-show-source/plugin/. Keep the matching archives and hashes.

Requirements: Python 3, Node.js, esbuild exactly 0.25.12; PHP 8.2 and a separately
installed Playwright/Chromium for the optional browser smoke. Tools do not download
models or modify a WordPress site.

From live2d-show-source/:

```sh
python3 -m unittest discover -s tests -p 'test_release_package.py'
python3 build.py --esbuild /path/to/esbuild
```

build.py writes the rebuilt engine/loader/CSS and haru-assets.json to build/.
Compare them to the corresponding files in plugin/. To package intentional source
changes, copy the newly generated haru-engine-*.js, haru-loader-*.js, haru-css-*.css
and haru-assets.json from build/ into plugin/ after review; preserve the other
runtime resources from the matching installation ZIP. Then run:

```sh
python3 tools/package_release.py --out build/repacked-candidate
node tests/release-smoke.cjs plugin /path/to/node_modules/playwright
```

The packager accepts the matching 22-character official edition or the explicitly
recognized original site input, rejects unknown characters/roots and verifies
asset hashes. It checks loader/CSS source bytes against the runtime but does not
compile engine source to prove correspondence: rebuild with the fixed esbuild and
compare the engine hash separately. Existing output directories are refused. Every output remains a
license-pending local candidate, with installation ZIP, source ZIP and SHA256SUMS.
The browser smoke uses WordPress PHP stubs; it does not replace a real WordPress
installation/activation test.

Framework source retains its separate license. The project license applies only
to the listed original code; included third-party components are not relicensed.
'''.encode('utf-8')
HASHED_ASSETS = {
    'core': r'vendor/cubism-core-([0-9a-f]{12})\.js',
    'engine': r'haru-engine-([0-9a-f]{12})\.js',
    'loader': r'haru-loader-([0-9a-f]{12})\.js',
    'css': r'haru-css-([0-9a-f]{12})\.css',
    'terms': r'usage-collection-([0-9a-f]{12})\.html',
}
NOTICE = (
    'LOCAL INSTALLATION CANDIDATE — NOT APPROVED FOR PUBLIC DISTRIBUTION\n'
    'Runtime dependency completeness and hashes are checked; license permission is not.\n'
    'Core, Framework, sample models and controller code\n'
    'require separate redistribution review. Included terms and notices do not grant\n'
    'new redistribution rights. Do not upload this candidate to a public repository\n'
    'or GitHub Release before completing that review.\n'
).encode('utf-8')


def collect(plugin_root):
    """Capture bytes once; never traverse unrelated model/history/backup directories."""
    root = no_symlinks(plugin_root)
    files = {}
    reasons = {}

    def add(name, reason):
        safe(name)
        if name not in files:
            files[name] = local_file(root, name).read_bytes()
        reasons.setdefault(name, set()).add(reason)
        return files[name]

    def read(name, reason):
        obj = parse_json(add(name, reason), name)
        if not isinstance(obj, dict):
            raise ValueError(f'JSON root must be an object: {name}')
        return obj

    entry = add('live2d-show.php', 'WordPress entry')
    version_match = re.search(rb'^Version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$', entry, re.M)
    if not version_match:
        raise ValueError('Missing semantic plugin Version header')
    version = version_match.group(1).decode('ascii')
    registry = read('characters.json', 'Current character registry')
    ids = set(registry)
    if ids == OFFICIAL_CHARACTERS | {'misaka-summer'}:
        site_input = True
    elif ids == OFFICIAL_CHARACTERS:
        site_input = False
    else:
        unknown = ids - OFFICIAL_CHARACTERS - {'misaka-summer'}
        if unknown:
            raise ValueError('Unreviewed character IDs: ' + ', '.join(sorted(unknown)))
        raise ValueError('Current official 22-character set is incomplete')
    assets = read('haru-assets.json', 'Current asset manifest')
    for key, pattern in HASHED_ASSETS.items():
        name = assets.get(key)
        match = re.fullmatch(pattern, name) if isinstance(name, str) else None
        if not match:
            raise ValueError(f'Invalid hashed asset filename for {key}: {name!r}')
        if digest(add(name, f'Current {key}'))[:12] != match.group(1):
            raise ValueError(f'Asset filename hash mismatch: {name}')
    old_loader = assets['loader']
    loader = files.pop(old_loader).decode('utf-8')
    reasons.pop(old_loader)
    expected_text = LOADER_COLLECTION_TEXT if site_input else LOADER_OFFICIAL_TEXT
    unexpected_text = LOADER_OFFICIAL_TEXT if site_input else LOADER_COLLECTION_TEXT
    if loader.count(expected_text) != 1 or unexpected_text in loader:
        raise ValueError('Cannot identify official-edition consent text')
    loader_data = loader.replace(LOADER_COLLECTION_TEXT, LOADER_OFFICIAL_TEXT).encode('utf-8')
    new_loader = 'haru-loader-' + digest(loader_data)[:12] + '.js'
    files[new_loader] = loader_data
    reasons[new_loader] = {'Derived official-only consent text'}
    assets['loader'] = new_loader
    source = read('source-lock.json', 'Runtime provenance')
    if source.get('core_name') != pathlib.PurePosixPath(assets['core']).name:
        raise ValueError('Core filename differs from source-lock')
    if source.get('core_sha256') != digest(files[assets['core']]):
        raise ValueError('Core full hash differs from source-lock')
    shader_root = str(safe(assets.get('shaders'), directory=True))
    if not assets.get('shaders', '').endswith('/'):
        raise ValueError('Shader root must end with /')
    for name in SHADERS:
        add(shader_root + '/' + name, 'SDK Web 5 R5 shader')
    for name in LICENSES:
        add('licenses/' + name, 'Original third-party notice; not authorization')
    for source_path, target in [('LICENSE', 'LICENSE'), ('COPYING', 'COPYING'),
                                ('docs/DISTRIBUTION.md', 'DISTRIBUTION.md')]:
        files[target] = local_file(root.parent, source_path).read_bytes()
        reasons[target] = {'Project code license and distribution boundary'}
    registry = {ident: config for ident, config in registry.items()
                if ident in OFFICIAL_CHARACTERS}
    files['characters.json'] = encoded(registry)
    reasons['characters.json'].add('Derived official-only registry; excludes misaka-summer')
    # Produce candidate-only terms and entry; never alter the production mirror.
    old_terms = assets['terms']
    terms = files.pop(old_terms).decode('utf-8')
    reasons.pop(old_terms)
    expected_version = SITE_TERMS_VERSION if site_input else OFFICIAL_TERMS_VERSION
    unexpected_version = OFFICIAL_TERMS_VERSION if site_input else SITE_TERMS_VERSION
    if terms.count(expected_version) != 1 or unexpected_version in terms:
        raise ValueError('Terms edition marker differs from registry edition')
    if site_input:
        terms, removed = re.subn(r'<h2 id="misaka-summer">.*?(?=<h2>)', '', terms, flags=re.S)
        if removed != 1:
            raise ValueError('Cannot identify exactly one excluded character terms section')
        terms = terms.replace('本站', '本插件').replace(SITE_TERMS_VERSION, OFFICIAL_TERMS_VERSION)
    if any(text in terms for text in ['misaka-summer', '御坂', 'AIGC', '同人', '本站']):
        raise ValueError('Official terms retain excluded-character or site-edition text')
    terms_data = terms.encode('utf-8')
    new_terms = 'usage-collection-' + digest(terms_data)[:12] + '.html'
    files[new_terms] = terms_data
    reasons[new_terms] = {'Derived official-only terms; redistribution review pending'}
    assets['terms'] = new_terms
    files['haru-assets.json'] = encoded(assets)
    old_version = ("'termsVersion'=>'" + expected_version + "'").encode('ascii')
    if entry.count(old_version) != 1 or unexpected_version.encode('ascii') in entry:
        raise ValueError('Cannot identify current termsVersion in plugin entry')
    files['live2d-show.php'] = entry.replace(
        old_version, ("'termsVersion'=>'" + OFFICIAL_TERMS_VERSION + "'").encode('ascii')).replace(
        '本站看板娘控制器，使用官方样例与站长自制角色和 Cubism SDK。'.encode(),
        '看板娘控制器，使用官方样例与 Cubism SDK。'.encode())
    roots = set()
    for ident, config in registry.items():
        if not isinstance(ident, str) or not ident or not isinstance(config, dict):
            raise ValueError('Invalid character registry item')
        prefix = str(safe(config.get('root'), directory=True))
        if not config.get('root', '').endswith('/'):
            raise ValueError(f'Character root must end with /: {ident}')
        if config['root'] != ident + '/':
            raise ValueError(f'Official character root differs from reviewed mapping: {ident}')
        roots.add(prefix + '/')
        # Haru contains independently source-recorded catalog-only motions. All
        # catalog files are explicitly collected below; no loose files are included.
        result = validate(root / prefix, config.get('file'), config, allow_extra=True)
        if not result['ok']:
            raise ValueError(f'Invalid character {ident}: ' + '; '.join(result['errors']))

        def model_add(name, suffix):
            relative = safe(name)
            if not name.endswith(suffix):
                raise ValueError(f'Unexpected model dependency format: {name}')
            return add(prefix + '/' + str(relative), f'Character {ident}')

        model = parse_json(model_add(config['file'], '.model3.json'), 'model')
        refs = model['FileReferences']
        model_add(refs['Moc'], '.moc3')
        for name in refs['Textures']:
            model_add(name, '.png')
        for key in ('Physics', 'Pose', 'UserData', 'DisplayInfo'):
            if key in refs:
                model_add(refs[key], '.json')
        for items in refs.get('Motions', {}).values():
            for item in items:
                model_add(item['File'], '.motion3.json')
        for item in refs.get('Expressions', []):
            model_add(item['File'], '.exp3.json')
        catalog = parse_json(model_add('catalog.json', '.json'), 'catalog')
        for kind, suffix in [('motions', '.motion3.json'), ('expressions', '.exp3.json')]:
            for item in catalog[kind]:
                model_add(item['file'], suffix)
    default_root = str(safe(assets.get('model'), directory=True)) + '/'
    if default_root not in roots:
        raise ValueError('Default model root is not in current registry')
    manifest = {
        'schema_version': 1, 'kind': 'local-installation-candidate', 'version': version,
        'archive_root': 'live2d-show/', 'edition': 'official-samples-22',
        'excluded_characters': ['misaka-summer'], 'public_release_ready': False,
        'license_review': {
            'status': 'pending',
            'components': ['controller', 'Framework', 'Core', 'official sample models'],
            'note': 'Completeness and original notices do not prove redistribution permission',
        },
        'characters': list(registry), 'character_count': len(registry),
        'files': [{'path': name, 'sha256': digest(data), 'bytes': len(data),
                   'reasons': sorted(reasons[name])} for name, data in sorted(files.items())],
    }
    return files, manifest


def source_files(plugin_root, runtime):
    """Corresponding preferred-form source, excluding history and binary models."""
    repo = no_symlinks(plugin_root).parent
    payload = {}
    fixed = ('build.py', 'build-package-lock.json', 'model_tools.py', 'LICENSE', 'COPYING',
             'docs/DISTRIBUTION.md', 'tools/package_release.py',
             'tests/test_release_package.py', 'tests/release-smoke.cjs')
    for name in fixed:
        payload[name] = local_file(repo, name).read_bytes()
    payload['README.md'] = SOURCE_README
    src = no_symlinks(repo / 'src')
    if not src.is_dir():
        raise ValueError('Missing preferred-form src directory')
    for path in sorted(src.rglob('*')):
        no_symlinks(path)
        if path.is_dir():
            continue
        if not path.is_file() or path.suffix not in ('.ts', '.js', '.css'):
            raise ValueError(f'Unexpected source entry: {path.name}')
        name = path.relative_to(repo).as_posix()
        payload[name] = local_file(repo, name).read_bytes()
    loader_source = payload.get('src/loader.js', b'').decode('utf-8')
    site_text = loader_source.count(LOADER_COLLECTION_TEXT)
    official_text = loader_source.count(LOADER_OFFICIAL_TEXT)
    if (site_text, official_text) not in [(1, 0), (0, 1)]:
        raise ValueError('Cannot derive corresponding official loader source')
    payload['src/loader.js'] = loader_source.replace(
        LOADER_COLLECTION_TEXT, LOADER_OFFICIAL_TEXT).encode('utf-8')
    runtime_assets = parse_json(runtime['haru-assets.json'], 'candidate assets')
    if payload['src/loader.js'] != runtime[runtime_assets['loader']]:
        raise ValueError('Corresponding loader source differs from packaged runtime')
    if payload.get('src/style.css') != runtime[runtime_assets['css']]:
        raise ValueError('Corresponding CSS source differs from packaged runtime')
    if not any(name.startswith('src/framework/') for name in payload):
        raise ValueError('Missing corresponding Framework source')
    for name in ('live2d-show.php', 'characters.json', 'haru-assets.json', 'source-lock.json'):
        payload['plugin/' + name] = runtime[name]
    for name, data in runtime.items():
        if name.startswith('licenses/') or name.startswith('usage-collection-'):
            payload['plugin/' + name] = data
    payload['LOCAL-CANDIDATE.txt'] = NOTICE
    return payload


def write_zip(path, prefix, payload):
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(payload.items()):
            info = zipfile.ZipInfo(prefix + name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    with zipfile.ZipFile(path) as archive:
        if len(archive.infolist()) != len(payload) or archive.testzip() is not None:
            raise ValueError('ZIP verification failed')
        for name, data in payload.items():
            if archive.read(prefix + name) != data:
                raise ValueError(f'ZIP byte verification failed: {name}')
    return {'filename': path.name, 'sha256': digest(path.read_bytes()),
            'bytes': path.stat().st_size}


def package(plugin_root, output):
    files, manifest = collect(plugin_root)
    sources = source_files(plugin_root, files)
    out = no_symlinks(output)
    root = no_symlinks(plugin_root)
    if out == root or root in out.parents:
        raise ValueError('Output must be outside plugin resource tree')
    # Refuse existing output rather than overwrite earlier evidence or candidates.
    out.mkdir(parents=True, exist_ok=False)
    name = f'live2d-show-{manifest["version"]}-official-local-candidate.zip'
    archive_path = out / name
    payload = dict(files)
    payload['LOCAL-CANDIDATE.txt'] = NOTICE
    payload['release-candidate.json'] = encoded(manifest)
    manifest['archive'] = write_zip(archive_path, 'live2d-show/', payload)
    source_name = f'live2d-show-{manifest["version"]}-official-source-candidate.zip'
    manifest['source_archive'] = write_zip(out / source_name, 'live2d-show-source/', sources)
    manifest['source_files'] = [{'path': path, 'sha256': digest(data), 'bytes': len(data)}
                                for path, data in sorted(sources.items())]
    (out / 'release-manifest.json').write_bytes(encoded(manifest))
    (out / 'SHA256SUMS').write_text(''.join(
        f'{manifest[key]["sha256"]}  {manifest[key]["filename"]}\n'
        for key in ['archive', 'source_archive']), encoding='ascii')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plugin-root', type=pathlib.Path, default=ROOT / 'plugin')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    parser.add_argument('--out', type=pathlib.Path, default=ROOT / 'build' / ('package-' + stamp))
    args = parser.parse_args()
    try:
        manifest = package(args.plugin_root, args.out)
    except (ValueError, OSError, TypeError, KeyError) as error:
        print(f'Package refused: {error}', file=sys.stderr)
        return 1
    print(json.dumps({'output': str(args.out.absolute()), 'archive': manifest['archive'],
                      'source_archive': manifest['source_archive'],
                      'character_count': manifest['character_count'],
                      'runtime_files': len(manifest['files']), 'public_release_ready': False}, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
