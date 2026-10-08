"""Synthetic ZIP/PHP-stub importer security tests; no Core download or production writes."""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfZkAAAAASUVORK5CYII=')


class ImporterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mascot-import-test-')
        self.root = Path(self.temp.name)
        self.counter = 0

    def tearDown(self):
        self.temp.cleanup()

    def fixture(self, change=None, entries=None):
        self.counter += 1
        path = self.root / f'model-{self.counter}.zip'
        files = {'Model.model3.json': {'Version':3,'FileReferences':{
            'Moc':'Model.moc3','Textures':['textures/a.png'],
            'Motions':{'Idle':[{'File':'motion/idle.motion3.json'}]},'Expressions':[]}},
            'Model.moc3':b'MOC3synthetic','textures/a.png':PNG,
            'motion/idle.motion3.json':{'Version':3}, 'unused.png':PNG}
        if change:
            change(files)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as archive:
                for name,value in files.items():
                    archive.writestr(name,json.dumps(value) if isinstance(value,dict) else value)
                for name,data in entries or []:
                    archive.writestr(name,data)
        return path

    def php(self, body):
        preamble = '''define('ABSPATH', '/stub/');
        $options=[]; $allowed=true; $write_fail=false;
        function add_action(...$x) {} function add_filter(...$x) {} function plugin_basename($p) { return "live2d-show/live2d-show.php"; }
        function current_user_can($x) { global $allowed; return $allowed; }
        function wp_upload_dir(...$x) { return ['basedir'=>getenv('TEST_UPLOADS'),'baseurl'=>'https://example.invalid/uploads','error'=>false]; }
        function wp_mkdir_p($p) { return is_dir($p) || mkdir($p,0755,true); }
        function add_option($k,$v,...$x) { global $options; if (isset($options[$k])) return false; $options[$k]=$v; return true; }
        function get_option($k,$d=false) { global $options; return $options[$k] ?? $d; }
        function update_option($k,$v,...$x) { global $options,$write_fail; if ($write_fail) return false; $options[$k]=$v; return true; }
        function delete_option($k) { global $options; unset($options[$k]); }
        function wp_die(...$x) { throw new RuntimeException('forbidden'); }
        function check_admin_referer($x) { throw new RuntimeException('nonce rejected'); }
        require getenv('TEST_MODULE');
        try { ''' + body + ''' } catch (Throwable $e) { echo json_encode(['ok'=>false,'error'=>$e->getMessage()]); }'''
        env = dict(os.environ,TEST_UPLOADS=str(self.root/'uploads'),TEST_MODULE=str(ROOT/'plugin/includes/admin-import.php'))
        result = subprocess.run(['php','-r',preamble],env=env,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stderr,'')
        return json.loads(result.stdout)

    def parse(self,path):
        return self.php('$r=wzf_mascot_model_zip('+json.dumps(str(path))+'); echo json_encode(["ok"=>true,"files"=>array_keys($r["files"]),"idle"=>$r["idle"]]);')

    def test_single_model_closure_and_generated_idle(self):
        report = self.parse(self.fixture())
        self.assertTrue(report['ok'])
        self.assertNotIn('unused.png',report['files'])
        self.assertIn('catalog.json',report['files'])
        self.assertEqual(report['idle'],'motion-1')

    def test_paths_encoded_absolute_duplicates_and_symlink(self):
        cases = ['../escape.png','/absolute.png','folder/%2e%2e/a.png','a\\b.png','C:/a.png','textures/a.png','TEXTURES/A.PNG']
        link = zipfile.ZipInfo('link.png'); link.create_system=3; link.external_attr=0o120777<<16
        for name in cases+[link]:
            with self.subTest(name=name.filename if isinstance(name,zipfile.ZipInfo) else name):
                self.assertFalse(self.parse(self.fixture(entries=[(name,b'bad')]))['ok'])

    def test_scripts_editor_audio_and_second_model(self):
        for name in ['shell.php','bad.js','bad.html','voice.wav','edit.can3','evil.php.png','evil.php.motion3.json','Second.model3.json']:
            with self.subTest(name=name):
                self.assertFalse(self.parse(self.fixture(entries=[(name,b'{}')]))['ok'])

    def test_missing_refs_bad_moc_png_and_motion(self):
        def missing(files): del files['textures/a.png']
        def moc(files): files['Model.moc3']=b'not moc'
        def png(files): files['textures/a.png']=b'not PNG'
        def no_motion(files): files['Model.model3.json']['FileReferences']['Motions']={}
        def escape(files): files['Model.model3.json']['FileReferences']['Moc']='../outside.moc3'
        def sound(files): files['Model.model3.json']['FileReferences']['Motions']['Idle'][0]['Sound']='voice.wav'
        for change in [missing,moc,png,no_motion,escape,sound]:
            with self.subTest(change=change.__name__):
                self.assertFalse(self.parse(self.fixture(change))['ok'])

    def test_compression_bomb_and_count(self):
        self.assertFalse(self.parse(self.fixture(entries=[('big.png',b'0'*(2*1024*1024))]))['ok'])
        self.assertFalse(self.parse(self.fixture(entries=[(f'extra-{i}.png',b'x') for i in range(1001)]))['ok'])

    def test_privilege_and_nonce_before_upload(self):
        report=self.php('$allowed=false; wzf_mascot_import_post();')
        self.assertFalse(report['ok']); self.assertEqual(report['error'],'forbidden')
        report=self.php('wzf_mascot_import_post();')
        self.assertFalse(report['ok']); self.assertEqual(report['error'],'nonce rejected')

    def test_unknown_core_is_never_persisted(self):
        file=self.root/'core.js';file.write_text('malicious();')
        self.assertFalse(self.php('wzf_mascot_save_resource("core",'+json.dumps(str(file))+'); echo json_encode(["ok"=>true]);')['ok'])
        self.assertFalse((self.root/'uploads').exists())

    def test_two_models_non_haru_ids_and_duplicate_id_preserves_config(self):
        path=json.dumps(str(self.fixture()))
        report=self.php('''wzf_mascot_save_resource('model','''+path+''',['id'=>'first-character','name'=>'First','credit'=>'Owner']);
        wzf_mascot_save_resource('model','''+path+''',['id'=>'second-character','name'=>'Second']);
        $before=get_option(WZF_MASCOT_OPTION);
        try { wzf_mascot_save_resource('model','''+path+''',['id'=>'first-character','name'=>'Replacement']); } catch(Throwable $e) {}
        echo json_encode(['ok'=>true,'unchanged'=>$before===get_option(WZF_MASCOT_OPTION),'ids'=>array_keys(get_option(WZF_MASCOT_OPTION)['characters']),'lock'=>get_option(WZF_MASCOT_LOCK)]);''')
        self.assertTrue(report['unchanged'])
        self.assertEqual(report['ids'],['first-character','second-character'])
        self.assertFalse(report['lock'])
        dirs=list((self.root/'uploads/wzf-mascot').glob('model-*'))
        self.assertEqual(len(dirs),2)
        self.assertFalse(list((self.root/'uploads/wzf-mascot').glob('stage-*')))

    def test_lock_and_write_failure_are_fail_closed(self):
        path=json.dumps(str(self.fixture()))
        report=self.php('''$options[WZF_MASCOT_LOCK]=['token'=>'other'];
        try { wzf_mascot_save_resource('model','''+path+''',['id'=>'first','name'=>'First']); } catch(Throwable $e) {}
        echo json_encode(['ok'=>true,'locked'=>get_option(WZF_MASCOT_LOCK)['token']==='other','config'=>get_option(WZF_MASCOT_OPTION)]);''')
        self.assertTrue(report['locked']);self.assertFalse(report['config'])
        report=self.php('''$write_fail=true;
        try { wzf_mascot_save_resource('model','''+path+''',['id'=>'first','name'=>'First']); } catch(Throwable $e) {}
        echo json_encode(['ok'=>true,'lock'=>get_option(WZF_MASCOT_LOCK),'config'=>get_option(WZF_MASCOT_OPTION)]);''')
        self.assertFalse(report['lock']);self.assertFalse(report['config'])
        self.assertFalse(list((self.root/'uploads/wzf-mascot').glob('model-*')))

    def test_invalid_name_and_id(self):
        path=json.dumps(str(self.fixture()))
        for fields in [{'id':'../bad','name':'First'},{'id':'test','name':'<script>x</script>'},{'id':'constructor','name':'First'}]:
            code='wzf_mascot_save_resource("model",'+path+','+('['+','.join(json.dumps(k)+'=>'+json.dumps(v) for k,v in fields.items())+']')+'); echo json_encode(["ok"=>true]);'
            self.assertFalse(self.php(code)['ok'])

    def test_double_extension_with_valid_data_and_reference(self):
        for name,data in [('evil.php.png',PNG),('evil.phtml.motion3.json',b'{"Version":3}')]:
            self.assertFalse(self.parse(self.fixture(entries=[(name,data)]))['ok'])
        def change(files):
            files['textures/evil.php.png']=files.pop('textures/a.png')
            files['Model.model3.json']['FileReferences']['Textures']=['textures/evil.php.png']
        self.assertFalse(self.parse(self.fixture(change))['ok'])

    def test_uploaded_and_actual_decompressed_size_limits(self):
        large=self.root/'large.zip'
        with large.open('wb') as stream: stream.truncate(64*1024*1024+1)
        self.assertFalse(self.parse(large)['ok'])
        # Repeated random blocks stay below the ratio cutoff but exceed aggregate size.
        block=os.urandom(16384)*640
        path=self.fixture(entries=[(f'unused-{i}.png',block) for i in range(7)])
        self.assertLess(path.stat().st_size,64*1024*1024)
        report=self.parse(path)
        self.assertFalse(report['ok'])
        self.assertIn('64 MiB',report['error'])

    def test_imported_frontend_config_has_upload_and_plugin_urls(self):
        path=json.dumps(str(self.fixture()))
        report=self.php("""wzf_mascot_save_resource('model',"""+path+""",['id'=>'first-character','name'=>'First & \"Name\"']);
        $u=wzf_mascot_uploads(true); mkdir($u['path'].'/core-test'); file_put_contents($u['path'].'/core-test/core.js','stub');
        $options[WZF_MASCOT_OPTION]['core']=['path'=>'core-test/core.js','sha256'=>WZF_MASCOT_CORE_SHA];
        function is_admin(){return false;} function is_user_logged_in(){return false;}
        function plugins_url(...$args){return '/nested/wp-content/plugins/live2d-show';}
        function esc_url($s){return htmlspecialchars($s,ENT_QUOTES);}
        function wp_json_encode($s,$f){return json_encode($s,$f);}
        require dirname(getenv('TEST_MODULE'),2).'/live2d-show.php';
        ob_start(); wzf_haru_output(); $html=ob_get_clean();
        preg_match('~<script id="wzf-live2d-config"[^>]*>(.*?)</script>~s',$html,$match);
        echo json_encode(['ok'=>true,'config'=>json_decode($match[1],true),'html'=>$html]);""")
        config=report['config']
        self.assertEqual(config['core'],'https://example.invalid/uploads/wzf-mascot/core-test/core.js')
        self.assertEqual(set(config['characters']),{'first-character'})
        self.assertTrue(config['characters']['first-character']['root'].startswith('https://example.invalid/uploads/wzf-mascot/model-'))
        self.assertTrue(config['engine'].startswith('/nested/wp-content/plugins/live2d-show/haru-engine-'))
        self.assertEqual(config['characters']['first-character']['name'],'First & "Name"')
        self.assertNotIn('haru/',config['model'])

    def test_plugin_list_settings_permission_and_targeted_metadata(self):
        report=self.php("""function admin_url($path){return 'https://example.invalid/wp-admin/'.$path;}
        function esc_url($value){return htmlspecialchars($value, ENT_QUOTES);}
        require dirname(getenv('TEST_MODULE'),2).'/live2d-show.php';
        $base=['Existing'];
        $admin=wzf_mascot_action_links($base);
        $allowed=false;
        $other=wzf_mascot_action_links($base);
        $own=wzf_mascot_row_meta($base,'live2d-show/live2d-show.php');
        $unrelated=wzf_mascot_row_meta($base,'another-plugin/plugin.php');
        echo json_encode(['admin'=>$admin,'other'=>$other,'own'=>$own,'unrelated'=>$unrelated]);""")
        self.assertEqual(len(report['admin']),2)
        self.assertIn('https://example.invalid/wp-admin/options-general.php?page=wzf-mascot',report['admin'][0])
        self.assertIn('设置',report['admin'][0])
        self.assertEqual(report['other'],['Existing'])
        self.assertEqual(report['unrelated'],['Existing'])
        self.assertEqual(report['own'][0],'Existing')
        self.assertEqual(len(report['own']),3)
        self.assertIn('wordpress-live2d-mascot#readme',report['own'][1])
        self.assertIn('wordpress-live2d-mascot/issues',report['own'][2])

    def presentation(self, value, setup=''):
        raw=json.dumps({'presentation':value},ensure_ascii=False)
        return self.php("""require dirname(getenv('TEST_MODULE'),2).'/live2d-show.php';
        $u=wzf_mascot_uploads(true); if (!is_dir($u['path'].'/terms')) mkdir($u['path'].'/terms');
        file_put_contents($u['path'].'/terms/site.html','<html>Example terms</html>');
        """+setup+"""
        $resources=json_decode("""+json.dumps(raw)+""",true);
        echo json_encode(['ok'=>true,'default'=>wzf_mascot_presentation([], $u),'presentation'=>wzf_mascot_presentation($resources,$u)]);""")

    def test_valid_site_presentation_retains_plaintext_and_default(self):
        value={'terms':'terms/site.html','termsVersion':'legacy-v1','consentText':'Example owner: terms & conditions.'}
        report=self.presentation(value)
        self.assertTrue(report['ok'])
        self.assertEqual(report['default'],[])
        self.assertEqual(report['presentation']['terms'],'https://example.invalid/uploads/wzf-mascot/terms/site.html')
        self.assertEqual(report['presentation']['termsVersion'],'legacy-v1')
        self.assertEqual(report['presentation']['consentText'],value['consentText'])

    def test_invalid_presentation_paths_plaintext_and_symlink_refused(self):
        good={'terms':'terms/site.html','termsVersion':'legacy-v1','consentText':'Example terms.'}
        for key,value in [('terms','../outside.html'),('terms','https://example.invalid/terms.html'),
                          ('terms','terms/missing.html'),('terms','terms/site.php'),
                          ('termsVersion','<b>legacy</b>'),('consentText','<script>alert(1)</script>'),
                          ('termsVersion',''),('consentText','line\nnew'),('consentText','x'*2001)]:
            with self.subTest(key=key,value=value[:40]):
                changed=dict(good);changed[key]=value
                self.assertFalse(self.presentation(changed)['ok'])
        missing=dict(good);del missing['consentText']
        self.assertFalse(self.presentation(missing)['ok'])
        self.assertFalse(self.presentation(good,"unlink($u['path'].'/terms/site.html'); symlink($u['path'].'/index.html',$u['path'].'/terms/site.html');")['ok'])

    def test_frontend_presentation_and_character_fields_preserved(self):
        path=json.dumps(str(self.fixture()))
        report=self.php("""wzf_mascot_save_resource('model',"""+path+""",['id'=>'custom-character','name'=>'Example','credit'=>'Example owner']);
        $u=wzf_mascot_uploads(true);mkdir($u['path'].'/terms');file_put_contents($u['path'].'/terms/site.html','<html>Example terms</html>');
        mkdir($u['path'].'/core-test');file_put_contents($u['path'].'/core-test/core.js','stub');
        $options[WZF_MASCOT_OPTION]['core']=['path'=>'core-test/core.js','sha256'=>WZF_MASCOT_CORE_SHA];
        $options[WZF_MASCOT_OPTION]['presentation']=['terms'=>'terms/site.html','termsVersion'=>'legacy-v1','consentText'=>'Example owner & terms.'];
        $options[WZF_MASCOT_OPTION]['characters']['custom-character']['welcome']='motion-1';
        $options[WZF_MASCOT_OPTION]['characters']['custom-character']['greetings']=['motion-1'];
        function is_admin(){return false;}function is_user_logged_in(){return false;}
        function plugins_url(...$args){return '/nested/wp-content/plugins/live2d-show';}
        function esc_url($s){return htmlspecialchars($s,ENT_QUOTES);}
        function wp_json_encode($s,$f){return json_encode($s,$f);}
        require dirname(getenv('TEST_MODULE'),2).'/live2d-show.php';
        ob_start();wzf_haru_output();$html=ob_get_clean();
        preg_match('~<script id="wzf-live2d-config"[^>]*>(.*?)</script>~s',$html,$match);
        echo json_encode(['ok'=>true,'config'=>json_decode($match[1],true)]);""")
        config=report['config']
        self.assertEqual(config['terms'],'https://example.invalid/uploads/wzf-mascot/terms/site.html')
        self.assertEqual(config['termsVersion'],'legacy-v1')
        self.assertEqual(config['consentText'],'Example owner & terms.')
        character=config['characters']['custom-character']
        self.assertEqual(character['welcome'],'motion-1')
        self.assertEqual(character['greetings'],['motion-1'])
        self.assertEqual(character['credit'],'Example owner')

    def test_zero_resources_frontend_empty(self):
        env=dict(os.environ,TEST_ENTRY=str(ROOT/'plugin/live2d-show.php'))
        code='define("ABSPATH","/stub/"); function add_action(...$x) {} function add_filter(...$x) {} function plugin_basename($p) { return "live2d-show/live2d-show.php"; } function is_admin(){return false;} function is_user_logged_in(){return false;} function get_option($k,$d){return $d;} require getenv("TEST_ENTRY"); wzf_haru_output();'
        result=subprocess.run(['php','-r',code],env=env,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout,'');self.assertEqual(result.stderr,'')


if __name__ == '__main__': unittest.main()
