"""Asset-free package security and corresponding-source regressions."""
import json
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tools.package_release import SHADERS, digest, package


class ReleasePackageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='mascot-package-test-')
        self.repo=Path(self.temp.name)/'repo'
        self.repo.mkdir()
        self.out=Path(self.temp.name)/'package'
        names=['build.py','package.json','package-lock.json','LICENSE','COPYING','README.md','docs/DISTRIBUTION.md',
               'tools/package_release.py','tests/test_release_package.py','tests/test_importer.py','tests/release-smoke.cjs','tests/test_release_pipeline.py',
               'tools/ci.py','tools/verify_release.py',
               'src/loader.js','src/style.css','src/engine.ts','src/resources.ts','src/framework/live2dcubismframework.ts',
               'plugin/live2d-show.php','plugin/includes/admin-import.php','plugin/characters.json','plugin/haru-assets.json',
               'plugin/usage-imported-resources.html','plugin/licenses/Framework-LICENSE.md']
        assets=json.loads((ROOT/'plugin/haru-assets.json').read_bytes())
        names += ['plugin/'+assets[key] for key in ['engine','loader','css']]
        names += ['plugin/shaders/'+name for name in SHADERS]
        for name in names:
            target=self.repo/name;target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes((ROOT/name).read_bytes())
        # Fixture version is stable even when the real plugin advances.
        entry=self.repo/'plugin/live2d-show.php'
        entry.write_bytes(re.sub(rb'^(Version:\s*)\S+', rb'\g<1>3.5.0', entry.read_bytes(), flags=re.M))

    def tearDown(self): self.temp.cleanup()

    def test_ignores_all_old_core_models_metadata_and_private_files(self):
        for name in ['plugin/vendor/core.js','plugin/haru/Haru.model3.json','plugin/haru/a.png',
                     'plugin/model_provenance.json','plugin/source-lock.json','plugin/backup.sql',
                     'plugin/haru/idle.motion3.json','build/secret.json']:
            target=self.repo/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b'NOT FOR RELEASE')
        report=package(self.repo,self.out)
        self.assertTrue(report['asset_free']);self.assertEqual(report['character_count'],0)
        self.assertTrue(report['public_release_ready'])
        self.assertFalse(report['release_decision']['official_certification'])
        self.assertNotIn('review_pending',report)
        for key in ['archive','source_archive']:
            path=self.out/report[key]['filename']
            self.assertEqual(digest(path.read_bytes()),report[key]['sha256'])
            with zipfile.ZipFile(path) as archive:
                for name in archive.namelist():
                    self.assertNotIn('LOCAL-CANDIDATE',name)
                    self.assertNotIn('release-candidate',name)
                    self.assertFalse(any(word in name for word in ['/vendor/','/haru/','model_provenance','source-lock','backup.sql','.png','.moc3','.model3.json','.motion3.json','.exp3.json']))
                self.assertTrue(any(name.endswith('includes/admin-import.php') for name in archive.namelist()))

    def test_source_zip_repackages_without_binary_assets(self):
        first=package(self.repo,self.out)
        extracted=Path(self.temp.name)/'source'
        with zipfile.ZipFile(self.out/first['source_archive']['filename']) as archive:archive.extractall(extracted)
        repo=extracted/'wordpress-live2d-mascot'
        output=extracted/'repacked'
        result=subprocess.run([sys.executable,str(repo/'tools/package_release.py'),'--out',str(output)],cwd=repo,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        second=json.loads((output/'release-manifest.json').read_bytes())
        self.assertEqual(first['archive']['sha256'],second['archive']['sha256'])
        self.assertEqual(first['source_archive']['sha256'],second['source_archive']['sha256'])

    def test_dirty_manifest_registry_hash_and_source_fail_closed(self):
        assets_path=self.repo/'plugin/haru-assets.json';old=assets_path.read_bytes()
        assets=json.loads(old);assets['core']='vendor/core.js';assets_path.write_text(json.dumps(assets))
        with self.assertRaises(ValueError):package(self.repo,self.out)
        assets_path.write_bytes(old)
        (self.repo/'plugin/characters.json').write_text('{"haru":{}}')
        with self.assertRaises(ValueError):package(self.repo,self.out)
        (self.repo/'plugin/characters.json').write_text('{}')
        loader=self.repo/'plugin'/assets['loader'];original=loader.read_bytes();loader.write_bytes(b'changed')
        with self.assertRaises(ValueError):package(self.repo,self.out)
        loader.write_bytes(original);(self.repo/'src/style.css').write_bytes(b'changed')
        with self.assertRaises(ValueError):package(self.repo,self.out)
        self.assertFalse(self.out.exists())

    def test_symlink_missing_shader_and_existing_output_refused(self):
        target=self.repo/'plugin/shaders'/SHADERS[0];old=target.read_bytes();target.unlink()
        with self.assertRaises(ValueError):package(self.repo,self.out)
        target.symlink_to(self.repo/'README.md')
        with self.assertRaises(ValueError):package(self.repo,self.out)
        target.unlink();target.write_bytes(old)
        self.out.mkdir()
        with self.assertRaises(FileExistsError):package(self.repo,self.out)
        with self.assertRaises(ValueError):package(self.repo,self.repo/'plugin/out')
        with self.assertRaises(ValueError):package(self.repo,self.repo/'build/../plugin/escaped-out')


if __name__ == '__main__':unittest.main()
