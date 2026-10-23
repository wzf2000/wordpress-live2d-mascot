#!/usr/bin/env python3
"""New isolated real WordPress + HTTP admin forms; synthetic data, no render acceptance."""
import argparse
from contextlib import contextmanager
import struct
import zlib
import hashlib
from html.parser import HTMLParser
import http.cookiejar
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PINS = {
    'wordpress': ('7.1.3', 'https://wordpress.org/wordpress-7.1.3.zip', 'eb58a90ed55147f90f7bd55d0d3334960a69b7e8a4cc142c8ddfea8965218227'),
    'wp-cli': ('2.12.0', 'https://github.com/wp-cli/wp-cli/releases/download/v2.12.0/wp-cli-2.12.0.phar', 'ce34ddd838f7351d6759068d09793f26755463b4a4610a5a5c0a97b68220d85c'),
}
PHP_RUNTIME = """echo json_encode([
    'sapi' => PHP_SAPI, 'zts' => PHP_ZTS,
    'ini' => array_map('ini_get', array_combine(
        ['opcache.enable', 'opcache.enable_cli', 'opcache.jit', 'opcache.jit_buffer_size'],
        ['opcache.enable', 'opcache.enable_cli', 'opcache.jit', 'opcache.jit_buffer_size'])),
    'jit' => function_exists('opcache_get_status') ? (opcache_get_status(false)['jit'] ?? null) : null
]);"""
def png_chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


PNG = b'\x89PNG\r\n\x1a\n' + png_chunk(b'IHDR', struct.pack('>IIBBBBB', 2, 2, 8, 2, 0, 0, 0)) + png_chunk(b'IDAT', zlib.compress((b'\x00' + b'\x10\x80\xc0' * 2) * 2)) + png_chunk(b'IEND', b'')


class Forms(HTMLParser):
    def __init__(self, html):
        super().__init__(); self.forms = []; self.current = None; self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'form': self.current = {}; self.forms.append(self.current)
        if self.current is not None and tag in ('input', 'button') and attrs.get('name'):
            if attrs.get('type') not in ('checkbox', 'file', 'submit'):
                self.current[attrs['name']] = attrs.get('value', '')

    def handle_endtag(self, tag):
        if tag == 'form': self.current = None


def model_zip(path):
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('Model.model3.json', json.dumps({'Version': 3, 'FileReferences': {'Moc': 'Model.moc3', 'Textures': ['texture.png'], 'Motions': {'Idle': [{'File': 'motion/idle.motion3.json'}]}, 'Expressions': []}}))
        z.writestr('Model.moc3', b'MOC3synthetic-only')
        z.writestr('texture.png', PNG)
        z.writestr('motion/idle.motion3.json', '{"Version":3}')


