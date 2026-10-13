"""Release identity, tamper, version and whitelist failure regressions."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
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


@unittest.skipUnless((ROOT/'.github/workflows/release.yml').is_file(),
                     'Release workflow is available in the Git checkout, not the source ZIP')
class WorkflowPublishTests(unittest.TestCase):
    """Execute the write-token job's independent validator against the current package."""
    proof=PipelineTests.proof

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='mascot-workflow-test-')
        self.addCleanup(self.temp.cleanup)
        self.out=Path(self.temp.name)/'release'
        self.version=plugin_version(ROOT)
        self.report=package(ROOT,self.out,self.version,'a'*40)
        self.proof(self.report)
        workflow=(ROOT/'.github/workflows/release.yml').read_text()
        publish=workflow.split('\n  publish:\n',1)[1]
        self.assertNotIn('actions/checkout',publish)
        step=publish.split("      - name: Validate this run's attachment identity, hashes and closed file sets\n",1)[1]
        scripts=re.findall(r"^          python3 - <<'PY'\n(.*?)^          PY$",step,re.M|re.S)
        self.assertEqual(len(scripts),1,'Expected exactly one independent publish validator')
        self.script=textwrap.dedent(scripts[0])

    def validate(self):
        # Only the two public identities reach this process; no tokens or inherited credentials.
        return subprocess.run([sys.executable,'-I','-c',self.script],cwd=self.out.parent,
                              env={'RELEASE_VERSION':self.version,'SOURCE_SHA':'a'*40},
                              capture_output=True,text=True)

    def test_actual_current_package_passes_inline_publish_validation(self):
        result=self.validate()
        self.assertEqual(result.returncode,0,result.stderr)

    def test_rehashed_unknown_source_file_fails_inline_publish_validation(self):
        report=self.report;path=self.out/report['source_archive']['filename']
        with zipfile.ZipFile(path,'a') as archive:
            archive.writestr('wordpress-live2d-mascot/tools/unapproved.py',b'not allowed')
        data=path.read_bytes()
        report['source_archive']['sha256']=digest(data);report['source_archive']['bytes']=len(data)
        report['source_files'].append({'path':'tools/unapproved.py','sha256':digest(b'not allowed')})
        (self.out/'release-manifest.json').write_bytes(encoded(report))
        (self.out/'SHA256SUMS').write_text(''.join(f'{report[k]["sha256"]}  {report[k]["filename"]}\n' for k in ('archive','source_archive')))
        self.proof(report)
        result=self.validate()
        self.assertNotEqual(result.returncode,0)
        self.assertIn('AssertionError',result.stderr)


@unittest.skipUnless((ROOT/'.github/workflows/release.yml').is_file(),
                     'Release workflow is available in the Git checkout, not the source ZIP')
class WorkflowNotesTests(unittest.TestCase):
    def setUp(self):
        self.node=shutil.which('node')
        self.assertIsNotNone(self.node,'Node.js must be available on the test runner PATH')
        self.temp=tempfile.TemporaryDirectory(prefix='mascot-notes-test-')
        self.addCleanup(self.temp.cleanup)
        self.repo=Path(self.temp.name)
        self.notes=self.repo/'.github/release-notes'
        self.notes.mkdir(parents=True)
        self.version=plugin_version(ROOT)
        self.path=self.notes/(self.version+'.md')
        self.expected=(ROOT/'.github/release-notes'/self.path.name).read_bytes()
        self.path.write_bytes(self.expected)
        workflow=(ROOT/'.github/workflows/release.yml').read_text()
        step=workflow.split('      - name: 读取当前版本中文发行说明\n',1)[1].split('      - name:',1)[0]
        scripts=re.findall(r"^          python3 - <<'PY'\n(.*?)^          PY$",step,re.M|re.S)
        self.assertEqual(len(scripts),1)
        self.reader=textwrap.dedent(scripts[0])
        publish=workflow.split('      - name: Create draft, upload verified files, then publish\n',1)[1]
        self.assertIn('RELEASE_NOTES_BASE64: ${{ needs.resolve.outputs.release_notes }}',publish)
        self.assertNotIn("fs.readFileSync('release/DISTRIBUTION-NOTICE.txt'",publish)
        self.assertIn('              body,',publish)
        prefix=publish.split('          script: |\n',1)[1].split('            const tag =',1)[0]
        self.decoder=textwrap.dedent(prefix)+'\nconsole.log(JSON.stringify(body));\n'

    def read(self,version=None):
        output=self.repo/'output'
        if output.exists():output.unlink()
        result=subprocess.run([sys.executable,'-I','-c',self.reader],cwd=self.repo,
                              env={'RELEASE_VERSION':version or self.version,'GITHUB_OUTPUT':str(output)},
                              capture_output=True,text=True)
        encoded_notes=output.read_text().strip().split('=',1)[1] if output.exists() else ''
        return result,encoded_notes

    def decode(self,encoded_notes):
        return subprocess.run([self.node,'-e',self.decoder],
                              env={'RELEASE_NOTES_BASE64':encoded_notes},capture_output=True,text=True)

    def test_versioned_chinese_notes_roundtrip_as_text(self):
        result,encoded_notes=self.read()
        self.assertEqual(result.returncode,0,result.stderr)
        decoded=self.decode(encoded_notes)
        self.assertEqual(decoded.returncode,0,decoded.stderr)
        self.assertEqual(json.loads(decoded.stdout).encode(),self.expected)
        # Text containing JavaScript syntax is still prose, never executable input.
        self.path.write_text('中文说明：` ${process.exit(99)} " \\n<script>throw 1</script>')
        result,encoded_notes=self.read()
        self.assertEqual(result.returncode,0,result.stderr)
        decoded=self.decode(encoded_notes)
        self.assertEqual(decoded.returncode,0,decoded.stderr)
        self.assertEqual(json.loads(decoded.stdout),self.path.read_text())

    def test_missing_oversized_invalid_or_symlink_notes_fail_before_publication(self):
        result,_=self.read('9.9.9')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('请先补写',result.stderr)
        for data in [b'',b' '*10,b'x'*16385,b'\xff']:
            with self.subTest(data_length=len(data)):
                self.path.write_bytes(data)
                result,_=self.read()
                self.assertNotEqual(result.returncode,0)
        self.path.unlink();self.path.symlink_to(ROOT/'README.md')
        result,_=self.read()
        self.assertNotEqual(result.returncode,0)
        for invalid in ['', 'invalid!', 'eA']:
            with self.subTest(encoded_notes=invalid):
                self.assertNotEqual(self.decode(invalid).returncode,0)


if __name__=='__main__':unittest.main()
