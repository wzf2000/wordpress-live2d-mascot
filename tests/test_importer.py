"""Synthetic ZIP/PHP-stub importer security tests; no Core download or production writes."""
import base64
import json
import struct
import zlib
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
        function __($s,$domain=null) {return $s;}
        function _n($single,$plural,$count,$domain=null) {return $count===1?$single:$plural;}
        function number_format_i18n($number,$decimals=0) {return number_format($number,$decimals);}
        function esc_html__($s,$domain=null) {return htmlspecialchars($s,ENT_QUOTES);}
        function esc_attr__($s,$domain=null) {return htmlspecialchars($s,ENT_QUOTES);}
        function add_action(...$x) {} function add_filter(...$x) {global $filters; $filters[]=$x;} function plugin_basename($p) { return "live2d-show/live2d-show.php"; }
        function current_user_can($x) { global $allowed; return $allowed; }
        function wp_upload_dir(...$x) { return ['basedir'=>getenv('TEST_UPLOADS'),'baseurl'=>'https://example.invalid/uploads','error'=>false]; }
        function wp_mkdir_p($p) { return is_dir($p) || mkdir($p,0755,true); }
        function add_option($k,$v,...$x) { global $options; if (isset($options[$k])) return false; $options[$k]=$v; return true; }
        function get_option($k,$d=false) { global $options; return $options[$k] ?? $d; }
        function update_option($k,$v,...$x) { global $options,$write_fail; if ($write_fail) return false; $options[$k]=$v; return true; }
        function delete_option($k) { global $options; if (!array_key_exists($k,$options)) return false; unset($options[$k]); return true; }
        function wp_salt($scheme) {return 'synthetic-test-salt';}
        function wp_cache_delete(...$args) {}
        function wp_convert_hr_to_bytes($value) {return (int)$value * 1024 * 1024;}
        function maybe_unserialize($value) {return unserialize($value);}
        define('ARRAY_A', 'ARRAY_A');
        class TaskDatabase {
            public $options='stub_options'; public $last_error=''; public $reads=0;
            function prepare($sql,...$args) {return $sql;}
            function get_results(...$args) {
                global $options,$database_before_read;
                $this->reads++;
                if (isset($database_before_read)) $database_before_read($this->reads);
                $rows=[];
                foreach (['wzf_mascot_resources_v1','wzf_mascot_import_lock_v1'] as $key) if (array_key_exists($key,$options)) $rows[]=['option_name'=>$key,'option_value'=>serialize($options[$key])];
                return $rows;
            }
        }
        $wpdb=new TaskDatabase();
        function wp_die(...$x) { $GLOBALS['test_die_response']=$x[2]['response']??null; throw new RuntimeException('forbidden'); }
        function check_admin_referer($x) { if (!empty($GLOBALS['test_nonce_valid'])) return; throw new RuntimeException('nonce rejected'); }
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
        function is_admin(){return false;}function admin_url($p){return "/wp-admin/".$p;} function is_user_logged_in(){return false;}
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
        $again=wzf_mascot_action_links($admin);
        $admin_meta=wzf_mascot_row_meta($base,'live2d-show/live2d-show.php');
        $admin_unrelated=wzf_mascot_row_meta($base,'another-plugin/plugin.php');
        $allowed=false;
        $other=wzf_mascot_action_links($base);
        $own=wzf_mascot_row_meta($base,'live2d-show/live2d-show.php');
        $unrelated=wzf_mascot_row_meta($base,'another-plugin/plugin.php');
        echo json_encode(['admin'=>$admin,'again'=>$again,'admin_meta'=>$admin_meta,'admin_unrelated'=>$admin_unrelated,'hooks'=>array_column($filters,0),'other'=>$other,'own'=>$own,'unrelated'=>$unrelated]);""")
        self.assertEqual(len(report['admin']),2)
        self.assertIn('https://example.invalid/wp-admin/options-general.php?page=wzf-mascot',report['admin']['settings'])
        self.assertIn('Settings',report['admin']['settings'])
        self.assertEqual(report['again'],report['admin'])
        self.assertEqual(report['admin_meta']['settings'],report['admin']['settings'])
        self.assertEqual(len(report['admin_meta']),4)
        self.assertEqual(report['admin_unrelated'],['Existing'])
        self.assertIn('plugin_action_links_live2d-show/live2d-show.php',report['hooks'])
        self.assertIn('network_admin_plugin_action_links_live2d-show/live2d-show.php',report['hooks'])
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
        function is_admin(){return false;}function admin_url($p){return "/wp-admin/".$p;}function is_user_logged_in(){return false;}
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

    def settings_setup(self):
        path=json.dumps(str(self.fixture()))
        return """wzf_mascot_save_resource('model',"""+path+""",['id'=>'editable','name'=>'Example','credit'=>'Owner']);
        $u=wzf_mascot_uploads(); $c=$options[WZF_MASCOT_OPTION]['characters']['editable'];
        $model=json_decode(file_get_contents($u['path'].'/'.$c['root'].$c['file']),true);
        $model['FileReferences']['Motions']['Idle'][]=['File'=>'motion/greet.motion3.json'];
        file_put_contents($u['path'].'/'.$c['root'].'motion/greet.motion3.json','{"Version":3}');
        file_put_contents($u['path'].'/'.$c['root'].$c['file'],json_encode($model));
        file_put_contents($u['path'].'/'.$c['root'].'catalog.json',json_encode(['motions'=>[
          ['id'=>'custom_idle','file'=>'motion/idle.motion3.json','label'=>'Idle'],
          ['id'=>'01','file'=>'motion/greet.motion3.json','label'=>'Greeting']], 'expressions'=>[]]));
        $c['idle']='custom_idle';$c['offset']=8.5;$c['termsAnchor']='owner';$c['renderScale']=1.1;
        $options[WZF_MASCOT_OPTION]['characters']=['legacy_character'=>$c];
        $options[WZF_MASCOT_OPTION]['presentation']=['keep'=>'unchanged'];
        $before=$options[WZF_MASCOT_OPTION];$version=wzf_mascot_config_version($before);
        $fields=['name'=>'Edited','credit'=>'New owner','size'=>'200','offset'=>'6.5','idle'=>'custom_idle','welcome'=>'01','greetings'=>['01']];
        """

    def test_settings_edit_retains_paths_unknown_fields_and_legacy_ids(self):
        report=self.php(self.settings_setup()+"""
        $catalog_before=file_get_contents($u['path'].'/'.$c['root'].'catalog.json');
        wzf_mascot_save_character('legacy_character',$version,$fields);
        $after=get_option(WZF_MASCOT_OPTION);
        echo json_encode(['ok'=>true,'before'=>$before,'after'=>$after,
          'catalog_unchanged'=>$catalog_before===file_get_contents($u['path'].'/'.$c['root'].'catalog.json'),
          'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
        before=report['before']['characters']['legacy_character'];after=report['after']['characters']['legacy_character']
        self.assertEqual(after['name'],'Edited');self.assertEqual(after['offset'],6.5)
        self.assertEqual(after['welcome'],'01');self.assertEqual(after['greetings'],['01'])
        for key in ['root','file','termsAnchor','renderScale']:self.assertEqual(before[key],after[key])
        self.assertEqual(report['before']['presentation'],report['after']['presentation'])
        self.assertTrue(report['catalog_unchanged']);self.assertFalse(report['lock'])

    def test_settings_conflict_shared_lock_and_failed_write_preserve_config(self):
        for setup,expected in [("$options[WZF_MASCOT_OPTION]['changed']=true;",'Refresh'),
                               ("$options[WZF_MASCOT_LOCK]=['token'=>'other'];",'in progress'),
                               ('$write_fail=true;','Cannot save')]:
            with self.subTest(setup=setup):
                report=self.php(self.settings_setup()+setup+"""
                $snapshot=get_option(WZF_MASCOT_OPTION);$error='';
                try {wzf_mascot_save_character('legacy_character',$version,$fields);} catch(Throwable $e){$error=$e->getMessage();}
                echo json_encode(['ok'=>true,'error'=>$error,'unchanged'=>$snapshot===get_option(WZF_MASCOT_OPTION),'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
                self.assertIn(expected,report['error']);self.assertTrue(report['unchanged'])
                if 'other' in setup:self.assertEqual(report['lock']['token'],'other')
                else:self.assertFalse(report['lock'])

    def test_settings_invalid_fields_and_catalog_references_fail_closed(self):
        invalid=["$fields['idle']='unknown';", "$fields['welcome']='expression-1';",
                 "$fields['greetings']=['01','01'];", "$fields['greetings']=['missing'];",
                 "$fields['name']='<b>Injected</b>';", "$fields['offset']='INF';",
                 "$fields['size']='205';", "$fields['size']='270';", "$fields['offset']='101';",
                 "$fields['root']='other/';", "$fields['credit']=['bad'];",
                 "$fields['greetings']=['key'=>'01'];",
                 "unlink($u['path'].'/'.$c['root'].'motion/greet.motion3.json');",
                 "file_put_contents($u['path'].'/'.$c['root'].'catalog.json',json_encode(['motions'=>[['id'=>'custom_idle','file'=>'missing.motion3.json']]]));",
                 "unlink($u['path'].'/'.$c['root'].'motion/greet.motion3.json');symlink($u['path'].'/'.$c['root'].'motion/idle.motion3.json',$u['path'].'/'.$c['root'].'motion/greet.motion3.json');"]
        for change in invalid:
            with self.subTest(change=change):
                report=self.php(self.settings_setup()+change+"""
                $error='';try {wzf_mascot_save_character('legacy_character',$version,$fields);} catch(Throwable $e){$error=$e->getMessage();}
                echo json_encode(['ok'=>true,'error'=>$error,'unchanged'=>$before===get_option(WZF_MASCOT_OPTION),'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
                self.assertTrue(report['error']);self.assertTrue(report['unchanged']);self.assertFalse(report['lock'])

    def test_settings_maintained_extra_catalog_motion_and_greetings_order(self):
        report=self.php(self.settings_setup()+"""
        $catalog=json_decode(file_get_contents($u['path'].'/'.$c['root'].'catalog.json'),true);
        $catalog['motions'][]=['id'=>'legacy_extra','file'=>'motion/extra.motion3.json'];
        file_put_contents($u['path'].'/'.$c['root'].'motion/extra.motion3.json','{"Version":3}');
        file_put_contents($u['path'].'/'.$c['root'].'catalog.json',json_encode($catalog));
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['greetings']=['01','custom_idle'];
        $version=wzf_mascot_config_version(get_option(WZF_MASCOT_OPTION));
        $fields['welcome']='legacy_extra';$fields['greetings']=['custom_idle','legacy_extra','01'];
        wzf_mascot_save_character('legacy_character',$version,$fields);
        echo json_encode(['character'=>get_option(WZF_MASCOT_OPTION)['characters']['legacy_character']]);""")
        self.assertEqual(report['character']['welcome'],'legacy_extra')
        self.assertEqual(report['character']['greetings'],['01','custom_idle','legacy_extra'])

    def test_settings_disabled_welcome_greetings_and_noop(self):
        report=self.php(self.settings_setup()+"""
        $fields['welcome']='';$fields['greetings']=[];
        wzf_mascot_save_character('legacy_character',$version,$fields);
        $after=get_option(WZF_MASCOT_OPTION);$version=wzf_mascot_config_version($after);
        $write_fail=true;wzf_mascot_save_character('legacy_character',$version,$fields);
        echo json_encode(['ok'=>true,'character'=>$after['characters']['legacy_character'],'unchanged'=>$after===get_option(WZF_MASCOT_OPTION),'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
        self.assertIsNone(report['character']['welcome']);self.assertEqual(report['character']['greetings'],[])
        self.assertTrue(report['unchanged']);self.assertFalse(report['lock'])

    def test_settings_permission_and_nonce_before_changes(self):
        self.assertEqual(self.php('$allowed=false; wzf_mascot_settings_post();')['error'],'forbidden')
        self.assertEqual(self.php('wzf_mascot_settings_post();')['error'],'nonce rejected')
        report=self.php(self.settings_setup()+"""$allowed=false;
        $error='';try{wzf_mascot_save_character('legacy_character',$version,$fields);}catch(Throwable $e){$error=$e->getMessage();}
        echo json_encode(['error'=>$error,'unchanged'=>$before===get_option(WZF_MASCOT_OPTION),'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
        self.assertIn('Administrator',report['error']);self.assertTrue(report['unchanged']);self.assertFalse(report['lock'])

    def test_admin_and_profile_render_are_scoped_escaped_and_readonly(self):
        report=self.php(self.settings_setup()+"""
        function admin_url($s){return '/wp-admin/'.$s;}
        function wp_json_encode($value,$flags=0){return json_encode($value,$flags);}
        function esc_url($s){return htmlspecialchars($s,ENT_QUOTES);}
        function esc_attr($s){return htmlspecialchars((string)$s,ENT_QUOTES);}
        function esc_html($s){return htmlspecialchars((string)$s,ENT_QUOTES);}
        function esc_textarea($s){return htmlspecialchars((string)$s,ENT_QUOTES);}
        function wp_unslash($s){return $s;}
        function add_query_arg($k,$v,$s=null){return is_array($k)?$v.'?'.http_build_query($k):$s.'&'.$k.'='.urlencode($v);}
        function wp_nonce_field(...$x){echo '<input type="hidden" name="nonce" value="stub">';}
        function wp_create_nonce($action){return 'synthetic-preview-nonce';}
        function submit_button($s){echo '<button>'.$s.'</button>';}
        function selected($a,$b,$echo){return $a===$b?'selected':'';}
        function checked($a,$b,$echo){return $a===$b?'checked':'';}
        function metadata_exists(...$x){return false;}
        require dirname(getenv('TEST_MODULE'),2).'/live2d-show.php';
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['credit']='<script>alert(1)</script>';
        $snapshot=get_option(WZF_MASCOT_OPTION);$_GET['character']='legacy_character';
        ob_start();wzf_mascot_admin_page();$admin=ob_get_clean();
        ob_start();wzf_haru_profile((object)['ID'=>1]);$profile=ob_get_clean();
        echo json_encode(['admin'=>$admin,'profile'=>$profile,'unchanged'=>$snapshot===get_option(WZF_MASCOT_OPTION),'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
        self.assertTrue(report['unchanged']);self.assertFalse(report['lock'])
        self.assertNotIn('<script>',report['admin']);self.assertIn('&lt;script&gt;',report['admin'])
        self.assertIn('name="version"',report['admin']);self.assertIn('value="01"',report['admin'])
        self.assertIn('value="8.5"',report['admin']);self.assertIn('wzf-mascot-admin',report['admin'])
        self.assertIn('wzf-mascot-profile',report['profile']);self.assertIn('name="live2d_front"',report['profile'])

    def replacement_fixture(self, incompatible=False):
        def change(files):
            refs=files['Model.model3.json']['FileReferences']
            if incompatible:
                refs['Motions']={'Idle':[{'File':'motion/new.motion3.json'}]}
                files['motion/new.motion3.json']={'Version':3}
            else:
                refs['Motions']={'Idle':[{'File':'motion/greet.motion3.json'},{'File':'motion/idle.motion3.json'}]}
                files['motion/greet.motion3.json']={'Version':3}
        return json.dumps(str(self.fixture(change)))

    def test_replacement_maps_files_and_resource_rollback_preserves_new_settings(self):
        replacement=self.replacement_fixture()
        report=self.php(self.settings_setup()+"""
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['welcome']='01';
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['greetings']=['01','custom_idle'];
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['status']='disabled';
        $original=get_option(WZF_MASCOT_OPTION)['characters']['legacy_character'];
        wzf_mascot_replace_resource("""+replacement+""",'legacy_character',wzf_mascot_config_version(get_option(WZF_MASCOT_OPTION)));
        $updated=get_option(WZF_MASCOT_OPTION)['characters']['legacy_character'];
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['name']='New display name';
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['size']=220;
        wzf_mascot_manage_character('legacy_character',wzf_mascot_config_version(get_option(WZF_MASCOT_OPTION)),'rollback');
        $rolled=get_option(WZF_MASCOT_OPTION)['characters']['legacy_character'];
        wzf_mascot_manage_character('legacy_character',wzf_mascot_config_version(get_option(WZF_MASCOT_OPTION)),'rollback');
        echo json_encode(['original'=>$original,'updated'=>$updated,'rolled'=>$rolled,'again'=>get_option(WZF_MASCOT_OPTION)['characters']['legacy_character'],
          'old_file'=>is_file($u['path'].'/'.$original['root'].$original['file']),'new_file'=>is_file($u['path'].'/'.$updated['root'].$updated['file']),'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
        self.assertNotEqual(report['original']['root'],report['updated']['root'])
        self.assertEqual(report['updated']['idle'],'motion-2');self.assertEqual(report['updated']['welcome'],'motion-1')
        self.assertEqual(report['updated']['greetings'],['motion-1','motion-2'])
        for key in ['name','credit','offset','size','renderScale','termsAnchor','status']:
            self.assertEqual(report['original'][key],report['updated'][key])
        self.assertEqual(report['rolled']['root'],report['original']['root'])
        self.assertEqual(report['rolled']['name'],'New display name');self.assertEqual(report['rolled']['size'],220)
        self.assertEqual(report['rolled']['status'],'disabled');self.assertEqual(report['again']['root'],report['updated']['root'])
        self.assertTrue(report['old_file']);self.assertTrue(report['new_file']);self.assertFalse(report['lock'])

    def test_replacement_incompatible_requires_explicit_reset(self):
        replacement=self.replacement_fixture(True)
        report=self.php(self.settings_setup()+"""
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['welcome']='01';
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['greetings']=['01'];
        $before=get_option(WZF_MASCOT_OPTION);$version=wzf_mascot_config_version($before);
        $error='';try {wzf_mascot_replace_resource("""+replacement+""",'legacy_character',$version);}catch(Throwable $e){$error=$e->getMessage();}
        $unchanged=$before===get_option(WZF_MASCOT_OPTION);
        wzf_mascot_replace_resource("""+replacement+""",'legacy_character',$version,true);
        echo json_encode(['error'=>$error,'unchanged'=>$unchanged,'after'=>get_option(WZF_MASCOT_OPTION)['characters']['legacy_character']]);""")
        self.assertIn('Allow incompatible motion reset',report['error']);self.assertTrue(report['unchanged'])
        self.assertEqual(report['after']['idle'],'motion-1');self.assertIsNone(report['after']['welcome'])
        self.assertEqual(report['after']['greetings'],[])
        self.assertEqual(len(list((self.root/'uploads/wzf-mascot').glob('model-*'))),2)

    def test_management_lifecycle_and_rollback_in_trash_preserve_files(self):
        replacement=self.replacement_fixture()
        report=self.php(self.settings_setup()+"""
        wzf_mascot_replace_resource("""+replacement+""",'legacy_character',$version);
        $statuses=[];
        foreach(['disable','trash','rollback','restore','enable'] as $operation){
          wzf_mascot_manage_character('legacy_character',wzf_mascot_config_version(get_option(WZF_MASCOT_OPTION)),$operation);
          $statuses[]=wzf_mascot_character_status(get_option(WZF_MASCOT_OPTION)['characters']['legacy_character']);
        }
        echo json_encode(['statuses'=>$statuses,'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
        self.assertEqual(report['statuses'],['disabled','trash','trash','disabled','active']);self.assertFalse(report['lock'])
        self.assertEqual(len(list((self.root/'uploads/wzf-mascot').glob('model-*'))),2)

    def test_rollback_missing_moc_or_texture_preserves_option_and_history(self):
        replacement=self.replacement_fixture()
        for missing in ['Model.moc3','textures/a.png']:
            with self.subTest(missing=missing):
                report=self.php(self.settings_setup()+"""
                wzf_mascot_replace_resource("""+replacement+""",'legacy_character',$version);
                $snapshot=get_option(WZF_MASCOT_OPTION);
                unlink($u['path'].'/'.$c['root'].'"""+missing+"""');
                $error='';try {wzf_mascot_manage_character('legacy_character',wzf_mascot_config_version($snapshot),'rollback');}catch(Throwable $e){$error=$e->getMessage();}
                echo json_encode(['error'=>$error,'unchanged'=>$snapshot===get_option(WZF_MASCOT_OPTION),'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
                self.assertIn('runtime reference',report['error']);self.assertTrue(report['unchanged']);self.assertFalse(report['lock'])

    def test_management_conflict_lock_write_failure_permission_and_nonce(self):
        for change,operation in [("$options[WZF_MASCOT_OPTION]['changed']=true;",'disable'),
                                 ("$options[WZF_MASCOT_LOCK]=['token'=>'other'];",'trash'),
                                 ('$write_fail=true;','disable'),('$allowed=false;','disable'),('', 'restore'),('', 'permanent-delete')]:
            with self.subTest(change=change,operation=operation):
                report=self.php(self.settings_setup()+change+"""
                $snapshot=get_option(WZF_MASCOT_OPTION);$error='';
                try{wzf_mascot_manage_character('legacy_character',$version,'"""+operation+"""');}catch(Throwable $e){$error=$e->getMessage();}
                echo json_encode(['error'=>$error,'unchanged'=>$snapshot===get_option(WZF_MASCOT_OPTION),'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
                self.assertTrue(report['error']);self.assertTrue(report['unchanged'])
                if 'other' in change:self.assertEqual(report['lock']['token'],'other')
                else:self.assertFalse(report['lock'])
        self.assertEqual(self.php('wzf_mascot_manage_post();')['error'],'nonce rejected')
        self.assertEqual(self.php('$allowed=false;wzf_mascot_manage_post();')['error'],'forbidden')

    def test_replacement_write_failure_and_conflict_clean_candidate(self):
        replacement=self.replacement_fixture()
        for change in ['$write_fail=true;',"$options[WZF_MASCOT_OPTION]['changed']=true;", "$options[WZF_MASCOT_LOCK]=['token'=>'other'];"]:
            with self.subTest(change=change):
                report=self.php(self.settings_setup()+change+"""
                $snapshot=get_option(WZF_MASCOT_OPTION);$error='';
                try{wzf_mascot_replace_resource("""+replacement+""",'legacy_character',$version);}catch(Throwable $e){$error=$e->getMessage();}
                echo json_encode(['error'=>$error,'unchanged'=>$snapshot===get_option(WZF_MASCOT_OPTION)]);""")
                self.assertTrue(report['error']);self.assertTrue(report['unchanged'])
        self.assertFalse(list((self.root/'uploads/wzf-mascot').glob('stage-*')))
        self.assertEqual(len(list((self.root/'uploads/wzf-mascot').glob('model-*'))),3)

    def test_frontend_filters_disabled_trash_and_management_metadata(self):
        report=self.php(self.settings_setup()+"""
        mkdir($u['path'].'/core-test');file_put_contents($u['path'].'/core-test/core.js','stub');
        $options[WZF_MASCOT_OPTION]['core']=['path'=>'core-test/core.js','sha256'=>WZF_MASCOT_CORE_SHA];
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['status']='active';
        $options[WZF_MASCOT_OPTION]['characters']['disabled']=$c;$options[WZF_MASCOT_OPTION]['characters']['disabled']['status']='disabled';
        $options[WZF_MASCOT_OPTION]['characters']['trash']=$c;$options[WZF_MASCOT_OPTION]['characters']['trash']['status']='trash';
        $options[WZF_MASCOT_OPTION]['history']=['private-history'=>$c];unset($options[WZF_MASCOT_OPTION]['presentation']);
        function is_admin(){return false;}function admin_url($p){return "/wp-admin/".$p;}function is_user_logged_in(){return false;}
        function plugins_url(...$args){return '/plugins/live2d-show';}
        function esc_url($s){return htmlspecialchars($s,ENT_QUOTES);}
        function wp_json_encode($s,$f){return json_encode($s,$f);}
        require dirname(getenv('TEST_MODULE'),2).'/live2d-show.php';
        ob_start();wzf_haru_output();$html=ob_get_clean();
        preg_match('~<script id="wzf-live2d-config"[^>]*>(.*?)</script>~s',$html,$match);
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['status']='disabled';
        ob_start();wzf_haru_output();$empty=ob_get_clean();
        echo json_encode(['config'=>json_decode($match[1],true),'empty'=>$empty]);""")
        self.assertEqual(set(report['config']['characters']),{'legacy_character'})
        self.assertNotIn('status',report['config']['characters']['legacy_character'])
        self.assertNotIn('history',report['config']);self.assertEqual(report['empty'],'')

    def test_administrator_diagnostics_are_readonly_and_report_resource_categories(self):
        report=self.php(self.settings_setup()+"""
        require dirname(getenv('TEST_MODULE'),2).'/live2d-show.php';
        unset($options[WZF_MASCOT_OPTION]['presentation']);
        mkdir($u['path'].'/core-test');file_put_contents($u['path'].'/core-test/core.js','invalid core');
        $options[WZF_MASCOT_OPTION]['core']=['path'=>'core-test/core.js','sha256'=>WZF_MASCOT_CORE_SHA];
        $before=get_option(WZF_MASCOT_OPTION);
        $good=wzf_mascot_diagnose_resources($before);
        unlink($u['path'].'/'.$c['root'].'Model.moc3');
        $missing=wzf_mascot_diagnose_resources($before);
        $allowed=false;$error='';try{wzf_mascot_diagnose_resources($before);}catch(Throwable $e){$error=$e->getMessage();}
        echo json_encode(['good'=>$good,'missing'=>$missing,'error'=>$error,'unchanged'=>$before===get_option(WZF_MASCOT_OPTION),'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
        self.assertFalse(report['good']['core']['ok']);self.assertIn('SHA256',report['good']['core']['message'])
        self.assertTrue(report['good']['characters'][0]['checks']['runtime']['ok'])
        self.assertTrue(report['good']['characters'][0]['checks']['catalog']['ok'])
        self.assertFalse(report['missing']['characters'][0]['checks']['runtime']['ok'])
        self.assertTrue(report['missing']['characters'][0]['checks']['catalog']['ok'])
        self.assertTrue(report['good']['presentation']['ok']);self.assertIn('Administrator',report['error'])
        self.assertTrue(report['unchanged']);self.assertFalse(report['lock'])
        self.assertNotIn(str(self.root),json.dumps(report));self.assertNotIn('https://',json.dumps(report))

    def thumbnail_fixture(self, width=32, height=16, metadata=False):
        self.counter+=1
        path=self.root/f'thumbnail-{self.counter}.png'
        def chunk(kind,data):
            return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
        image=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))
        if metadata:image+=chunk(b'tEXt',b'Comment\x00private-test-metadata-marker')
        image+=chunk(b'IDAT',zlib.compress((b'\x00'+b'\x10\x80\xc0'*width)*height))+chunk(b'IEND',b'')
        if metadata:image+=b'<?php malicious-test-trailer ?>'
        path.write_bytes(image)
        return json.dumps(str(path))

    def test_thumbnail_reencodes_pixels_removes_metadata_and_is_independent_of_model(self):
        image=self.thumbnail_fixture(1024,512,True)
        replacement=self.replacement_fixture()
        report=self.php(self.settings_setup()+"""
        wzf_mascot_save_thumbnail('legacy_character',$version,"""+image+""");
        $with_thumbnail=get_option(WZF_MASCOT_OPTION);$thumbnail=$with_thumbnail['characters']['legacy_character']['thumbnail'];
        $bytes=file_get_contents($u['path'].'/'.$thumbnail);
        wzf_mascot_replace_resource("""+replacement+""",'legacy_character',wzf_mascot_config_version(get_option(WZF_MASCOT_OPTION)));
        $updated=get_option(WZF_MASCOT_OPTION)['characters']['legacy_character']['thumbnail'];
        wzf_mascot_manage_character('legacy_character',wzf_mascot_config_version(get_option(WZF_MASCOT_OPTION)),'rollback');
        $rolled=get_option(WZF_MASCOT_OPTION)['characters']['legacy_character']['thumbnail'];
        $url=wzf_mascot_thumbnail_url(get_option(WZF_MASCOT_OPTION)['characters']['legacy_character']);
        wzf_mascot_save_thumbnail('legacy_character',wzf_mascot_config_version(get_option(WZF_MASCOT_OPTION)));
        echo json_encode(['thumbnail'=>$thumbnail,'updated'=>$updated,'rolled'=>$rolled,'url'=>$url,'info'=>getimagesizefromstring($bytes),
          'clean'=>!str_contains($bytes,'private-test-metadata-marker')&&!str_contains($bytes,'malicious-test-trailer'),
          'removed'=>!isset(get_option(WZF_MASCOT_OPTION)['characters']['legacy_character']['thumbnail']),
          'retained'=>is_file($u['path'].'/'.$thumbnail),'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
        self.assertRegex(report['thumbnail'],r'^thumbnail-[0-9a-f]{32}/image\.png$')
        self.assertEqual(report['updated'],report['thumbnail']);self.assertEqual(report['rolled'],report['thumbnail'])
        self.assertEqual(report['info']['0'],512);self.assertEqual(report['info']['1'],256)
        self.assertTrue(report['clean']);self.assertTrue(report['removed']);self.assertTrue(report['retained']);self.assertFalse(report['lock'])
        self.assertTrue(report['url'].endswith(report['thumbnail']))

    def test_mobile_defaults_noop_and_explicit_change_preserve_existing_config(self):
        report=self.php(self.settings_setup()+"""
        $before=$options[WZF_MASCOT_OPTION];$version=wzf_mascot_config_version($before);
        wzf_mascot_save_mobile($version,false,true);$noop=$options[WZF_MASCOT_OPTION];
        wzf_mascot_save_mobile($version,true,false);$changed=$options[WZF_MASCOT_OPTION];
        echo json_encode(['noop'=>$noop===$before,'enabled'=>$changed['mobileEnabled'],'pause'=>$changed['mobilePauseOnInput'],'character'=>$changed['characters']===$before['characters'],'lock'=>isset($options[WZF_MASCOT_LOCK])]);
        """)
        self.assertEqual(report,{'noop':True,'enabled':True,'pause':False,'character':True,'lock':False})

    def test_mobile_conflict_lock_permission_and_nonce_are_enforced(self):
        for mode in ['conflict','lock','write','permission']:
            report=self.php(self.settings_setup()+"""
            $before=$options[WZF_MASCOT_OPTION];$version=wzf_mascot_config_version($before);
            """+{'conflict':"$version=str_repeat('0',64);",'lock':"$options[WZF_MASCOT_LOCK]=['token'=>'owner'];",'write':"$write_fail=true;",'permission':"$allowed=false;"}[mode]+"""
            try{wzf_mascot_save_mobile($version,true,true);}catch(Throwable $e){$error=$e->getMessage();}
            echo json_encode(['error'=>isset($error),'unchanged'=>$before===$options[WZF_MASCOT_OPTION],'lock'=>$options[WZF_MASCOT_LOCK]??null]);
            """)
            self.assertTrue(report['error']);self.assertTrue(report['unchanged'])
            self.assertEqual(report['lock'],{'token':'owner'} if mode=='lock' else None)
        self.assertEqual(self.php('wzf_mascot_mobile_post();')['error'],'nonce rejected')
        self.assertEqual(self.php('$allowed=false;wzf_mascot_mobile_post();')['error'],'forbidden')

    def test_thumbnail_real_jpeg_and_webp_are_reencoded_to_png(self):
        report=self.php("""
        $image=imagecreatetruecolor(32,16);$files=[];
        foreach(['jpeg','webp'] as $type){
          $file=getenv('TEST_UPLOADS').'-'.$type;
          $fn='image'.$type;$fn($image,$file);
          $bytes=wzf_mascot_thumbnail_bytes($file);$files[$type]=getimagesizefromstring($bytes)[2];
        }
        echo json_encode(['types'=>$files]);""")
        self.assertEqual(report['types'],{'jpeg':3,'webp':3})

    def test_thumbnail_invalid_svg_large_geometry_urls_and_symlinks_are_rejected(self):
        svg=self.root/'bad.svg';svg.write_text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
        huge=self.root/'large.png'
        with huge.open('wb') as stream:stream.truncate(4*1024*1024+1)
        good=json.loads(self.thumbnail_fixture())
        link=self.root/'link.png';link.symlink_to(good)
        cases=[json.dumps(str(svg)),json.dumps(str(huge)),self.thumbnail_fixture(2049,1),json.dumps(str(link)),json.dumps('https://external.invalid/a.png')]
        for image in cases:
            with self.subTest(image=image):
                self.assertFalse(self.php('wzf_mascot_thumbnail_bytes('+image+');echo json_encode(["ok"=>true]);')['ok'])

    def test_thumbnail_conflict_lock_and_failed_write_cleanup_without_option_changes(self):
        image=self.thumbnail_fixture()
        for change in ['$write_fail=true;',"$options[WZF_MASCOT_OPTION]['changed']=true;", "$options[WZF_MASCOT_LOCK]=['token'=>'other'];"]:
            with self.subTest(change=change):
                report=self.php(self.settings_setup()+change+"""
                $snapshot=get_option(WZF_MASCOT_OPTION);$error='';
                try{wzf_mascot_save_thumbnail('legacy_character',$version,"""+image+""");}catch(Throwable $e){$error=$e->getMessage();}
                echo json_encode(['error'=>$error,'unchanged'=>$snapshot===get_option(WZF_MASCOT_OPTION),'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
                self.assertTrue(report['error']);self.assertTrue(report['unchanged'])
                if 'other' in change:self.assertEqual(report['lock']['token'],'other')
                else:self.assertFalse(report['lock'])
        self.assertFalse(list((self.root/'uploads/wzf-mascot').glob('thumbnail-*')))
        self.assertFalse(list((self.root/'uploads/wzf-mascot').glob('stage-thumbnail-*')))

    def test_thumbnail_clear_failed_write_and_invalid_reference_are_safe(self):
        image=self.thumbnail_fixture()
        report=self.php(self.settings_setup()+"""
        wzf_mascot_save_thumbnail('legacy_character',$version,"""+image+""");
        $snapshot=get_option(WZF_MASCOT_OPTION);$write_fail=true;$error='';
        try{wzf_mascot_save_thumbnail('legacy_character',wzf_mascot_config_version($snapshot));}catch(Throwable $e){$error=$e->getMessage();}
        $bad=[];foreach(['https://external.invalid/a.png','../outside.png','model-root/a.png'] as $path){$bad[]=wzf_mascot_thumbnail_url(['thumbnail'=>$path]);}
        echo json_encode(['error'=>$error,'unchanged'=>$snapshot===get_option(WZF_MASCOT_OPTION),'bad'=>$bad,'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
        self.assertTrue(report['error']);self.assertTrue(report['unchanged']);self.assertEqual(report['bad'],[None,None,None]);self.assertFalse(report['lock'])
        self.assertEqual(self.php('wzf_mascot_thumbnail_post();')['error'],'nonce rejected')
        self.assertEqual(self.php('$allowed=false;wzf_mascot_thumbnail_post();')['error'],'forbidden')

    def test_diagnostic_nonce_gate_runs_without_rendering(self):
        report=self.php("$_GET['page']='wzf-mascot';$_POST['mascot_diagnostics']='1';wzf_mascot_diagnostics_gate();")
        self.assertEqual(report['error'],'nonce rejected')
        report=self.php("$allowed=false;$_GET['page']='wzf-mascot';$_POST['mascot_diagnostics']='1';wzf_mascot_diagnostics_gate();")
        self.assertEqual(report['error'],'forbidden')
        report=self.php("$_GET['page']='wzf-mascot';wzf_mascot_diagnostics_gate();echo json_encode(['ok'=>true,'option'=>get_option(WZF_MASCOT_OPTION)]);")
        self.assertTrue(report['ok']);self.assertFalse(report['option'])

    def test_profile_save_preserves_permission_nonce_and_checkbox_semantics(self):
        report=self.php("""
        require dirname(getenv('TEST_MODULE'),2).'/live2d-show.php';
        $writes=[];$nonce_good=true;
        function wp_unslash($s){return $s;}
        function wp_verify_nonce(...$x){global $nonce_good;return $nonce_good;}
        function update_user_meta($id,$key,$value){global $writes;$writes[]=[$id,$key,$value];}
        $_POST=['wzf_haru_nonce'=>'valid','live2d_front'=>'1'];
        $allowed=false;wzf_haru_profile_save(7);
        $allowed=true;$nonce_good=false;wzf_haru_profile_save(7);
        $nonce_good=true;$_POST['wzf_haru_nonce']=['bad'];wzf_haru_profile_save(7);
        $_POST['wzf_haru_nonce']='valid';wzf_haru_profile_save(7);
        unset($_POST['live2d_front']);wzf_haru_profile_save(7);
        echo json_encode(['writes'=>$writes]);""")
        self.assertEqual(report['writes'],[[7,'show_live2d_front','true'],[7,'show_live2d_front','false']])

    def test_frontend_isolates_bad_roles_without_repair_or_full_resource_scan(self):
        body = self.settings_setup() + """
        unset($options[WZF_MASCOT_OPTION]['presentation']);
        mkdir($u['path'].'/core-test');file_put_contents($u['path'].'/core-test/core.js','stub');
        $options[WZF_MASCOT_OPTION]['core']=['path'=>'core-test/core.js','sha256'=>WZF_MASCOT_CORE_SHA];
        $options[WZF_MASCOT_OPTION]['characters'][23]=$c;
        $bad=[['root'=>[]],['root'=>'missing/'],['root'=>'../escape/'],['file'=>'https://example.invalid/model.model3.json'],['file'=>'missing.model3.json'],['name'=>[]],['status'=>[]],['size'=>[]],['offset'=>false],['idle'=>[]],['welcome'=>[]],['greetings'=>'bad']];
        foreach($bad as $i=>$patch) $options[WZF_MASCOT_OPTION]['characters']['bad-'.$i]=array_replace($c,$patch);
        $options[WZF_MASCOT_OPTION]['characters']['non-array']='invalid';
        symlink($u['path'].'/'.$c['root'],$u['path'].'/linked');
        $options[WZF_MASCOT_OPTION]['characters']['linked']=array_replace($c,['root'=>'linked/']);
        // Missing texture/moc or broken model body belongs to explicit full
        // diagnosis/browser loading, not the front-page entry metadata gate.
        unlink($u['path'].'/'.$c['root'].'Model.moc3');
        file_put_contents($u['path'].'/'.$c['root'].$c['file'],'synthetic broken body');
        function is_admin(){return false;}function admin_url($p){return "/wp-admin/".$p;}function is_user_logged_in(){return false;}
        function plugins_url(...$args){return '/plugins/live2d-show';}
        function esc_url($s){return htmlspecialchars($s,ENT_QUOTES);}
        function wp_json_encode($s,$f){return json_encode($s,$f);}
        require dirname(getenv('TEST_MODULE'),2).'/live2d-show.php';
        $before=get_option(WZF_MASCOT_OPTION);ob_start();wzf_haru_output();$html=ob_get_clean();
        preg_match('~<script id="wzf-live2d-config"[^>]*>(.*?)</script>~s',$html,$match);
        $report=wzf_mascot_display_report($before);
        echo json_encode(['config'=>json_decode($match[1],true),'report'=>$report,'unchanged'=>$before===get_option(WZF_MASCOT_OPTION),'lock'=>get_option(WZF_MASCOT_LOCK)]);"""
        report = self.php(body)
        self.assertEqual(set(report['config']['characters']), {'legacy_character', '23'})
        self.assertEqual(report['config']['characters']['legacy_character']['renderScale'], 1.1)
        self.assertEqual(report['config']['characters']['legacy_character']['idle'], 'custom_idle')
        self.assertEqual(sum(row['ok'] for row in report['report']), 2)
        self.assertTrue(report['unchanged']); self.assertFalse(report['lock'])
        self.assertNotIn(str(self.root), json.dumps(report))

    def test_full_diagnostic_matches_display_gate_for_optional_layout_and_terms_types(self):
        for key in ['renderScale', 'termsAnchor']:
            with self.subTest(key=key):
                report = self.php(self.settings_setup() + """
                require dirname(getenv('TEST_MODULE'),2).'/live2d-show.php';
                unset($options[WZF_MASCOT_OPTION]['presentation']);
                $options[WZF_MASCOT_OPTION]['characters']['legacy_character'][""" + json.dumps(key) + """]=[];
                $before=get_option(WZF_MASCOT_OPTION);
                echo json_encode(['full'=>wzf_mascot_diagnose_resources($before),'light'=>wzf_mascot_display_report($before),'unchanged'=>$before===get_option(WZF_MASCOT_OPTION)]);""")
                self.assertFalse(report['light'][0]['ok'])
                self.assertFalse(report['full']['characters'][0]['checks']['catalog']['ok'])
                self.assertTrue(report['unchanged'])

    def test_missing_or_invalid_shared_asset_manifest_emits_no_markup_or_path_warning(self):
        # Copy only the entry file; reuse the already loaded importer via its
        # test environment path, so no installed/plugin files are changed.
        entry = self.root / 'live2d-show.php'
        entry.write_text((ROOT / 'plugin/live2d-show.php').read_text().replace(
            "require_once __DIR__ . '/includes/admin-import.php';",
            "require_once getenv('TEST_MODULE');"))
        report = self.php(self.settings_setup() + """
        unset($options[WZF_MASCOT_OPTION]['presentation']);
        mkdir($u['path'].'/core-test');file_put_contents($u['path'].'/core-test/core.js','stub');
        $options[WZF_MASCOT_OPTION]['core']=['path'=>'core-test/core.js','sha256'=>WZF_MASCOT_CORE_SHA];
        function is_admin(){return false;}function admin_url($p){return "/wp-admin/".$p;}function is_user_logged_in(){return false;}
        require """ + json.dumps(str(entry)) + """;
        $before=get_option(WZF_MASCOT_OPTION);$outputs=[];
        ob_start();wzf_haru_output();$outputs[]=ob_get_clean();
        $manifest=dirname(""" + json.dumps(str(entry)) + """).'/haru-assets.json';
        foreach (['broken-json', '{"engine":[],"loader":"loader.js","css":"style.css","shaders":"shaders/","terms":"terms.html"}'] as $raw) {
            file_put_contents($manifest,$raw);ob_start();wzf_haru_output();$outputs[]=ob_get_clean();
        }
        echo json_encode(['outputs'=>$outputs,'unchanged'=>$before===get_option(WZF_MASCOT_OPTION)]);""")
        self.assertEqual(report['outputs'], ['', '', ''])
        self.assertTrue(report['unchanged'])

    def test_frontend_unreadable_entry_and_catalog_and_shared_failures(self):
        for failure in ['unreadable-model', 'missing-catalog', 'linked-model', 'all-bad', 'core-type', 'core-unreadable', 'terms']:
            with self.subTest(failure=failure):
                report = self.php(self.settings_setup() + """
                unset($options[WZF_MASCOT_OPTION]['presentation']);
                if(!is_dir($u['path'].'/core-test'))mkdir($u['path'].'/core-test');file_put_contents($u['path'].'/core-test/core.js','stub');
                $options[WZF_MASCOT_OPTION]['core']=['path'=>'core-test/core.js','sha256'=>WZF_MASCOT_CORE_SHA];
                $file=$u['path'].'/'.$c['root'].$c['file'];
                """ + {
                    'unreadable-model': 'chmod($file,0000);',
                    'missing-catalog': "unlink($u['path'].'/'.$c['root'].'catalog.json');",
                    'linked-model': "rename($file,$file.'.bak');symlink($file.'.bak',$file);",
                    'all-bad': "$options[WZF_MASCOT_OPTION]['characters']=['invalid'=>false];",
                    'core-type': "$options[WZF_MASCOT_OPTION]['core']='broken';",
                    'core-unreadable': "chmod($u['path'].'/core-test/core.js',0000);",
                    'terms': "$options[WZF_MASCOT_OPTION]['presentation']=['terms'=>'../escape.html'];",
                }[failure] + """
                function is_admin(){return false;}function admin_url($p){return "/wp-admin/".$p;}function is_user_logged_in(){return false;}
                require dirname(getenv('TEST_MODULE'),2).'/live2d-show.php';
                $before=get_option(WZF_MASCOT_OPTION);ob_start();wzf_haru_output();$html=ob_get_clean();
                chmod($file,0644);chmod($u['path'].'/core-test/core.js',0644);
                echo json_encode(['html'=>$html,'unchanged'=>$before===get_option(WZF_MASCOT_OPTION)]);""")
                self.assertEqual(report['html'], '')
                self.assertTrue(report['unchanged'])

    def test_zero_resources_frontend_empty(self):
        env=dict(os.environ,TEST_ENTRY=str(ROOT/'plugin/live2d-show.php'))
        code='define("ABSPATH","/stub/"); function add_action(...$x) {} function add_filter(...$x) {global $filters; $filters[]=$x;} function plugin_basename($p) { return "live2d-show/live2d-show.php"; } function is_admin(){return false;}function admin_url($p){return "/wp-admin/".$p;} function is_user_logged_in(){return false;} function get_option($k,$d){return $d;} require getenv("TEST_ENTRY"); wzf_haru_output();'
        result=subprocess.run(['php','-r',code],env=env,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout,'');self.assertEqual(result.stderr,'')


if __name__ == '__main__': unittest.main()