def server_diagnostics(path, site):
    """Keep error categories and source locations, never messages or request data."""
    counts = {}
    locations = []
    for line in path.read_text(errors='replace').splitlines():
        level = re.search(r'PHP (Fatal error|Parse error|Warning|Deprecated|Notice):', line)
        if not level:
            continue
        severity = level.group(1)
        counts[severity] = counts.get(severity, 0) + 1
        match = re.search(r' in (/[^\r\n]+?)(?::| on line )(\d+)(?:\D|$)', line)
        if match:
            try:
                relative = Path(match.group(1)).relative_to(site).as_posix()
            except ValueError:
                continue
            if not re.fullmatch(r'[A-Za-z0-9_./-]+\.php', relative) or '..' in Path(relative).parts:
                continue
            item = {'severity': severity, 'file': relative, 'line': int(match.group(2))}
            if item not in locations and len(locations) < 8:
                locations.append(item)
    return {'counts': counts, 'locations': locations}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lab', type=Path, required=True, help='New direct /tmp/mascot-ci-* directory')
    parser.add_argument('--port', type=int, default=18129)
    parser.add_argument('--downloads', type=Path, help='Optional cache of public pinned dependencies')
    args = parser.parse_args()
    lab = args.lab.absolute()
    database = os.environ.get('MASCOT_CI_DB_NAME', '')
    host = os.environ.get('MASCOT_CI_DB_HOST', '')
    if lab.parent != Path('/tmp') or not re.fullmatch(r'mascot-ci-[a-z0-9-]+', lab.name) or lab.exists() or lab.is_symlink():
        parser.error('Refusing existing/non-temporary lab')
    if not re.fullmatch(r'mascot_ci_[a-z0-9_]+', database) or not re.fullmatch(r'127\.0\.0\.1:[0-9]{1,5}', host):
        parser.error('Explicit new mascot_ci_* database on loopback required')
    if not 1024 <= args.port <= 65535: parser.error('Unprivileged HTTP port required')
    with socket.socket() as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(('127.0.0.1', args.port))
    os.umask(0o077)
    lab.mkdir(); (lab / 'mascot-ci-owner').write_text('synthetic-wordpress-mascot-v1\n')
    downloads = args.downloads or lab / 'downloads'; downloads.mkdir(parents=True, exist_ok=True)
    no_proxy = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    paths = {}
    for name, (_, url, digest) in PINS.items():
        target = downloads / Path(url).name
        if not target.exists():
            with no_proxy.open(url, timeout=60) as response: data = response.read(64 * 1024 * 1024 + 1)
            if len(data) > 64 * 1024 * 1024: raise RuntimeError('Public download too large')
            target.write_bytes(data)
        if target.is_symlink() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise RuntimeError('Pinned download SHA256 mismatch: ' + name)
        paths[name] = target.resolve()
    site = lab / 'site'; site.mkdir()
    with zipfile.ZipFile(paths['wordpress']) as archive:
        for item in archive.infolist():
            relative = Path(item.filename)
            if relative.parts[0] != 'wordpress' or '..' in relative.parts or (item.external_attr >> 16) & 0o170000 == 0o120000:
                raise RuntimeError('Unsafe public WordPress ZIP')
            target = site.joinpath(*relative.parts[1:])
            if item.is_dir(): target.mkdir(parents=True, exist_ok=True)
            else: target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(archive.read(item))
    env = dict(os.environ)
    command = ['php', str(paths['wp-cli']), '--skip-packages', '--no-color', '--path=' + str(site)]
    if os.geteuid() == 0: command += ['--allow-root']

    def wp(*arguments, mode=None):
        current = dict(env)
        if mode: current['MASCOT_CI_MODE'] = mode
        result = subprocess.run(command + list(arguments), env=current, text=True, capture_output=True)
        if result.returncode: raise RuntimeError('WP-CLI failed: ' + ' '.join(arguments[:2]))
        return result.stdout.strip()

    # Dedicated service only: reject any unrelated application database and
    # never reuse, truncate or reset an existing database even with a test-like name.
    guard = """$h=explode(':',getenv('MASCOT_CI_DB_HOST'));mysqli_report(MYSQLI_REPORT_ERROR|MYSQLI_REPORT_STRICT);$m=new mysqli($h[0],getenv('MASCOT_CI_DB_USER'),getenv('MASCOT_CI_DB_PASSWORD'),'',(int)$h[1]);$n=getenv('MASCOT_CI_DB_NAME');$r=$m->query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA');while($row=$r->fetch_row()){$db=$row[0];if($db===$n || (!in_array($db,['information_schema','performance_schema','mysql','sys'],true) && !preg_match('/^mascot_ci_[a-z0-9_]+$/D',$db)))exit(2);}exit(0);"""
    checked = subprocess.run(['php', '-r', guard], env=env, capture_output=True)
    if checked.returncode: raise RuntimeError('Database service unavailable, contains unrelated data or requested database exists; refusing reuse')
    if wp('--version') != 'WP-CLI ' + PINS['wp-cli'][0]: raise RuntimeError('WP-CLI version mismatch')
    wp('config', 'create', '--dbname=' + database, '--dbhost=' + host, '--dbuser=' + env.get('MASCOT_CI_DB_USER', 'root'), '--dbpass=' + env.get('MASCOT_CI_DB_PASSWORD', ''), '--skip-check', '--skip-salts')
    wp('config', 'set', 'WP_ENVIRONMENT_TYPE', 'local')
    wp('config', 'set', 'DISABLE_WP_CRON', 'true', '--raw')
    wp('config', 'set', 'AUTOMATIC_UPDATER_DISABLED', 'true', '--raw')
    wp('config', 'set', 'WP_HTTP_BLOCK_EXTERNAL', 'true', '--raw')
    mu = site / 'wp-content/mu-plugins'; mu.mkdir(exist_ok=True)
    # A valid empty core catalog enables WordPress's WPLANG allow-list without
    # downloading a core language pack. Plugin strings use its actual bundled MO.
    import sys
    sys.path.insert(0, str(ROOT))
    from tools.translations import mo_bytes
    languages = site / 'wp-content/languages'; languages.mkdir(exist_ok=True)
    (languages / 'zh_CN.mo').write_bytes(mo_bytes({'': (None, ['Content-Type: text/plain; charset=UTF-8\nLanguage: zh_CN\nPlural-Forms: nplurals=1; plural=0;\n'])}))
    (mu / 'synthetic-no-mail.php').write_text("<?php add_filter('pre_wp_mail', '__return_true');\n")
    interaction_counts = lab / 'interaction-counts.txt'
    (mu / 'synthetic-interaction-counts.php').write_text("<?php if (($_POST['action'] ?? '') === 'wzf_mascot_template_batch_apply') {" +
        "add_action('added_option',function($name){if($name==='wzf_mascot_import_lock_v1')file_put_contents(" + json.dumps(str(interaction_counts)) + ",\"guard\\n\",FILE_APPEND);});" +
        "add_action('updated_option',function($name){if($name==='wzf_mascot_resources_v1')file_put_contents(" + json.dumps(str(interaction_counts)) + ",\"save\\n\",FILE_APPEND);});}")
    wp('db', 'create')
    origin = 'http://127.0.0.1:' + str(args.port)
    password = secrets.token_urlsafe(24)
    wp('core', 'install', '--url=' + origin, '--title=Synthetic mascot CI', '--admin_user=mascot-admin', '--admin_password=' + password, '--admin_email=admin@example.invalid', '--skip-email')
    if wp('core', 'version') != PINS['wordpress'][0]: raise RuntimeError('WordPress version mismatch')
    wp('user', 'create', 'mascot-reader', 'reader@example.invalid', '--role=subscriber', '--user_pass=' + password)
    plugin = site / 'wp-content/plugins/live2d-show'; plugin.mkdir()
    (plugin / 'live2d-show.php').write_text('<?php /*\nPlugin Name: Synthetic prior mascot\nVersion: 3.6.0\n*/\n')
    wp('plugin', 'activate', 'live2d-show')
    wp('option', 'update', 'wzf_mascot_resources_v1', '{"characters":[],"upgradeMarker":"synthetic-retained"}', '--format=json')
    # Exercise WP's actual upgrader, including overwrite, with the current install package.
    import sys
    sys.path.insert(0, str(ROOT))
    from tools.package_release import package
    package(ROOT, lab / 'package', source_sha='0' * 40)
    bundle = next(p for p in (lab / 'package').glob('*.zip') if not p.name.endswith('-source.zip'))
    wp('plugin', 'install', str(bundle), '--force', '--activate')
    state = json.loads(wp('option', 'get', 'wzf_mascot_resources_v1', '--format=json'))
    assert state == {'characters': [], 'upgradeMarker': 'synthetic-retained'}
    router = lab / 'router.php'
    router.write_text("<?php $p=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH); if ($p === '/__mascot-ci-runtime') { header('Content-Type: application/json'); " + PHP_RUNTIME + " return; } if (is_file($_SERVER['DOCUMENT_ROOT'].$p)) return false; if (is_dir($_SERVER['DOCUMENT_ROOT'].$p) && is_file(rtrim($_SERVER['DOCUMENT_ROOT'].$p,'/').'/index.php')) { require rtrim($_SERVER['DOCUMENT_ROOT'].$p,'/').'/index.php'; return; } require $_SERVER['DOCUMENT_ROOT'].'/index.php';\n")
    logfile = (lab / 'http.log').open('w')
    server = subprocess.Popen(['php', '-S', '127.0.0.1:' + str(args.port), '-t', str(site), str(router)], env=env, stdout=logfile, stderr=logfile)
    checks = []
    completed = False
    failure = None
    last_request = None
    http_runtime = None

    def client(): return urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    anonymous, admin, reader = client(), client(), client()

    def request(opener, path, data=None, files=None, with_headers=False):
        nonlocal last_request
        last_request = {'method': 'GET' if data is None and files is None else 'POST',
                        'path': urllib.parse.urlsplit(path).path}
        url = origin + path
        headers = {}
        if files:
            boundary = 'mascot-' + secrets.token_hex(12); parts = []
            for k, values in data.items():
                for v in values if isinstance(values, list) else [values]:
                    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
            for k, (filename, raw) in files.items():
                parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; filename="{filename}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + raw + b'\r\n')
            payload = b''.join(parts) + f'--{boundary}--\r\n'.encode(); headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary
        else: payload = urllib.parse.urlencode(data, doseq=True).encode() if data is not None else None
        try:
            with opener.open(urllib.request.Request(url, payload, headers), timeout=15) as response:
                result = (response.status, response.read().decode())
                return (*result, dict(response.headers.items())) if with_headers else result
        except urllib.error.HTTPError as error:
            result = (error.code, error.read().decode())
            return (*result, dict(error.headers.items())) if with_headers else result

    def state(): return json.loads(wp('eval-file', str(ROOT / 'tests/wordpress-fixture.php'), mode='state'))
    def fixture(mode): return wp('eval-file', str(ROOT / 'tests/wordpress-fixture.php'), mode=mode)
    def front(opener=None):
        status, html = request(opener or anonymous, '/'); assert status == 200
        m = re.search(r'<script id="wzf-live2d-config"[^>]*>(.*?)</script>', html, re.S)
        return json.loads(m[1]) if m else None
    def form(action, operation=None, character='legacy_character'):
        status, html = request(admin, '/wp-admin/options-general.php?page=wzf-mascot&character=' + character); assert status == 200
        return next(f for f in Forms(html).forms if f.get('action') == action and (operation is None or f.get('operation') == operation))
    def post(data, files=None, opener=None): return request(opener or admin, '/wp-admin/admin-post.php', data, files)
    def record(name): checks.append(name); print('PASS ' + name, flush=True)

    # A separate CLI process holds real WordPress locks while HTTP requests run.
    # No route, test hook or synthetic credential is shipped in the plugin.
    holder = lab / 'lock-holder.php'
    holder.write_text('''<?php
if (!defined('ABSPATH') || wp_get_environment_type() !== 'local' || !str_starts_with(ABSPATH,'/tmp/mascot-ci-') || !is_file(dirname(rtrim(ABSPATH,'/')).'/mascot-ci-owner')) throw new RuntimeException('Synthetic lab required.');
$base=dirname(rtrim(ABSPATH,'/'));$ready=getenv('MASCOT_CI_HOLD_READY');$release=getenv('MASCOT_CI_HOLD_RELEASE');
if(dirname($ready)!==$base || dirname($release)!==$base) throw new RuntimeException('Owned signal paths required.');
$wait=static function()use($ready,$release){file_put_contents($ready,'ready');$deadline=microtime(true)+60;while(!is_file($release)){if(microtime(true)>$deadline)throw new RuntimeException('Synthetic hold deadline');usleep(10000);}};
wp_set_current_user(get_user_by('login','mascot-admin')->ID);
$mode=getenv('MASCOT_CI_HOLD_KIND');
if($mode==='account') {
    add_filter('update_user_metadata',static function($check,$uid,$key)use($wait){if($uid===get_current_user_id() && $key===wzf_mascot_preference_key())$wait();return $check;},10,3);
    $state=wzf_mascot_preference_snapshot(get_current_user_id());
    $result=wzf_mascot_save_preferences(get_current_user_id(),$state['revision'],['character'=>'fixture','favorites'=>[],'layouts'=>[]]);
    if(!$result['ok'])throw new RuntimeException('Synthetic account save failed');
} elseif($mode==='resource') {
    $task=wzf_mascot_task_begin('settings');try{$wait();}finally{wzf_mascot_task_end($task);}
} elseif($mode==='legacy') {
    $bridge=wzf_mascot_task_guard(true);if(!flock($bridge,LOCK_EX|LOCK_NB))throw new RuntimeException('Synthetic legacy guard unavailable');
    try{$wait();}finally{flock($bridge,LOCK_UN);fclose($bridge);}
} else throw new RuntimeException('Unknown hold kind');
echo 'released';
''')

    @contextmanager
    def held(kind):
        token = secrets.token_hex(6)
        ready, release = lab / ('hold-' + token + '.ready'), lab / ('hold-' + token + '.release')
        current = dict(env, MASCOT_CI_HOLD_KIND=kind, MASCOT_CI_HOLD_READY=str(ready), MASCOT_CI_HOLD_RELEASE=str(release))
        process = subprocess.Popen(command + ['eval-file', str(holder)], env=current, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 15
            while not ready.exists():
                if process.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError('Synthetic lock holder did not become ready')
                time.sleep(.02)
            yield
        finally:
            release.write_text('release')
            try:
                stdout, stderr = process.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                process.terminate()
                stdout, stderr = process.communicate(timeout=5)
            ready.unlink(missing_ok=True); release.unlink(missing_ok=True)
            if process.returncode != 0 or stdout.strip() != 'released':
                raise RuntimeError('Synthetic lock holder did not finish cleanly')

    try:
        for _ in range(50):
            try: request(anonymous, '/wp-login.php'); break
            except (urllib.error.URLError, ConnectionError): time.sleep(.1)
        status, runtime_body = request(anonymous, '/__mascot-ci-runtime')
        assert status == 200
        http_runtime = json.loads(runtime_body)
        assert front() is None; record('real install/upgrade preserves existing option; empty resources emit nothing')
        for opener, user in [(admin, 'mascot-admin'), (reader, 'mascot-reader')]:
            request(opener, '/wp-login.php')
            status, html = request(opener, '/wp-login.php', {'log': user, 'pwd': password, 'wp-submit': 'Log In', 'redirect_to': origin + '/wp-admin/', 'testcookie': '1'})
            assert status == 200 and 'login_error' not in html
        before = state()
        for action in ['settings', 'manage', 'thumbnail', 'mobile', 'import', 'task_recover', 'interaction', 'presets', 'hits', 'capture', 'template_export', 'template_apply', 'interaction_preview', 'template_batch_apply']:
            payload = {'action': 'wzf_mascot_' + action, '_wpnonce': 'invalid'}
            assert post(payload, opener=reader)[0] == 403
            assert post(payload)[0] == 403
            assert post(payload, opener=anonymous)[0] in (400, 403)
        inventory_url = '/wp-admin/options-general.php?page=wzf-mascot'
        payload = {'mascot_inventory': '1', '_wpnonce': 'invalid'}
        assert request(reader, inventory_url, payload)[0] == 403
        assert request(admin, inventory_url, payload)[0] == 403
        status, anonymous_html = request(anonymous, inventory_url, payload)
        assert status in (200, 403) and 'Inventory complete.' not in anonymous_html
        payload = {'mascot_inventory_export': '1', '_wpnonce': 'invalid'}
        assert request(reader, inventory_url, payload)[0] == 403
        assert request(admin, inventory_url, payload)[0] == 403
        status, anonymous_html = request(anonymous, inventory_url, payload)
        assert status in (200, 403) and 'characterSummary' not in anonymous_html
        assert state() == before; record('real HTTP authorization and nonce failures preserve options, including disk inventory/export')
        z = lab / 'synthetic-model.zip'; model_zip(z)
        data = form('wzf_mascot_import', character=''); data.update(kind='model', id='fixture', name='Synthetic fixture', credit='Synthetic owner', rights='1')
        post(data, {'resource': (z.name, z.read_bytes())})
        assert 'fixture' in state()['config']['characters']; record('real multipart import with administrator nonce')
        fixture('seed'); original = state()['config']; snapshot = lab / 'snapshot.json'; snapshot.write_text(json.dumps(original)); env['MASCOT_CI_SNAPSHOT'] = str(snapshot)
        assert set(front()['characters']) == {'fixture', 'legacy_character', '23'}
        assert front()['diagnosticsAllowed'] is False
        assert front(reader)['diagnosticsAllowed'] is False
        assert front(admin)['diagnosticsAllowed'] is True
        record('real HTTP guest/subscriber/admin diagnostics flag follows manage_options')
        assert front()['mobileEnabled'] is False; record('legacy IDs, maintained extra action, mobile default and server output')
        def listed(html):
            match = re.search(r'<table class="widefat striped">.*?<tbody>(.*?)</tbody>', html, re.S)
            return set(re.findall(r'<code>(.*?)</code>', match[1]) + re.findall(r'<th scope="row">([^<]*)</th>', match[1])) if match else set()
        before = state()
        status, html = request(admin, inventory_url + '&mascot_search=LEGACY'); assert status == 200
        assert listed(html) == {'legacy_character'}
        assert not listed(request(admin, inventory_url + '&mascot_search=does-not-exist')[1])
        assert listed(request(admin, inventory_url + '&mascot_search[]=invalid&mascot_status[]=invalid')[1]) == {'fixture', 'legacy_character', '23'}
        assert state() == before; record('real HTTP administrator name/ID search, empty state and invalid query preserve data')
        status, html = request(admin, inventory_url); assert status == 200 and 'Observed paths (admin only)' not in html
        inventory = next(f for f in Forms(html).forms if f.get('mascot_inventory') == '1')
        resource_before = {p.relative_to(site).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in (site / 'wp-content/uploads/wzf-mascot').rglob('*') if p.is_file()}
        status, html = request(admin, inventory_url, inventory)
        assert status == 200 and 'Inventory complete.' in html and 'Current model directory' in html and 'Shared Core' in html
        assert 'extra.motion3.json' in html and 'not safe to delete' in html and str(site) not in html
        assert state() == before
        assert resource_before == {p.relative_to(site).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in (site / 'wp-content/uploads/wzf-mascot').rglob('*') if p.is_file()}
        assert 'Disk inventory' not in front()['i18n']
        record('explicit real HTTP inventory is read-only, bounded-root metadata and admin-only')
        assert 'Character capacity summary' in html and 'Unique character total' in html
        assert html.index('Character capacity summary') < html.index('Observed paths (admin only)')
        export_form = next(f for f in Forms(html).forms if f.get('mascot_inventory_export') == '1')
        status, exported, headers = request(admin, inventory_url, export_form, with_headers=True)
        assert status == 200 and headers['Content-Type'].startswith('application/json')
        assert 'attachment;' in headers['Content-Disposition'] and 'mascot-resource-inventory.json' in headers['Content-Disposition']
        report = json.loads(exported); summary = report['characterSummary']
        assert report['schema'] == 2 and report['complete'] and report['referencesComplete'] and summary['complete']
        assert summary['total']['bytes'] == summary['characters'][0]['total']['bytes']
        assert sum(row['total']['bytes'] for row in summary['characters']) > summary['total']['bytes']
        assert summary['shared']['bytes'] == summary['total']['bytes']
        assert report['bytes'] == report['observedBytes'] and report['limits']['entries'] == 20000
        assert str(site) not in exported and 'Synthetic owner' not in exported and 'MOC3synthetic' not in exported
        assert 'characterSummary' not in front() and state() == before
        assert resource_before == {p.relative_to(site).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in (site / 'wp-content/uploads/wzf-mascot').rglob('*') if p.is_file()}
        record('real administrator character capacity unions and fresh metadata-only JSON attachment preserve options/files')
        assert 'cleanupReview' not in report
        fixture('inventory-review'); before = state()
        review_files = {p.relative_to(site).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in (site / 'wp-content/uploads/wzf-mascot').rglob('*') if p.is_file()}
        code, page = request(admin, inventory_url + '&cleanup_review=1&retention_days=30')
        assert code == 200 and 'review-old' not in page
        scan_form = next(f for f in Forms(page).forms if f.get('mascot_inventory') == '1')
        review_form = next(f for f in Forms(page).forms if f.get('mascot_inventory_export') == '1')
        scan_form.update(cleanup_review='1', retention_days='30')
        review_form.update(cleanup_review='1', retention_days='30')
        code, review_page = request(admin, inventory_url, scan_form)
        assert code == 200 and 'review-old' in review_page and 'review-recent' in review_page
        code, review_json, review_headers = request(admin, inventory_url, review_form, with_headers=True)
        assert code == 200 and review_headers['Content-Type'].startswith('application/json')
        cleanup = json.loads(review_json)['cleanupReview']
        assert cleanup['schema'] == 1 and cleanup['readOnly'] is True and cleanup['retentionDays'] == 30
        assert cleanup['complete'] and not cleanup['rowsTruncated'] and cleanup['scanTime']
        rows = {row['path']: row for row in cleanup['rows']}
        assert rows['review-old']['status'] == 'due' and rows['review-old']['files'] == 1 and rows['review-old']['bytes'] > 0
        assert rows['review-recent']['status'] == 'waiting' and rows['review-recent']['latestMtime'] > rows['review-old']['latestMtime']
        assert rows['core-retained-old']['status'] == 'protected'
        assert rows['review-parent']['status'] in ('protected', 'unknown')
        assert all(row['reasons'] for row in cleanup['rows']) and 'safeToDelete' not in review_json
        for invalid in ['0', '3651', '3.5', 'abc']:
            code, rejected, headers = request(admin, inventory_url, dict(review_form, retention_days=invalid), with_headers=True)
            assert code == 400 and not headers['Content-Type'].startswith('application/json')
        invalid = dict(review_form); invalid.pop('retention_days'); invalid['retention_days[]'] = '30'
        assert request(admin, inventory_url, invalid)[0] == 400
        assert request(reader, inventory_url, review_form)[0] == 403
        assert request(admin, inventory_url, dict(review_form, _wpnonce='invalid'))[0] == 403
        assert state() == before and 'cleanupReview' not in front()
        assert review_files == {p.relative_to(site).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in (site / 'wp-content/uploads/wzf-mascot').rglob('*') if p.is_file()}
        record('real explicit cleanup review is read-only: subtree age, protected Core, strict retention, permissions and nonce')
        # Recovery uses the same real WordPress option APIs and fresh reads.
        before = state(); fixture('task-abandon'); abandoned = state()
        status, html = request(admin, inventory_url)
        assert status == 200 and 'Interrupted · Review required' in html
        recovery = next(f for f in Forms(html).forms if f.get('action') == 'wzf_mascot_task_recover')
        assert abandoned['lock']['token'] not in html and str(site) not in html
        post(recovery); assert state() == abandoned  # Explicit confirmation is required.
        recovery['confirm'] = '1'
        post(dict(recovery, _wpnonce='invalid')); assert state() == abandoned
        post(recovery, opener=reader); assert state() == abandoned
        fixture('task-change'); replaced = state(); post(recovery); assert state() == replaced
        recovery = form('wzf_mascot_task_recover', character=''); recovery['confirm'] = '1'
        protected = {p.relative_to(site).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in (site / 'wp-content/uploads/wzf-mascot').rglob('*') if p.is_file()}
        post(recovery); assert state() == before
        assert protected == {p.relative_to(site).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in (site / 'wp-content/uploads/wzf-mascot').rglob('*') if p.is_file()}
        # A valid abandoned v1 record uses the original bridge identity. The
        # new runtime must recover it without pretending it is a v2 record.
        wp('eval', "$h=wzf_mascot_task_guard(true);if(!flock($h,LOCK_EX|LOCK_NB))throw new RuntimeException('Synthetic v1 guard unavailable');try{add_option(WZF_MASCOT_LOCK,['token'=>bin2hex(random_bytes(16)),'started'=>time(),'guard'=>1,'kind'=>'settings','identity'=>wzf_mascot_task_identity($h)],'',false);}finally{flock($h,LOCK_UN);fclose($h);}")
        assert state()['lock']['guard'] == 1
        html = request(admin, inventory_url)[1]
        assert 'Interrupted · Review required' in html
        recovery_v1 = next(f for f in Forms(html).forms if f.get('action') == 'wzf_mascot_task_recover')
        post(dict(recovery_v1, confirm='1')); assert state() == before
        assert protected == {p.relative_to(site).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in (site / 'wp-content/uploads/wzf-mascot').rglob('*') if p.is_file()}
        fixture('task-legacy'); legacy = state(); html = request(admin, inventory_url)[1]
        assert 'Legacy or unknown task state' in html and not any(f.get('action') == 'wzf_mascot_task_recover' for f in Forms(html).forms)
        post(recovery); assert state() == legacy; fixture('task-clear')
        assert json.loads(fixture('task-cache-check')) == {'rejected': True, 'retained': True, 'lock': False}
        fixture('restore'); assert state()['config'] == original
        record('real HTTP v1/v2 guarded recovery, confirmation/nonce/permission/replacement/unknown rejection and stale option cache conflict')
        # A full synthetic baseline goes through the actual WordPress upgrader.
        # Browser localStorage remains a browser-layer contract, not server metadata.
        uid = wp('user', 'get', 'mascot-admin', '--field=ID')
        wp('user', 'meta', 'update', uid, 'show_live2d_front', 'false')
        upgrade_state = state()
        uploads = site / 'wp-content/uploads/wzf-mascot'
        resource_hashes = {p.relative_to(uploads).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in uploads.rglob('*') if p.is_file()}
        wp('plugin', 'install', str(bundle), '--force', '--activate')
        assert state() == upgrade_state
        assert wp('user', 'meta', 'get', uid, 'show_live2d_front') == 'false'
        assert resource_hashes == {p.relative_to(uploads).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in uploads.rglob('*') if p.is_file()}
        assert set(front()['characters']) == {'fixture', 'legacy_character', '23'}
        record('real overwrite upgrade preserves full synthetic resources/options and user profile preference')
        data = form('wzf_mascot_interaction')
        # Forms extracts inputs only, so explicitly submit every textarea rule.
        for event in ['welcome','click','morning','afternoon','evening','return','idle']:
            data['dialogue[' + event + '][lines]'] = 'Hello local reader\nAnother local line' if event == 'welcome' else 'A quiet local pause\nAnother idle line' if event == 'idle' else ''
            data['dialogue[' + event + '][cooldown]'] = '120' if event == 'idle' else '15'
        data['dialogue[welcome][enabled]'] = '1'
        data['dialogue[idle][enabled]'] = '1'
        stale_dialogue = dict(data)
        post(data); dialogue_state = state()['config']
        assert dialogue_state['characters']['legacy_character']['dialogue']['welcome']['lines'] == ['Hello local reader','Another local line']
        idle_rule = {'enabled':True, 'cooldown':120, 'lines':['A quiet local pause','Another idle line']}
        assert dialogue_state['characters']['legacy_character']['dialogue']['idle'] == idle_rule
        assert front()['characters']['legacy_character']['dialogue']['idle'] == idle_rule
        assert front()['characters']['legacy_character']['dialogue']['welcome']['enabled']
        post(stale_dialogue); assert state()['config'] == dialogue_state
        bad = form('wzf_mascot_interaction'); bad.update(data); bad['version'] = state()['version']; bad['dialogue[welcome][lines]'] = '<script>bad</script>'
        post(bad); assert state()['config'] == dialogue_state
        bad = dict(data); bad['version'] = state()['version']; bad['dialogue[idle][cooldown]'] = '89'
        post(bad); assert state()['config'] == dialogue_state
        wp('plugin', 'install', str(bundle), '--force', '--activate'); assert state()['config'] == dialogue_state
        assert front()['characters']['legacy_character']['dialogue']['idle'] == idle_rule
        record('real dialogue/idle save, stale version, invalid text/cooldown and upgrade preservation')
        # Synthetic installed legacy catalogs retain exact bytes and internal ASCII spaces.
        resource_root = site / 'wp-content/uploads/wzf-mascot'
        legacy_config = state()['config']
        legacy_root = resource_root / legacy_config['characters']['legacy_character']['root']
        catalog_path = legacy_root / 'catalog.json'
        original_catalog = catalog_path.read_bytes()
        catalog = json.loads(original_catalog)
        spaced_file = legacy_root / 'motion/14_ sigh.motion3.json'
        spaced_file.write_bytes((legacy_root / 'motion/extra.motion3.json').read_bytes())
        for item in catalog['motions']:
            if item['id'] == '01_extra': item['file'] = 'motion/14_ sigh.motion3.json'
        catalog_path.write_text(json.dumps(catalog))
        before_files = {p.relative_to(resource_root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in resource_root.rglob('*') if p.is_file()}
        pool_form = form('wzf_mascot_interaction'); pool_form.update(data)
        pool_form['version'] = state()['version']; pool_form['dialogue[idle][motions][]'] = '01_extra'
        post(pool_form)
        pool_saved = state()['config']
        assert pool_saved['characters']['legacy_character']['dialogue']['idle']['motions'] == ['01_extra']
        assert front()['characters']['legacy_character']['dialogue']['idle']['motions'] == ['01_extra']
        for invalid in ['missing', '../wave']:
            bad_pool = dict(pool_form, version=state()['version']); bad_pool['dialogue[idle][motions][]'] = invalid
            post(bad_pool); assert state()['config'] == pool_saved
        post(pool_form); assert state()['config'] == pool_saved  # stale
        bad_pool = dict(pool_form, version=state()['version']); bad_pool['_wpnonce'] = 'invalid'
        post(bad_pool); assert state()['config'] == pool_saved
        post(dict(pool_form, version=state()['version']), opener=reader); assert state()['config'] == pool_saved
        presets_form = form('wzf_mascot_presets')
        presets_form.update({'presets[0][id]':'legacy-sigh','presets[0][name]':'Legacy sigh','presets[0][motion]':'01_extra','presets[0][expression]':'','presets[0][line]':'Legacy local line'})
        for index in range(1,8):
            for key in ['name','motion','expression','line']: presets_form['presets['+str(index)+']['+key+']']=''
        post(presets_form)
        assert state()['config']['characters']['legacy_character']['presets'][0]['motion'] == '01_extra'
        assert before_files == {p.relative_to(resource_root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in resource_root.rglob('*') if p.is_file()}
        # Restore this test-only optional field before existing exact baseline comparisons.
        clear_pool = dict(pool_form, version=state()['version']); clear_pool.pop('dialogue[idle][motions][]'); clear_pool['chatter_motions_present']='1'
        post(clear_pool)
        wp('eval', "$c=get_option(WZF_MASCOT_OPTION);unset($c['characters']['legacy_character']['dialogue']['idle']['motions']);update_option(WZF_MASCOT_OPTION,$c);")
        catalog_path.write_bytes(original_catalog); spaced_file.unlink()
        record('real installed spaced motion catalog and chatter pool save, stale/nonce/permission/invalid rejection without resource mutation')
        data = form('wzf_mascot_presets'); stale_presets = dict(data)
        data.update({'presets[0][id]':'hello','presets[0][name]':'Hello local','presets[0][motion]':'01_extra','presets[0][expression]':'','presets[0][line]':'Local greeting'})
        for index in range(1,8):
            for key in ['name','motion','expression','line']: data['presets['+str(index)+']['+key+']']=''
        post(data); preset_state = state()['config']; assert len(preset_state['characters']['legacy_character']['presets']) == 1
        assert front()['characters']['legacy_character']['presets'][0]['motion'] == '01_extra'
        post(stale_presets); assert state()['config'] == preset_state
        bad = dict(data); bad['version'] = state()['version']; bad['presets[0][motion]']='missing'
        post(bad); assert state()['config'] == preset_state
        wp('plugin', 'install', str(bundle), '--force', '--activate'); assert state()['config'] == preset_state
        record('real preset save, invalid catalog, stale version and upgrade preservation')
        template_base = state()
        template_files = {p.relative_to(site).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in (site / 'wp-content/uploads/wzf-mascot').rglob('*') if p.is_file()}
        export_form = form('wzf_mascot_template_export')
        code, body, headers = request(admin, '/wp-admin/admin-post.php', export_form, with_headers=True)
        template = json.loads(body)
        assert code == 200 and 'attachment' in headers.get('Content-Disposition', '')
        assert set(template) == {'type', 'schema', 'dialogue', 'presets'}
        assert template['type'] == 'wzf-mascot-interactions' and template['schema'] == 1
        assert template['presets'][0]['motionFile'] == 'motion/extra.motion3.json'
        assert 'root' not in body and str(site) not in body and state() == template_base
        preview_url = inventory_url + '&character=23&mascot_template_preview=1'

        def template_preview(raw, presets=False, actor=None, invalid_nonce=False, targets=None):
            code, page = request(admin, inventory_url + '&character=23')
            assert code == 200
            fields = next(f for f in Forms(page).forms if 'action' not in f and f.get('character') == '23')
            if presets: fields['include_presets'] = '1'
            if targets is not None: fields['targets[]'] = targets
            if invalid_nonce: fields['_wpnonce'] = 'invalid'
            return request(actor or admin, preview_url, fields, {'template': ('interactions.json', raw)})

        # Preserve literal HTML entity text through WordPress attribute escaping
        # and the browser's one-pass entity decoding before native submission.
        template['dialogue']['click']['lines'] = ['Literal &amp; &quot; &copy; "reader" 中文 ✨']
        raw_template = json.dumps(template, ensure_ascii=False).encode()
        assert template_preview(raw_template, actor=reader)[0] == 403
        assert template_preview(raw_template, invalid_nonce=True)[0] == 403
        code, page = template_preview(raw_template)
        assert code == 200 and 'Nothing has been saved.' in page and state() == template_base
        apply_form = next(f for f in Forms(page).forms if f.get('action') == 'wzf_mascot_template_apply')
        assert apply_form['scope'] == 'dialogue'
        # Native HTML form submission normalizes line endings even in hidden
        # fields. Model that transport instead of only urllib's literal bytes.
        apply_form['payload'] = re.sub(r'\r\n|\r|\n', '\r\n', apply_form['payload'])
        post(apply_form); assert state() == template_base  # Separate confirmation is required.
        changed = json.loads(apply_form['payload'])
        changed['dialogue']['welcome']['lines'] = ['Not the reviewed text']
        post(dict(apply_form, confirm='1', payload=json.dumps(changed)))
        assert state() == template_base
        post(dict(apply_form, confirm='1'))
        applied = state()
        expected = json.loads(json.dumps(template_base['config']))
        expected['characters']['23']['dialogue'] = json.loads(json.dumps(template['dialogue']))
        expected['characters']['23']['dialogue']['idle']['enabled'] = False
        assert applied['config'] == expected and applied['lock'] is False
        assert not applied['config']['characters']['23']['dialogue']['idle']['enabled']
        post(dict(apply_form, confirm='1')); assert state() == applied  # Stale reviewed version.
        code, bad_page = template_preview(json.dumps(dict(template, core='not-allowed')).encode())
        assert code == 200 and not any(f.get('action') == 'wzf_mascot_template_apply' for f in Forms(bad_page).forms)
        assert state() == applied
        for field in ('enabled', 'cooldown'):
            invalid_rule = json.loads(raw_template)
            invalid_rule['dialogue']['welcome'][field] = None
            code, bad_page = template_preview(json.dumps(invalid_rule).encode())
            assert code == 200 and not any(f.get('action') == 'wzf_mascot_template_apply' for f in Forms(bad_page).forms)
            assert state() == applied
        code, bad_page = template_preview(b'x' * 65537)
        assert code == 200 and '64 KiB' in bad_page and state() == applied
        record('real interaction JSON export, read-only signed preview, explicit confirmation and dialogue-only apply retain scoped data')
        code, page = template_preview(raw_template, presets=True)
        assert code == 200 and 'motion/extra.motion3.json' in page
        apply_form = next(f for f in Forms(page).forms if f.get('action') == 'wzf_mascot_template_apply')
        assert apply_form['scope'] == 'dialogue-presets'
        apply_form['payload'] = re.sub(r'\r\n|\r|\n', '\r\n', apply_form['payload'])
        post(dict(apply_form, confirm='1'))
        expected['characters']['23']['presets'] = template_base['config']['characters']['legacy_character']['presets']
        assert state()['config'] == expected
        data = form('wzf_mascot_hits', character='23')
        data.update({'hitBindings[0][area]': 'Head [synthetic]', 'hitBindings[0][preset]': 'hello'})
        post(data); bound = state()
        assert bound['config']['characters']['23']['hitBindings'] == [{'area': 'Head [synthetic]', 'preset': 'hello'}]
        code, page = template_preview(raw_template, presets=True)
        assert code == 200 and 'This character has hit-area bindings.' in page
        assert not any(f.get('action') == 'wzf_mascot_template_apply' for f in Forms(page).forms)
        assert state() == bound
        code, page = template_preview(raw_template)
        assert code == 200 and any(f.get('action') == 'wzf_mascot_template_apply' for f in Forms(page).forms)
        assert state() == bound
        assert {p.relative_to(site).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in (site / 'wp-content/uploads/wzf-mascot').rglob('*') if p.is_file()} == template_files
        wp('option', 'update', 'wzf_mascot_resources_v1', json.dumps(template_base['config']), '--format=json')
        assert state() == template_base
        record('real preset template maps existing paths, rejects bound hit areas and preserves all resource bytes')

        # The preview document contains draft data and one small controller only.
        # Heavy runtime/model requests are checked separately by browser fixtures.
        preview_before = state()
        page = request(admin, inventory_url + '&character=legacy_character')[1]
        preview_nonce = re.search(r'class="button wzf-mascot-preview-draft"[^>]*data-nonce="([^"]+)"', page)[1]
        draft = {'dialogue': {'click': {'enabled': True, 'cooldown': 30, 'lines': ['Unsaved HTTP line']}},
                 'presets': [{'id':'http-draft','name':'HTTP draft','motion':'01_extra','expression':'','line':'Unsaved preset'}]}
        preview_fields = {'action':'wzf_mascot_interaction_preview','_wpnonce':preview_nonce,
            'character':'legacy_character','version':preview_before['version'],'draft':json.dumps(draft)}
        assert post(preview_fields, opener=reader)[0] == 403
        assert post(dict(preview_fields,_wpnonce='invalid'))[0] == 403
        for changed in [dict(preview_fields,version='0'*64), dict(preview_fields,url='https://invalid.example/'),
                        dict(preview_fields,draft=json.dumps({'root':'https://invalid.example/'}))]:
            assert post(changed)[0] == 400
            assert state() == preview_before
        code, preview_html = post(preview_fields)
        assert code == 200 and 'Unsaved HTTP line' in preview_html and 'interaction-preview.js' in preview_html
        assert '<script src="' + front()['core'] not in preview_html
        assert state() == preview_before
        record('real unsaved preview nonce, permission, version and strict fields reject writes; document contains current draft without heavy script loading')

        batch_before=state()
        code, batch_page=template_preview(raw_template, targets=['legacy_character','23','legacy_character'])
        assert code == 200 and state() == batch_before
        batch_form=next(f for f in Forms(batch_page).forms if f.get('action')=='wzf_mascot_template_batch_apply')
        assert json.loads(batch_form['targets']) == ['23','legacy_character']
        batch_form['confirm']='1'
        for changed in [dict(batch_form,targets='["missing"]'),dict(batch_form,signature='0'*64),dict(batch_form,issued='1')]:
            post(changed);assert state()==batch_before
        code, blocked_page=template_preview(raw_template,targets=['23','missing'])
        assert code==200 and not any(f.get('action')=='wzf_mascot_template_batch_apply' for f in Forms(blocked_page).forms)
        assert state()==batch_before
        if interaction_counts.exists(): interaction_counts.unlink()
        post(batch_form)
        batch_after=state()
        assert interaction_counts.read_text().splitlines()==['guard','save']
        for target in ['23','legacy_character']:
            assert batch_after['config']['characters'][target]['dialogue']['click']['lines']==template['dialogue']['click']['lines']
        assert batch_after['config']['characters']['fixture']==batch_before['config']['characters']['fixture']
        assert {p.relative_to(site).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in (site/'wp-content/uploads/wzf-mascot').rglob('*') if p.is_file()}==template_files
        wp('option','update','wzf_mascot_resources_v1',json.dumps(batch_before['config']),'--format=json')
        record('real all-target template preview blocks any invalid target; signed batch applies once under one guard and one resource update')
        data = form('wzf_mascot_hits'); data.update({'hitBindings[0][area]':'Head [synthetic]','hitBindings[0][preset]':'hello'})
        post(data); hit_state = state()['config']; assert hit_state['characters']['legacy_character']['hitBindings'] == [{'area':'Head [synthetic]','preset':'hello'}]
        bad = dict(data); bad['version'] = state()['version']; bad['hitBindings[0][area]']='Missing'
        post(bad); assert state()['config'] == hit_state
        wp('plugin', 'install', str(bundle), '--force', '--activate'); assert state()['config'] == hit_state
        record('real model-declared area binding, special-name value, unknown-area rejection and upgrade preservation')
        data = form('wzf_mascot_capture'); data['capture_allowed']='1'; before_capture = state()['config']
        post(data); assert state()['config'] == before_capture
        data['capture_confirmed']='1'; post(data); capture_state = state()['config']; assert capture_state['characters']['legacy_character']['captureAllowed'] is True
        assert front()['characters']['legacy_character']['captureAllowed'] is True and front()['characters']['fixture']['captureAllowed'] is False
        wp('plugin', 'install', str(bundle), '--force', '--activate'); assert state()['config'] == capture_state
        record('real PNG permission requires explicit confirmation, is per character and survives plugin upgrade')
        account_path = '/wp-admin/admin-ajax.php'
        account_action = {'action':'wzf_mascot_preferences','operation':'bootstrap'}
        code, body, headers = request(anonymous, account_path, account_action, with_headers=True)
        assert code == 401 and 'no-store' in headers.get('Cache-Control','')
        code, body, headers = request(reader, account_path, account_action, with_headers=True)
        bootstrap = json.loads(body)['data']; assert code == 200 and bootstrap['state'] == {'revision':0,'preferences':None}
        assert 'private' in headers.get('Cache-Control','') and 'no-store' in headers.get('Cache-Control','')
        account_preferences = {'character':'temporarily-disabled','favorites':['legacy_character','23','temporarily-disabled'],'layouts':[{'id':'legacy_character','position':'left','size':200,'anchor':{'x':0,'y':0.5}}]}
        payload = {'action':'wzf_mascot_preferences','operation':'save','nonce':'invalid','revision':'0','preferences':json.dumps(account_preferences)}
        assert request(reader, account_path, payload)[0] == 403
        payload['nonce'] = bootstrap['nonce']; foreign = dict(payload,uid=uid)
        assert request(reader, account_path, foreign)[0] == 403
        assert json.loads(request(admin, account_path, account_action)[1])['data']['state']['revision'] == 0
        assert 'nonce' not in front() and 'preferences' not in front()
        record('real account bootstrap is authenticated/private/no-store, save requires nonce and cannot address another user')
        before_account = state(); code, body = request(reader, account_path, payload)
        saved_account = json.loads(body)['data']['state']; assert code == 200 and saved_account == {'revision':1,'preferences':account_preferences}
        code, body = request(reader, account_path, payload); assert code == 409 and json.loads(body)['data']['code'] == 'conflict'
        invalid = dict(payload,revision='1',preferences=json.dumps(dict(account_preferences,mobile=True)))
        assert request(reader, account_path, invalid)[0] == 400
        assert state() == before_account
        wp('plugin', 'install', str(bundle), '--force', '--activate')
        assert json.loads(request(reader, account_path, account_action)[1])['data']['state'] == saved_account
        record('real account revision conflicts, strict scope, unavailable ID retention and upgrade preservation without resource option writes')
        domain_base = state()

        def account_save(opener):
            code, body = request(opener, account_path, account_action)
            assert code == 200
            boot = json.loads(body)['data']
            return request(opener, account_path, dict(payload, nonce=boot['nonce'], revision=str(boot['state']['revision'])))

        def legacy_exclusive_available():
            # Old-version behavior: hold the original inode exclusively for the
            # whole critical section, without consulting the new domain locks.
            return json.loads(wp('eval', "$handle=wzf_mascot_task_guard();$locked=flock($handle,LOCK_EX|LOCK_NB);if($locked)flock($handle,LOCK_UN);fclose($handle);echo json_encode($locked);"))

        changed_mobile = dict(domain_base['config'],
                              mobileEnabled=domain_base['config'].get('mobileEnabled') is not True,
                              mobilePauseOnInput=domain_base['config'].get('mobilePauseOnInput') is False)

        def changed_mobile_form():
            data = form('wzf_mascot_mobile')
            for key in ('mobile_enabled', 'pause_input'):
                data.pop(key, None)
            if changed_mobile['mobileEnabled']: data['mobile_enabled'] = '1'
            if changed_mobile['mobilePauseOnInput']: data['pause_input'] = '1'
            return data

        with held('account'):
            assert legacy_exclusive_available() is False
            assert account_save(admin)[0] == 503  # Same user remains exclusive.
            assert account_save(reader)[0] == 200
            code, page = request(admin, inventory_url)
            assert code == 200 and '<strong>Idle</strong>' in page
            # A real resource/settings request can enter its own domain.
            post(changed_mobile_form())
            assert state()['config'] == changed_mobile  # A redirected error is not success.
            assert state()['lock'] is False
        assert json.loads(request(admin, account_path, account_action)[1])['data']['state']['revision'] == 1
        wp('option', 'update', 'wzf_mascot_resources_v1', json.dumps(domain_base['config']), '--format=json')
        with held('resource'):
            assert state()['lock']['guard'] == 2
            assert legacy_exclusive_available() is False
            assert account_save(reader)[0] == 200
            code, page = request(admin, inventory_url)
            assert code == 200 and '<strong>Running</strong>' in page
        assert state() == domain_base
        record('real separate-process account domains: same user busy, other user/settings parallel, task status accurate')
        with held('legacy'):
            assert account_save(reader)[0] == 503
            code, page = request(admin, inventory_url)
            assert code == 200 and 'Legacy or unknown task state' in page
            assert not any(f.get('action') == 'wzf_mascot_task_recover' for f in Forms(page).forms)
            post(changed_mobile_form())
            assert state() == domain_base
        assert account_save(reader)[0] == 200
        assert state() == domain_base
        record('real legacy exclusive bridge blocks new account/settings writers without exposing unsafe recovery')
        data = form('wzf_mascot_settings'); stale = dict(data)
        data.update(name='Updated synthetic', credit='Synthetic credit', size='200', offset='6.5', idle='motion-1', welcome='01_extra', **{'greetings[]': '01_extra'})
        post(data); updated = state()['config']; c = updated['characters']['legacy_character']; old = original['characters']['legacy_character']
        assert c['name'] == 'Updated synthetic' and c['renderScale'] == 1.1 and c['root'] == old['root'] and c['termsAnchor'] == old['termsAnchor'] and updated['retainedMarker'] == original['retainedMarker']
        stale.update(name='Stale', credit='Synthetic', size='180', offset='0', idle='motion-1', welcome='')
        post(stale); assert state()['config'] == updated; record('real settings save preserves unexposed fields and rejects stale version')
        data = form('wzf_mascot_manage', 'replace'); data.update(rights='1'); post(data, {'resource': (z.name, z.read_bytes())})
        assert state()['config'] == updated  # extra welcome cannot be mapped; explicit reset required
        data['reset_motions'] = '1'; post(data, {'resource': (z.name, z.read_bytes())})
        replaced = state()['config']; assert replaced['characters']['legacy_character']['root'] != c['root']
        assert replaced['characters']['legacy_character']['welcome'] is None
        assert replaced['characters']['legacy_character']['captureAllowed'] is False
        assert replaced['characters']['legacy_character']['presets'] == [] and replaced['characters']['legacy_character']['presetWarnings'] == 1
        assert replaced['characters']['legacy_character']['hitBindings'] == [] and replaced['characters']['legacy_character']['hitWarnings'] == 1
        assert 'Some presets are invalid' in request(admin, '/wp-admin/options-general.php?page=wzf-mascot&character=legacy_character')[1]
        post(form('wzf_mascot_manage', 'rollback')); rolled = state()['config']['characters']['legacy_character']
        assert rolled['root'] == c['root'] and rolled['welcome'] == '01_extra' and rolled['name'] == c['name']
        assert rolled['presets'][0]['motion'] == '01_extra' and rolled['dialogue'] == c['dialogue']
        assert rolled['hitBindings'] == c['hitBindings']
        assert rolled['captureAllowed'] is False
        for operation, status in [('disable', 'disabled'), ('trash', 'trash'), ('restore', 'disabled'), ('enable', 'active')]:
            post(form('wzf_mascot_manage', operation)); assert state()['config']['characters']['legacy_character']['status'] == status
            assert ('legacy_character' in front()['characters']) == (status == 'active')
            filter_html = request(admin, inventory_url + '&mascot_status=' + status)[1]
            assert ('legacy_character' in listed(filter_html)) is True
            other = 'trash' if status != 'trash' else 'active'
            assert 'legacy_character' not in listed(request(admin, inventory_url + '&mascot_status=' + other)[1])
        record('real multipart replacement/reset, rollback, disable/trash/restore/enable')
        data = form('wzf_mascot_thumbnail', 'upload'); data['rights'] = '1'; post(data, {'thumbnail': ('synthetic.png', PNG + b'fixture-trailer')})
        thumbnail_state = state()['config']['characters']['legacy_character']
        assert 'thumbnail' in thumbnail_state, 'Synthetic thumbnail upload failed'
        thumb = thumbnail_state['thumbnail']; thumb_file = site / 'wp-content/uploads/wzf-mascot' / thumb
        assert 'thumbnail-' in front()['characters']['legacy_character']['thumbnail'] and b'fixture-trailer' not in thumb_file.read_bytes()
        post(form('wzf_mascot_thumbnail', 'clear')); assert 'thumbnail' not in state()['config']['characters']['legacy_character'] and thumb_file.exists()
        data = form('wzf_mascot_mobile'); data.update(mobile_enabled='1', pause_input='1'); post(data)
        assert front()['mobileEnabled'] is True and front()['mobilePauseOnInput'] is True
        record('real thumbnail upload/reencode/clear and explicit mobile settings')

        # Operate only on the real re-encoded synthetic thumbnail just detached
        # above. The private directory is outside this disposable HTTP document root.
        recovery_before = state()
        private = lab / 'recovery'; private.mkdir(mode=0o700)
        assert 'WZF_MASCOT_RECOVERY_DIR' in request(admin, inventory_url)[1]
        default_error = wp('eval', "wp_set_current_user(" + str(uid) + ");try{wzf_mascot_recovery_preview('quarantine'," + json.dumps(Path(thumb).parent.name) + ");echo 'unsafe';}catch(Throwable $e){echo 'disabled';}")
        assert default_error == 'disabled' and state() == recovery_before
        record('resource recovery is read-only without an explicit private server directory')
        wp('config','set','WZF_MASCOT_RECOVERY_DIR',str(private))
        old_root = thumb_file.parent.name
        for path in [thumb_file, thumb_file.parent]: os.utime(path,(time.time()-40*86400,)*2)
        def recovery_review(operation, target):
            page = request(admin, inventory_url)[1]
            nonce = next(f['_wpnonce'] for f in Forms(page).forms if f.get('recovery_review') == '1')
            fields = {'recovery_review':'1','operation':operation,'path':target,'days':'30','version':state()['version'],'_wpnonce':nonce}
            code, page = request(admin, inventory_url, fields)
            assert code == 200
            return fields, next((f for f in Forms(page).forms if f.get('action') == 'wzf_mascot_recovery'), None)
        fields, move = recovery_review('quarantine',old_root)
        assert move and state() == recovery_before
        assert request(reader, inventory_url,fields)[0] == 403
        assert request(admin,inventory_url,dict(fields,_wpnonce='invalid'))[0] == 403
        assert post(dict(move,confirm='1'),opener=reader)[0] == 403
        assert post(dict(move,_wpnonce='invalid',confirm='1'))[0] == 403
        post(move); assert thumb_file.exists()  # Separate confirmation.
        post(dict(move,confirm='1',signature='0'*64)); assert thumb_file.exists()
        post(dict(move,confirm='1')); assert not thumb_file.exists() and state() == recovery_before
        records=list((private/'blog-1').glob('*/manifest.json')); assert len(records)==1
        rid=records[0].parent.name; payload=records[0].parent/'payload/image.png'
        assert payload.is_file()
        assert request(anonymous,'/recovery/blog-1/'+rid+'/payload/image.png')[0] == 404
        _, restore=recovery_review('restore',rid); assert restore
        post(dict(restore,confirm='1')); assert thumb_file.is_file() and not payload.exists()
        assert json.loads(records[0].read_text())['state']=='restored' and state()==recovery_before
        record('real signed quarantine and restore require permission, nonce and separate confirmation; private payload has no HTTP route and config is unchanged')
        _, move=recovery_review('quarantine',old_root); post(dict(move,confirm='1'))
        records=[p for p in (private/'blog-1').glob('*/manifest.json') if json.loads(p.read_text())['state']=='quarantined']; assert len(records)==1
        rid=records[0].parent.name
        _, purge=recovery_review('purge',rid); assert purge is None
        wp('config','set','WZF_MASCOT_ALLOW_PERMANENT_DELETE','true','--raw')
        _, purge=recovery_review('purge',rid); assert purge is None  # No shortened 30-day hold.
        wp('eval', "$r=wzf_mascot_recovery_record("+json.dumps(rid)+");$r['quarantined']=time()-31*86400;wzf_mascot_recovery_write(wzf_mascot_recovery_record_dir($r['id']),$r);")
        _, purge=recovery_review('purge',rid); assert purge
        post(dict(purge,confirm='1',typed='wrong')); assert (records[0].parent/'payload').exists()
        post(dict(purge,confirm='1',typed=old_root)); assert not (records[0].parent/'payload').exists()
        assert json.loads(records[0].read_text())['state']=='purged' and state()==recovery_before
        wp('config','set','WZF_MASCOT_ALLOW_PERMANENT_DELETE','false','--raw')
        record('real permanent deletion requires server opt-in, 30 days in quarantine, signed review and exact-name confirmation; tombstone and configuration remain')
        fixture('restore'); fixture('fault'); faulty = state(); assert set(front()['characters']) == {'fixture', 'legacy_character', '23'}
        status, html = request(admin, '/wp-admin/options-general.php?page=wzf-mascot&character=bad-name'); assert status == 200 and 'Isolated' in html
        assert str(site) not in request(anonymous, '/')[1] and state() == faulty
        diagnosis = json.loads(fixture('diagnose')); assert not diagnosis['core']['ok']  # synthetic Core never passes full hash diagnosis
        assert listed(request(admin, inventory_url + '&mascot_status=isolated')[1]) == {'bad-root','bad-file','missing','bad-name','bad-state','bad-greetings','not-array','linked'}
        status, html = request(admin, inventory_url)
        inventory = next(f for f in Forms(html).forms if f.get('mascot_inventory') == '1')
        status, html = request(admin, inventory_url, inventory)
        assert status == 200 and 'Unreferenced classification is withheld.' in html
        export_form = next(f for f in Forms(html).forms if f.get('mascot_inventory_export') == '1')
        partial = json.loads(request(admin, inventory_url, export_form)[1])
        assert not partial['referencesComplete'] and partial['bytes'] is None and not partial['characterSummary']['complete']
        assert all(row['total']['bytes'] is None for row in partial['characterSummary']['characters'])
        assert state() == faulty; record('bad roles isolated, valid roles continue; admin diagnosis/inventory read-only and synthetic Core fails full hash')
        for mode in ['all-bad', 'bad-core', 'bad-terms', 'bad-structure']:
            fixture('restore'); fixture(mode); before = state(); assert front() is None and state() == before
        record('all-bad roles/shared Core/terms/base structure fail closed without option writes')
        fixture('restore'); before = state(); wp('plugin', 'deactivate', 'live2d-show'); assert front() is None
        wp('plugin', 'activate', 'live2d-show'); assert state() == before and front() is not None
        record('real plugin deactivation/reactivation retains resources and configuration')
        for locale, title, show in [('en_US', 'Character management', 'Show mascot'), ('zh_CN', '角色管理', '显示看板娘')]:
            wp('option', 'update', 'WPLANG', '' if locale == 'en_US' else locale)
            wp('user', 'meta', 'update', uid, 'locale', locale)
            before = state()
            status, html = request(admin, inventory_url); assert status == 200 and title in html
            assert 'Synthetic fixture' in html and 'Synthetic owner' in html
            dictionary = front()['i18n']; assert dictionary['Show mascot'] == show
            assert '%1$s' in dictionary['Using %1$s; this browser will remember your selection.']
            status, html = request(admin, '/wp-admin/profile.php'); assert status == 200
            assert ('Allow the mascot on the frontend' if locale == 'en_US' else '允许前台显示看板娘') in html
            assert state() == before
        wp('option', 'update', 'WPLANG', ''); wp('user', 'meta', 'delete', uid, 'locale')
        record('real WordPress en_US/zh_CN admin/profile/frontend gettext retains resource data and placeholders')
        if len(checks) != 34:
            raise RuntimeError(f'Expected 34 completed integration groups, got {len(checks)}')
        completed = True
    except BaseException as error:
        failure = {'type': type(error).__name__, 'request': last_request}
        raise
    finally:
        exit_before_cleanup = server.poll()
        if exit_before_cleanup is None:
            server.terminate()
        server.wait(timeout=10); logfile.close()
        report = {'wordpress': PINS['wordpress'][0], 'wp_cli': PINS['wp-cli'][0], 'php': subprocess.check_output(['php', '-r', 'echo PHP_VERSION;'], text=True), 'checks': checks, 'complete': completed, 'synthetic_only': True, 'real_rendering_tested': False, 'server_stopped': True}
        report['http_server'] = {'exit_before_cleanup': exit_before_cleanup,
                                 'exit_after_cleanup': server.returncode,
                                 'runtime': http_runtime,
                                 'log': server_diagnostics(lab / 'http.log', site)}
        if failure is not None:
            report['failure'] = failure
        (lab / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__': main()
