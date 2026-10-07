"""Release identity, tamper, version and whitelist failure regressions."""
import json
from pathlib import Path
import sys
import unittest
import zipfile
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tools.package_release import digest, encoded, package, plugin_version
from tools.verify_release import verify
import test_release_package as fixtures


class PipelineTests(unittest.TestCase):
    setUp=fixtures.ReleasePackageTests.setUp
    tearDown=fixtures.ReleasePackageTests.tearDown

    def proof(self, report, commit='a'*40):
        names=[report[k]['filename'] for k in ('archive','source_archive')]+['SHA256SUMS','release-manifest.json','DISTRIBUTION-NOTICE.txt']
        value={'schema':1,'version':report['version'],'source_commit':commit,
               'files':{name:digest((self.out/name).read_bytes()) for name in names}}
        (self.out/'release-validation.json').write_bytes(encoded(value))

    def test_full_proof_and_wrong_commit_version_or_attachment(self):
        report=package(self.repo,self.out,'3.5.0','a'*40)
        self.proof(report)
        verify(self.out,'3.5.0','a'*40,True)
        for version,commit in [('3.5.1','a'*40),('3.5.0','b'*40)]:
            with self.assertRaises(ValueError):verify(self.out,version,commit,True)
        (self.out/'unexpected.txt').write_bytes(b'not allowed')
        with self.assertRaises(ValueError):verify(self.out,'3.5.0','a'*40,True)
        (self.out/'unexpected.txt').unlink()
        (self.out/'DISTRIBUTION-NOTICE.txt').write_bytes(b'changed')
        with self.assertRaises(ValueError):verify(self.out,'3.5.0','a'*40,True)

    def test_new_php_version_is_used_without_old_visual_claim(self):
        path=self.repo/'plugin/live2d-show.php'
        path.write_bytes(path.read_bytes().replace(b'Version: 3.5.0',b'Version: 3.6.0'))
        self.assertEqual(plugin_version(self.repo,'3.6.0'),'3.6.0')
        report=package(self.repo,self.out,'3.6.0','a'*40)
        self.assertEqual(report['version'],'3.6.0')
        self.assertEqual(report['archive']['filename'],'wordpress-live2d-mascot-3.6.0.zip')
        notice=(self.out/'DISTRIBUTION-NOTICE.txt').read_text()
        self.assertIn('3.6.0',notice);self.assertNotIn('37',notice)
        self.proof(report);verify(self.out,'3.6.0','a'*40,True)

    def test_mismatch_malformed_identity_and_duplicate_header_fail_closed(self):
        for version,commit in [('3.6.0','a'*40),('3.05.0','a'*40),('3.5.0','main'),('3.5.0','a'*39),('3.5.0\nmalicious','a'*40)]:
            with self.subTest(version=version):
                with self.assertRaises(ValueError):package(self.repo,self.out,version,commit)
        path=self.repo/'plugin/live2d-show.php';path.write_bytes(path.read_bytes()+b'\nVersion: 3.5.0\n')
        with self.assertRaises(ValueError):plugin_version(self.repo)
        self.assertFalse(self.out.exists())

    def test_unexpected_source_script_and_asset_rejected(self):
        for name in ['src/core.js','src/framework/extra.js','src/model.moc3']:
            with self.subTest(name=name):
                target=self.repo/name;target.write_bytes(b'not distributable')
                with self.assertRaises(ValueError):package(self.repo,self.out)
                target.unlink()
        self.assertFalse(self.out.exists())

    def test_source_archive_whitelist_catches_rehashed_injection(self):
        report=package(self.repo,self.out,'3.5.0','a'*40)
        path=self.out/report['source_archive']['filename']
        with zipfile.ZipFile(path,'a') as archive:
            archive.writestr('wordpress-live2d-mascot/plugin/model.moc3',b'bad')
        data=path.read_bytes()
        report['source_archive']['sha256']=digest(data);report['source_archive']['bytes']=len(data)
        report['source_files'].append({'path':'plugin/model.moc3','sha256':digest(b'bad')})
        (self.out/'release-manifest.json').write_bytes(encoded(report))
        (self.out/'SHA256SUMS').write_text(''.join(f'{report[k]["sha256"]}  {report[k]["filename"]}\n' for k in ('archive','source_archive')))
        with self.assertRaisesRegex(ValueError,'Source whitelist'):verify(self.out,'3.5.0','a'*40)


if __name__=='__main__':unittest.main()
