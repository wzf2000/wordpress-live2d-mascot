"""Synthetic full-package dependency/security tests; no production or network access."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from model_tools import digest, encoded
from tools.package_release import (LICENSES, LOADER_COLLECTION_TEXT, LOADER_OFFICIAL_TEXT,
                                  OFFICIAL_CHARACTERS, SHADERS, SOURCE_README, collect, package)


class ReleasePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='live2d-package-test-')
        self.root = pathlib.Path(self.temp.name)
        self.plugin = self.root / 'plugin'
        self.plugin.mkdir()
        self.out = self.root / 'candidate'
        self.write('live2d-show.php', b'<?php\n/*\nVersion: 3.4.0\n*/\n'
                   b"$config=['termsVersion'=>'2026-09-15-collection-v3'];")
        self.assets = {'model': 'haru/', 'shaders': 'shaders/'}
        for key, extension in [('core', '.js'), ('engine', '.js'), ('loader', '.js'),
                               ('css', '.css'), ('terms', '.html')]:
            data = key.encode() if key != 'terms' else (
                '<h2 id="misaka-summer">Excluded character<p>text</p>'
                '<h2>本站 terms</h2>2026-09-15-collection-v3').encode()
            if key == 'loader':
                data = LOADER_COLLECTION_TEXT.encode('utf-8')
            prefix = 'vendor/cubism-core-' if key == 'core' else (
                'usage-collection-' if key == 'terms' else 'haru-' + key + '-')
            name = prefix + digest(data)[:12] + extension
            self.assets[key] = name
            self.write(name, data)
        self.write('haru-assets.json', self.assets)
        self.write('source-lock.json', {'core_name': pathlib.Path(self.assets['core']).name,
                                      'core_sha256': digest(b'core')})
        for name in SHADERS:
            self.write('shaders/' + name, b'synthetic shader')
        for name in LICENSES:
            self.write('licenses/' + name, b'synthetic upstream license')
        for name in ['LICENSE', 'COPYING', 'docs/DISTRIBUTION.md']:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'synthetic project license')
        for name in ['build.py', 'build-package-lock.json', 'model_tools.py', 'README.md',
                     'tools/package_release.py', 'tests/test_release_package.py',
                     'tests/release-smoke.cjs',
                     'src/engine.ts', 'src/framework/example.ts', 'src/loader.js']:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'synthetic source')
        for name in ['tools/package_release.py', 'model_tools.py', 'build.py']:
            (self.root / name).write_bytes((ROOT / name).read_bytes())
        (self.root / 'src/loader.js').write_bytes(LOADER_COLLECTION_TEXT.encode('utf-8'))
        (self.root / 'src/style.css').write_bytes(b'css')
        self.registry = {}
        for ident in sorted(OFFICIAL_CHARACTERS | {'misaka-summer'}):
            self.registry[ident] = {'name': ident, 'root': ident + '/', 'file': 'Model.model3.json',
                                    'idle': 'idle', 'greetings': [], 'size': 180, 'offset': 0}
            self.write(ident + '/Model.model3.json', {'Version': 3, 'FileReferences': {
                'Moc': 'Model.moc3', 'Textures': ['textures/a.png'],
                'Motions': {'Idle': [{'File': 'idle.motion3.json'}]}, 'Expressions': []}})
            self.write(ident + '/Model.moc3', b'MOC3synthetic')
            self.write(ident + '/textures/a.png', b'synthetic image')
            self.write(ident + '/idle.motion3.json', {'Version': 3})
            self.write(ident + '/catalog.json', {
                'motions': [{'id': 'idle', 'file': 'idle.motion3.json', 'label': 'Idle'},
                            {'id': 'extra', 'file': 'extra.motion3.json', 'label': 'Extra'}],
                'expressions': []})
            self.write(ident + '/extra.motion3.json', {'Version': 3})
        self.write('characters.json', self.registry)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name, value):
        path = self.plugin / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(encoded(value) if isinstance(value, (dict, list)) else value)

    def test_complete_official_archive_and_original_unchanged(self):
        original = {name: (self.plugin / name).read_bytes()
                    for name in ['characters.json', 'haru-assets.json', 'live2d-show.php']}
        for name in ['backup/private.sql', 'retired/Secret.moc3',
                     'haru/unused.png', 'haru-loader-000000000000.js']:
            self.write(name, b'not a dependency')
        report = package(self.plugin, self.out)
        self.assertEqual(report['character_count'], 22)
        self.assertFalse(report['public_release_ready'])
        self.assertEqual(report['license_review']['status'], 'pending')
        archive = self.out / report['archive']['filename']
        self.assertEqual(digest(archive.read_bytes()), report['archive']['sha256'])
        with zipfile.ZipFile(archive) as contents:
            names = contents.namelist()
            self.assertTrue(all(name.startswith('live2d-show/') for name in names))
            self.assertIn('live2d-show/haru/extra.motion3.json', names)
            self.assertIn('live2d-show/haru/Model.moc3', names)
            self.assertIn('live2d-show/haru/textures/a.png', names)
            self.assertIn('live2d-show/COPYING', names)
            self.assertFalse(any('misaka-summer/' in name or 'backup/' in name or
                                 'retired/' in name or 'unused' in name or '000000000000' in name
                                 for name in names))
            registry = json.loads(contents.read('live2d-show/characters.json'))
            self.assertEqual(set(registry), OFFICIAL_CHARACTERS)
            assets = json.loads(contents.read('live2d-show/haru-assets.json'))
            terms = contents.read('live2d-show/' + assets['terms'])
            self.assertEqual(contents.read('live2d-show/' + assets['loader']),
                             LOADER_OFFICIAL_TEXT.encode('utf-8'))
            self.assertNotIn(b'misaka-summer', terms)
            self.assertIn(b'2026-10-06-official-candidate-v1', terms)
            self.assertIn(b'2026-10-06-official-candidate-v1',
                          contents.read('live2d-show/live2d-show.php'))
            for item in report['files']:
                self.assertEqual(digest(contents.read('live2d-show/' + item['path'])), item['sha256'])
        for name, data in original.items():
            self.assertEqual((self.plugin / name).read_bytes(), data)
        with zipfile.ZipFile(self.out / report['source_archive']['filename']) as source:
            self.assertIn('live2d-show-source/src/framework/example.ts', source.namelist())
            self.assertIn('live2d-show-source/tools/package_release.py', source.namelist())
            self.assertFalse(any(name.endswith('.moc3') for name in source.namelist()))
            self.assertEqual(source.read('live2d-show-source/src/loader.js'),
                             LOADER_OFFICIAL_TEXT.encode('utf-8'))

    def test_missing_texture_and_shader_refused(self):
        for path in ['haru/textures/a.png', 'shaders/' + SHADERS[0]]:
            with self.subTest(path=path):
                target = self.plugin / path
                old = target.read_bytes()
                target.unlink()
                with self.assertRaises(ValueError):
                    package(self.plugin, self.out)
                self.assertFalse(self.out.exists())
                target.write_bytes(old)

    def test_path_escape_and_absolute_refused(self):
        for name in ['../outside/', '/tmp/model/', 'haru//', 'https://example.org/model/']:
            with self.subTest(name=name):
                self.registry['haru']['root'] = name
                self.write('characters.json', self.registry)
                with self.assertRaises(ValueError):
                    collect(self.plugin)

    def test_symlink_file_and_parent_refused(self):
        target = self.plugin / 'haru/textures/a.png'
        target.unlink()
        target.symlink_to(self.plugin / 'mao/textures/a.png')
        with self.assertRaises(ValueError):
            collect(self.plugin)
        target.unlink()
        target.parent.rmdir()
        target.parent.symlink_to(self.plugin / 'mao/textures', target_is_directory=True)
        with self.assertRaises(ValueError):
            collect(self.plugin)

    def test_asset_hash_mismatch_refused(self):
        self.write(self.assets['engine'], b'changed engine')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            collect(self.plugin)

    def test_core_full_hash_mismatch_refused(self):
        self.write('source-lock.json', {'core_name': pathlib.Path(self.assets['core']).name,
                                      'core_sha256': '0' * 64})
        with self.assertRaisesRegex(ValueError, 'full hash'):
            collect(self.plugin)

    def test_unknown_role_and_missing_official_role_refused(self):
        self.registry['future'] = self.registry['haru'].copy()
        self.write('characters.json', self.registry)
        with self.assertRaisesRegex(ValueError, 'Unreviewed'):
            collect(self.plugin)
        del self.registry['future']
        del self.registry['mao']
        self.write('characters.json', self.registry)
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            collect(self.plugin)

    def test_official_id_alias_to_excluded_or_other_root_refused(self):
        for name in ['misaka-summer-v04/', 'mao/', 'misaka-summer-v04/child/']:
            with self.subTest(name=name):
                self.registry['haru']['root'] = name
                self.write('characters.json', self.registry)
                with self.assertRaisesRegex(ValueError, 'reviewed mapping'):
                    collect(self.plugin)

    def test_bad_catalog_dependency_refused(self):
        self.write('haru/catalog.json', {'motions': [
            {'id': 'idle', 'label': 'Idle', 'file': '../private.php'}], 'expressions': []})
        with self.assertRaises(ValueError):
            collect(self.plugin)

    def test_existing_output_and_plugin_output_refused(self):
        self.out.mkdir()
        (self.out / 'keep').write_bytes(b'preserve')
        with self.assertRaises(FileExistsError):
            package(self.plugin, self.out)
        self.assertEqual((self.out / 'keep').read_bytes(), b'preserve')
        with self.assertRaisesRegex(ValueError, 'outside'):
            package(self.plugin, self.plugin / 'out')

    def test_deterministic_zip(self):
        first = package(self.plugin, self.out)
        second = package(self.plugin, self.root / 'second')
        self.assertEqual(first['archive']['sha256'], second['archive']['sha256'])
        self.assertEqual(first['source_archive']['sha256'], second['source_archive']['sha256'])

    def test_source_symlink_refused(self):
        path = self.root / 'src/engine.ts'
        path.unlink()
        path.symlink_to(self.root / 'README.md')
        with self.assertRaises(ValueError):
            package(self.plugin, self.out)
        self.assertFalse(self.out.exists())

    def paired_input(self):
        report = package(self.plugin, self.out)
        extracted = self.root / 'paired'
        with zipfile.ZipFile(self.out / report['source_archive']['filename']) as archive:
            archive.extractall(extracted)
        repo = extracted / 'live2d-show-source'
        with zipfile.ZipFile(self.out / report['archive']['filename']) as archive:
            for item in archive.infolist():
                relative = pathlib.PurePosixPath(item.filename).relative_to('live2d-show')
                target = repo / 'plugin' / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(item))
        return report, repo

    def test_paired_source_runtime_cli_repack_is_identical(self):
        report, repo = self.paired_input()
        self.assertEqual((repo / 'README.md').read_bytes(), SOURCE_README)
        self.assertNotIn(b'23', (repo / 'README.md').read_bytes())
        self.assertTrue((repo / 'tests/release-smoke.cjs').is_file())
        destination = repo / 'build/repacked'
        result = subprocess.run([sys.executable, str(repo / 'tools/package_release.py'),
                                 '--out', str(destination)], cwd=repo,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        repacked = json.loads((destination / 'release-manifest.json').read_bytes())
        self.assertFalse(repacked['public_release_ready'])
        self.assertEqual(report['archive']['sha256'], repacked['archive']['sha256'])
        self.assertEqual(report['source_archive']['sha256'], repacked['source_archive']['sha256'])

    def test_paired_source_build_entry_and_repack_with_synthetic_esbuild(self):
        report, repo = self.paired_input()
        fake = self.root / 'synthetic-esbuild'
        fake.write_text('#!' + sys.executable + '\n'
                        'import pathlib, sys\n'
                        'if sys.argv[1:] == ["--version"]: print("0.25.12")\n'
                        'else:\n'
                        '    target = next(x.split("=", 1)[1] for x in sys.argv '
                        'if x.startswith("--outfile="))\n'
                        '    pathlib.Path(target).write_bytes(b"engine")\n')
        fake.chmod(0o755)
        build = subprocess.run([sys.executable, str(repo / 'build.py'), '--esbuild', str(fake)],
                               cwd=repo, capture_output=True, text=True)
        self.assertEqual(build.returncode, 0, build.stderr)
        original_assets = json.loads((repo / 'plugin/haru-assets.json').read_bytes())
        rebuilt_assets = json.loads((repo / 'build/haru-assets.json').read_bytes())
        self.assertEqual(original_assets, rebuilt_assets)
        for key in ['engine', 'loader', 'css']:
            self.assertEqual((repo / 'plugin' / original_assets[key]).read_bytes(),
                             (repo / 'build' / rebuilt_assets[key]).read_bytes())
        repacked = package(repo / 'plugin', repo / 'build/rebuilt-package')
        self.assertEqual(report['archive']['sha256'], repacked['archive']['sha256'])

    def test_official_input_unknown_role_and_alias_refused(self):
        _, repo = self.paired_input()
        registry_path = repo / 'plugin/characters.json'
        registry = json.loads(registry_path.read_bytes())
        registry['future'] = registry['haru'].copy()
        registry_path.write_bytes(encoded(registry))
        with self.assertRaisesRegex(ValueError, 'Unreviewed'):
            collect(repo / 'plugin')
        del registry['future']
        registry['haru']['root'] = 'misaka-summer-v04/'
        registry_path.write_bytes(encoded(registry))
        with self.assertRaisesRegex(ValueError, 'reviewed mapping'):
            collect(repo / 'plugin')

    def test_mixed_editions_refused(self):
        # Removing the user-created ID alone must not mark site terms as official.
        del self.registry['misaka-summer']
        self.write('characters.json', self.registry)
        with self.assertRaisesRegex(ValueError, 'consent'):
            collect(self.plugin)

    def test_official_source_runtime_mismatch_refused(self):
        _, repo = self.paired_input()
        (repo / 'src/loader.js').write_bytes(LOADER_COLLECTION_TEXT.encode() + b'changed')
        with self.assertRaisesRegex(ValueError, 'source differs'):
            package(repo / 'plugin', repo / 'build/refused')

    def test_css_source_runtime_mismatch_refused(self):
        (self.root / 'src/style.css').write_bytes(b'changed stylesheet')
        with self.assertRaisesRegex(ValueError, 'CSS source differs'):
            package(self.plugin, self.out)
        self.assertFalse(self.out.exists())


if __name__ == '__main__':
    unittest.main()
