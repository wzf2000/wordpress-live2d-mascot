"""Synthetic runner source repair and browser CI structure regressions."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.ci_browser_sources import repair_sources

ENV = {'GITHUB_ACTIONS': 'true', 'RUNNER_OS': 'Linux',
       'RUNNER_ENVIRONMENT': 'github-hosted', 'ImageOS': 'ubuntu24'}
AZURE = 'http://azure.archive.ubuntu.com/ubuntu/'
ARCHIVE = 'http://archive.ubuntu.com/ubuntu/'


class BrowserSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mascot-ci-sources-')
        self.root = Path(self.temp.name)
        self.write('etc/os-release', 'ID=ubuntu\nVERSION_ID="24.04"\n')

    def tearDown(self):
        self.temp.cleanup()

    def write(self, name, content):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        return target

    def test_mirror_list_replaces_exact_official_host_only(self):
        before = '\n'.join([AZURE, 'https://azure.archive.ubuntu.com/ubuntu',
                            '# ' + AZURE, 'https://security.ubuntu.com/ubuntu/',
                            'https://packages.microsoft.com/ubuntu/24.04/prod/',
                            'https://azure.archive.ubuntu.com.evil/ubuntu/',
                            'https://azure.archive.ubuntu.com/another/']) + '\n'
        path = self.write('etc/apt/apt-mirrors.txt', before)
        report = repair_sources(self.root, ENV)
        self.assertEqual(report, [{'path': 'etc/apt/apt-mirrors.txt', 'replacements': 2}])
        self.assertEqual(path.read_text(), before.replace(AZURE + '\n', ARCHIVE + '\n', 1).replace(
            'https://azure.archive.ubuntu.com/ubuntu\n', 'https://archive.ubuntu.com/ubuntu\n', 1))

    def test_deb_list_preserves_options_comments_and_third_party(self):
        before = ('deb [arch=amd64 signed-by=/key] ' + AZURE + ' noble main # ' + AZURE + '\n'
                  'deb-src https://azure.archive.ubuntu.com/ubuntu noble-updates main\n'
                  'deb https://packages.microsoft.com/repos/code stable main\n'
                  '# deb ' + AZURE + ' noble main\n')
        path = self.write('etc/apt/sources.list', before)
        third = self.write('etc/apt/sources.list.d/third-party.list', 'deb ' + AZURE + ' vendor main\n')
        repair_sources(self.root, ENV)
        self.assertEqual(path.read_text(), before.replace('] ' + AZURE, '] ' + ARCHIVE).replace(
            'deb-src https://azure.archive.ubuntu.com/', 'deb-src https://archive.ubuntu.com/'))
        self.assertEqual(third.read_text(), 'deb ' + AZURE + ' vendor main\n')

    def test_deb822_uris_continuations_only(self):
        before = ('Types: deb deb-src\nURIs: ' + AZURE + '\n https://azure.archive.ubuntu.com/ubuntu\n'
                  'Suites: noble noble-updates\nComponents: main\n'
                  'Signed-By: /key # ' + AZURE + '\n\n'
                  'Types: deb\nURIs: https://security.ubuntu.com/ubuntu/\nSuites: noble-security\n')
        path = self.write('etc/apt/sources.list.d/ubuntu.sources', before)
        repair_sources(self.root, ENV)
        self.assertEqual(path.read_text(), before.replace('URIs: ' + AZURE, 'URIs: ' + ARCHIVE).replace(
            '\n https://azure.archive.ubuntu.com/', '\n https://archive.ubuntu.com/'))

    def test_idempotent_noop_keeps_file_untouched(self):
        path = self.write('etc/apt/apt-mirrors.txt', AZURE + '\n')
        repair_sources(self.root, ENV)
        first = path.stat().st_mtime_ns
        self.assertEqual(repair_sources(self.root, ENV), [])
        self.assertEqual(path.stat().st_mtime_ns, first)
        self.assertEqual(path.read_text(), ARCHIVE + '\n')

    def test_crlf_and_untouched_bytes_are_preserved(self):
        before = ('# comment\r\ndeb ' + AZURE + ' noble main\r\n').encode()
        path = self.write('etc/apt/sources.list', '')
        path.write_bytes(before)
        repair_sources(self.root, ENV)
        self.assertEqual(path.read_bytes(), before.replace(AZURE.encode(), ARCHIVE.encode()))

    def test_missing_supported_files_is_noop(self):
        self.assertEqual(repair_sources(self.root, ENV), [])

    def test_wrong_runner_environment_cannot_write(self):
        path = self.write('etc/apt/apt-mirrors.txt', AZURE)
        for key, bad in [('GITHUB_ACTIONS', 'false'), ('RUNNER_OS', 'Windows'),
                         ('RUNNER_ENVIRONMENT', 'self-hosted'), ('ImageOS', 'ubuntu22')]:
            with self.subTest(key=key):
                with self.assertRaises(ValueError):
                    repair_sources(self.root, dict(ENV, **{key: bad}))
                self.assertEqual(path.read_text(), AZURE)
        with self.assertRaises(ValueError):
            repair_sources(self.root, {})

    def test_wrong_release_cannot_write(self):
        path = self.write('etc/apt/apt-mirrors.txt', AZURE)
        for release in ['ID=ubuntu\nVERSION_ID="22.04"\n', 'ID=debian\nVERSION_ID="24.04"\n']:
            self.write('etc/os-release', release)
            with self.assertRaises(ValueError):
                repair_sources(self.root, ENV)
            self.assertEqual(path.read_text(), AZURE)

    def test_symlink_preflight_prevents_all_writes(self):
        first = self.write('etc/apt/apt-mirrors.txt', AZURE)
        outside = self.write('outside.list', AZURE)
        (self.root / 'etc/apt/sources.list').symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'Symlink'):
            repair_sources(self.root, ENV)
        self.assertEqual(first.read_text(), AZURE)
        self.assertEqual(outside.read_text(), AZURE)

    def test_cli_uses_synthetic_root_and_reports_only_paths(self):
        self.write('etc/apt/apt-mirrors.txt', AZURE + '\n')
        result = subprocess.run([sys.executable, str(ROOT / 'tools/ci_browser_sources.py'),
                                 '--root', str(self.root)], env=dict(os.environ, **ENV),
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('etc/apt/apt-mirrors.txt (1 replacements)', result.stdout)
        self.assertNotIn(AZURE, result.stdout)


@unittest.skipUnless((ROOT / '.github/workflows/ci.yml').is_file(),
                     'Workflow is available in checkout, not the source ZIP')
class BrowserWorkflowTests(unittest.TestCase):
    def test_pinned_versions_and_separate_bounded_stages(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        browser = workflow.split('\n  browser:\n')[1]
        self.assertEqual(workflow.count("node-version: '24.22.1'"), 2)
        self.assertIn('runs-on: ubuntu-24.04\n    timeout-minutes: 25', browser)
        for stage, minutes in [('system_dependencies', 8), ('chromium_download', 4), ('browser_tests', 10)]:
            self.assertIn('id: ' + stage + '\n        timeout-minutes: ' + str(minutes), browser)
            self.assertIn('steps.' + stage + '.outcome', browser)
            self.assertIn('steps.' + stage + '.outputs.elapsed_seconds', browser)
        self.assertIn('playwright install-deps chromium', browser)
        self.assertIn('playwright install chromium', browser)
        self.assertIn('sudo --preserve-env=GITHUB_ACTIONS,RUNNER_OS,RUNNER_ENVIRONMENT,ImageOS python3 tools/ci_browser_sources.py', browser)
        self.assertNotIn('--with-deps', browser)
        self.assertNotIn('|| true', browser)
        self.assertNotIn('continue-on-error', browser)
        self.assertIn('exit "$status"', browser)

    def test_timing_trap_preserves_command_failure(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        trap = next(line.strip() for line in workflow.splitlines() if line.strip().startswith('trap '))
        with tempfile.TemporaryDirectory(prefix='mascot-stage-time-') as directory:
            output = Path(directory) / 'output'
            for code in [0, 7]:
                run = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', trap + '\nexit ' + str(code)],
                                     env=dict(os.environ, GITHUB_OUTPUT=str(output)), capture_output=True)
                self.assertEqual(run.returncode, code)
            self.assertRegex(output.read_text(), r'^elapsed_seconds=\d+\nelapsed_seconds=\d+\n$')

    def test_artifacts_include_only_known_summary_and_png_paths(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        browser = workflow.split('\n  browser:\n')[1]
        paths = browser.split('          path: |\n')[1].split('          if-no-files-found:')[0]
        expected = {'build/browser/results.json', 'build/browser/*.png'}
        for suite in ['dialogue', 'movement', 'account', 'selection', 'capture', 'admin-preview', 'admin-recovery']:
            expected.update({'build/browser/' + suite + '/results.json', 'build/browser/' + suite + '/*.png'})
        self.assertEqual(set(paths.split()), expected)
        self.assertIn('node "tests/$suite-browser.cjs"', browser)
        self.assertIn('python3 -m json.tool', browser)
        self.assertIn('if: always()', browser)


if __name__ == '__main__':
    unittest.main()
