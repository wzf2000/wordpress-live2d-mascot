#!/usr/bin/env python3
"""New isolated real WordPress + HTTP admin forms; synthetic data, no render acceptance."""
import argparse
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
    router.write_text("<?php $p=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH); if (is_file($_SERVER['DOCUMENT_ROOT'].$p)) return false; if (is_dir($_SERVER['DOCUMENT_ROOT'].$p) && is_file(rtrim($_SERVER['DOCUMENT_ROOT'].$p,'/').'/index.php')) { require rtrim($_SERVER['DOCUMENT_ROOT'].$p,'/').'/index.php'; return; } require $_SERVER['DOCUMENT_ROOT'].'/index.php';\n")
    logfile = (lab / 'http.log').open('w')
    server = subprocess.Popen(['php', '-S', '127.0.0.1:' + str(args.port), '-t', str(site), str(router)], env=env, stdout=logfile, stderr=logfile)
    checks = []

    def client(): return urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    anonymous, admin, reader = client(), client(), client()

    def request(opener, path, data=None, files=None, with_headers=False):
        url = origin + path
        headers = {}
        if files:
            boundary = 'mascot-' + secrets.token_hex(12); parts = []
            for k, v in data.items():
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
    def front():
        status, html = request(anonymous, '/'); assert status == 200
        m = re.search(r'<script id="wzf-live2d-config"[^>]*>(.*?)</script>', html, re.S)
        return json.loads(m[1]) if m else None
    def form(action, operation=None, character='legacy_character'):
        status, html = request(admin, '/wp-admin/options-general.php?page=wzf-mascot&character=' + character); assert status == 200
        return next(f for f in Forms(html).forms if f.get('action') == action and (operation is None or f.get('operation') == operation))
    def post(data, files=None, opener=None): return request(opener or admin, '/wp-admin/admin-post.php', data, files)
    def record(name): checks.append(name); print('PASS ' + name, flush=True)

    try:
        for _ in range(50):
            try: request(anonymous, '/wp-login.php'); break
            except (urllib.error.URLError, ConnectionError): time.sleep(.1)
        assert front() is None; record('real install/upgrade preserves existing option; empty resources emit nothing')
        for opener, user in [(admin, 'mascot-admin'), (reader, 'mascot-reader')]:
            request(opener, '/wp-login.php')
            status, html = request(opener, '/wp-login.php', {'log': user, 'pwd': password, 'wp-submit': 'Log In', 'redirect_to': origin + '/wp-admin/', 'testcookie': '1'})
            assert status == 200 and 'login_error' not in html
        before = state()
        for action in ['settings', 'manage', 'thumbnail', 'mobile', 'import', 'task_recover', 'interaction', 'presets', 'hits']:
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
        fixture('task-legacy'); legacy = state(); html = request(admin, inventory_url)[1]
        assert 'Legacy or unknown task state' in html and not any(f.get('action') == 'wzf_mascot_task_recover' for f in Forms(html).forms)
        post(recovery); assert state() == legacy; fixture('task-clear')
        assert json.loads(fixture('task-cache-check')) == {'rejected': True, 'retained': True, 'lock': False}
        fixture('restore'); assert state()['config'] == original
        record('real HTTP guarded recovery, confirmation/nonce/permission/replacement/legacy rejection and stale option cache conflict')
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
        data = form('wzf_mascot_interaction'); stale_dialogue = dict(data)
        for event in ['welcome','click','morning','afternoon','evening','return']:
            data['dialogue[' + event + '][lines]'] = 'Hello local reader\nAnother local line' if event == 'welcome' else ''
            data['dialogue[' + event + '][cooldown]'] = '15'
        data['dialogue[welcome][enabled]'] = '1'
        post(data); dialogue_state = state()['config']
        assert dialogue_state['characters']['legacy_character']['dialogue']['welcome']['lines'] == ['Hello local reader','Another local line']
        assert front()['characters']['legacy_character']['dialogue']['welcome']['enabled']
        post(stale_dialogue); assert state()['config'] == dialogue_state
        bad = form('wzf_mascot_interaction'); bad.update(data); bad['version'] = state()['version']; bad['dialogue[welcome][lines]'] = '<script>bad</script>'
        post(bad); assert state()['config'] == dialogue_state
        wp('plugin', 'install', str(bundle), '--force', '--activate'); assert state()['config'] == dialogue_state
        record('real dialogue save, stale version, invalid text and upgrade preservation')
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
        data = form('wzf_mascot_hits'); data.update({'hitBindings[0][area]':'Head [synthetic]','hitBindings[0][preset]':'hello'})
        post(data); hit_state = state()['config']; assert hit_state['characters']['legacy_character']['hitBindings'] == [{'area':'Head [synthetic]','preset':'hello'}]
        bad = dict(data); bad['version'] = state()['version']; bad['hitBindings[0][area]']='Missing'
        post(bad); assert state()['config'] == hit_state
        wp('plugin', 'install', str(bundle), '--force', '--activate'); assert state()['config'] == hit_state
        record('real model-declared area binding, special-name value, unknown-area rejection and upgrade preservation')
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
        assert replaced['characters']['legacy_character']['presets'] == [] and replaced['characters']['legacy_character']['presetWarnings'] == 1
        assert replaced['characters']['legacy_character']['hitBindings'] == [] and replaced['characters']['legacy_character']['hitWarnings'] == 1
        assert 'Some presets are invalid' in request(admin, '/wp-admin/options-general.php?page=wzf-mascot&character=legacy_character')[1]
        post(form('wzf_mascot_manage', 'rollback')); rolled = state()['config']['characters']['legacy_character']
        assert rolled['root'] == c['root'] and rolled['welcome'] == '01_extra' and rolled['name'] == c['name']
        assert rolled['presets'][0]['motion'] == '01_extra' and rolled['dialogue'] == c['dialogue']
        assert rolled['hitBindings'] == c['hitBindings']
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
    finally:
        server.terminate(); server.wait(timeout=10); logfile.close()
        report = {'wordpress': PINS['wordpress'][0], 'wp_cli': PINS['wp-cli'][0], 'php': subprocess.check_output(['php', '-r', 'echo PHP_VERSION;'], text=True), 'checks': checks, 'complete': len(checks) == 19, 'synthetic_only': True, 'real_rendering_tested': False, 'server_stopped': True}
        (lab / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__': main()
