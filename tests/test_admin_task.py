"""Task guard/recovery security regressions with synthetic storage and WP stubs."""
import json
from pathlib import Path
import unittest
import test_importer


class AdminTaskTests(unittest.TestCase):
    def setUp(self):
        self.helper = test_importer.ImporterTests()
        self.helper.setUp()

    def tearDown(self): self.helper.tearDown()
    def php(self, body): return self.helper.php(body)

    def abandoned(self):
        return """$options[WZF_MASCOT_OPTION]=['characters'=>[], 'retained'=>'original'];
        $task=wzf_mascot_task_begin('settings');
        flock($task['handle'],LOCK_UN);fclose($task['handle']);
        $record=$options[WZF_MASCOT_LOCK];$before=$options[WZF_MASCOT_OPTION];
        $fingerprint=wzf_mascot_task_fingerprint($record);$version=wzf_mascot_config_version($before);
        """

    def test_idle_status_is_read_only_and_does_not_create_guard(self):
        result = self.php("$before=$options;$state=wzf_mascot_task_status();echo json_encode(['state'=>$state,'unchanged'=>$before===$options,'created'=>file_exists(getenv('TEST_UPLOADS'))]);")
        self.assertEqual(result['state']['status'], 'idle')
        self.assertFalse(result['created']); self.assertTrue(result['unchanged'])

    def test_crash_recovery_retains_config_files_and_guard_inode(self):
        result = self.php(self.abandoned() + """
        $u=wzf_mascot_uploads();mkdir($u['path'].'/stage-retained');file_put_contents($u['path'].'/stage-retained/data','original');
        $state=wzf_mascot_task_status();$inode=fileinode($u['path'].'/'.WZF_MASCOT_GUARD_FILE);
        wzf_mascot_task_recover($fingerprint,$version,'1');
        echo json_encode(['state'=>$state,'after'=>wzf_mascot_task_status(),'lock'=>get_option(WZF_MASCOT_LOCK),'unchanged'=>$before===$options[WZF_MASCOT_OPTION], 'data'=>file_get_contents($u['path'].'/stage-retained/data'),'inode'=>$inode===fileinode($u['path'].'/'.WZF_MASCOT_GUARD_FILE)]);
        """)
        self.assertEqual(result['state']['status'], 'interrupted')
        self.assertNotIn('token', result['state']); self.assertEqual(result['after']['status'], 'idle')
        self.assertFalse(result['lock']); self.assertTrue(result['unchanged']); self.assertTrue(result['inode'])
        self.assertEqual(result['data'], 'original')

    def test_running_lock_cannot_be_recovered_regardless_of_age(self):
        result = self.php("""$task=wzf_mascot_task_begin('mobile');$record=$options[WZF_MASCOT_LOCK];
        $options[WZF_MASCOT_LOCK]['started']=1;$fingerprint=wzf_mascot_task_fingerprint($options[WZF_MASCOT_LOCK]);
        $state=wzf_mascot_task_status();
        try {wzf_mascot_task_recover($fingerprint,wzf_mascot_config_version($task['config']),'1');}catch(Throwable $e){$error=$e->getMessage();}
        echo json_encode(['state'=>$state,'error'=>$error,'retained'=>isset($options[WZF_MASCOT_LOCK])]);
        flock($task['handle'],LOCK_UN);fclose($task['handle']);""")
        self.assertEqual(result['state']['status'], 'running'); self.assertIn('still running', result['error']); self.assertTrue(result['retained'])

    def test_unknown_or_legacy_record_never_creates_guard_or_recovers(self):
        for lock in [False, None, 'invalid', {'token':'legacy','started':1}, {'token':'0'*32,'started':1,'guard':2,'kind':'settings'}]:
            value = json.dumps(json.dumps(lock))
            result = self.php("$options[WZF_MASCOT_LOCK]=json_decode(" + value + ",true);$before=$options;" + """
            $state=wzf_mascot_task_status();try {wzf_mascot_task_recover(str_repeat('0',64),wzf_mascot_config_version(['characters'=>[]]),'1');}catch(Throwable $e){$error=true;}
            echo json_encode(['status'=>$state['status'],'error'=>$error,'unchanged'=>$before===$options,'created'=>file_exists(getenv('TEST_UPLOADS'))]);""")
            self.assertEqual(result['status'], 'unknown'); self.assertTrue(result['error']); self.assertTrue(result['unchanged']); self.assertFalse(result['created'])

    def test_missing_unsafe_or_replaced_guard_rejects_recovery(self):
        original_root = self.helper.root
        for index, change in enumerate(["unlink($path);", "unlink($path);symlink('/tmp',$path);", "unlink($path);mkdir($path);", "unlink($path);posix_mkfifo($path,0600);", "link($path,$path.'-link');", "chmod($path,0000);", "rename($path,$path.'-old');file_put_contents($path,'');"]):
            self.helper.root = original_root / str(index)
            self.helper.root.mkdir()
            result = self.php(self.abandoned() + "$path=wzf_mascot_uploads()['path'].'/'.WZF_MASCOT_GUARD_FILE;" + change + """
            $state=wzf_mascot_task_status();try {wzf_mascot_task_recover($fingerprint,$version,'1');}catch(Throwable $e){$error=true;}
            echo json_encode(['status'=>$state['status'],'error'=>$error,'unchanged'=>$before===$options[WZF_MASCOT_OPTION],'retained'=>$record===$options[WZF_MASCOT_LOCK]]);
            if (is_file($path) && !is_link($path)) chmod($path,0600);""")
            self.assertEqual(result['status'], 'unknown', change); self.assertTrue(result['error'], change); self.assertTrue(result['retained']); self.assertTrue(result['unchanged'])

    def test_replaced_inode_while_original_task_running_is_unknown(self):
        result = self.php("""$task=wzf_mascot_task_begin('settings');$record=$options[WZF_MASCOT_LOCK];
        $path=wzf_mascot_uploads()['path'].'/'.WZF_MASCOT_GUARD_FILE;rename($path,$path.'-old');file_put_contents($path,'');
        $state=wzf_mascot_task_status();try {wzf_mascot_task_recover(wzf_mascot_task_fingerprint($record),wzf_mascot_config_version($task['config']),'1');}catch(Throwable $e){$error=$e->getMessage();}
        echo json_encode(['state'=>$state,'error'=>$error,'retained'=>$record===$options[WZF_MASCOT_LOCK]]);
        flock($task['handle'],LOCK_UN);fclose($task['handle']);""")
        self.assertEqual(result['state']['status'], 'unknown'); self.assertIn('guard changed', result['error']); self.assertTrue(result['retained'])

    def test_fingerprint_config_confirmation_and_permission_are_required(self):
        for change in ["$fingerprint=str_repeat('0',64);", "$version=str_repeat('0',64);", "$confirm='';", "$allowed=false;", "$options[WZF_MASCOT_LOCK]['token']=str_repeat('f',32);", "$options[WZF_MASCOT_OPTION]['changed']=true;"]:
            result = self.php(self.abandoned() + "$confirm='1';" + change + """
            $snapshot=$options;try {wzf_mascot_task_recover($fingerprint,$version,$confirm);}catch(Throwable $e){$error=true;}
            echo json_encode(['error'=>$error,'unchanged'=>$snapshot===$options]);""")
            self.assertTrue(result['error']); self.assertTrue(result['unchanged'])

    def test_second_fresh_read_detects_replaced_record(self):
        result = self.php(self.abandoned() + """$read=$wpdb->reads;
        $database_before_read=function($count)use($read){global $options;if($count===$read+2)$options[WZF_MASCOT_LOCK]['token']=str_repeat('a',32);};
        try {wzf_mascot_task_recover($fingerprint,$version,'1');}catch(Throwable $e){$error=true;}
        echo json_encode(['error'=>$error,'retained'=>$options[WZF_MASCOT_LOCK]['token']===str_repeat('a',32),'unchanged'=>$before===$options[WZF_MASCOT_OPTION]]);""")
        self.assertTrue(result['error']); self.assertTrue(result['retained']); self.assertTrue(result['unchanged'])

    def test_task_end_does_not_remove_replacement_record(self):
        result = self.php("$task=wzf_mascot_task_begin('settings');$options[WZF_MASCOT_LOCK]['token']=str_repeat('f',32);wzf_mascot_task_end($task);echo json_encode(['retained'=>isset($options[WZF_MASCOT_LOCK])]);")
        self.assertTrue(result['retained'])

    def test_fresh_configuration_after_guard_prevents_stale_save(self):
        result = self.php("""$options[WZF_MASCOT_OPTION]=['characters'=>[]];$version=wzf_mascot_config_version($options[WZF_MASCOT_OPTION]);
        $database_before_read=function($count){global $options;if($count===2)$options[WZF_MASCOT_OPTION]['concurrent']=true;};
        try {wzf_mascot_save_mobile($version,true,true);}catch(Throwable $e){$error=$e->getMessage();}
        echo json_encode(['error'=>$error,'config'=>$options[WZF_MASCOT_OPTION],'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
        self.assertIn('changed', result['error']); self.assertNotIn('mobileEnabled', result['config']); self.assertTrue(result['config']['concurrent']); self.assertFalse(result['lock'])

    def test_all_writers_observe_same_os_guard_without_option_record(self):
        path = json.dumps(str(self.helper.fixture()))
        result = self.php(self.helper.settings_setup() + '$model=' + path + ';' + """$handle=wzf_mascot_task_guard();flock($handle,LOCK_EX|LOCK_NB);$errors=[];
        foreach ([fn()=>wzf_mascot_save_character('legacy_character',$version,$fields),fn()=>wzf_mascot_manage_character('legacy_character',$version,'disable'),fn()=>wzf_mascot_save_thumbnail('legacy_character',$version),fn()=>wzf_mascot_save_mobile($version,true,true),fn()=>wzf_mascot_save_resource('model',$model,['id'=>'next','name'=>'Next']),fn()=>wzf_mascot_replace_resource($model,'legacy_character',$version)] as $operation) {try {$operation();}catch(Throwable $e){$errors[]=$e->getMessage();}}
        echo json_encode(['errors'=>$errors,'unchanged'=>$before===$options[WZF_MASCOT_OPTION]]);flock($handle,LOCK_UN);fclose($handle);""")
        self.assertEqual(len(result['errors']), 6); self.assertTrue(all('in progress' in error for error in result['errors'])); self.assertTrue(result['unchanged'])

    def test_recovery_post_checks_permission_and_dedicated_nonce(self):
        for prefix, expected in [("$allowed=false;", 'forbidden'), ('', 'nonce rejected')]:
            result = self.php(prefix + 'wzf_mascot_task_recover_post();')
            self.assertEqual(result['error'], expected)

    def test_replacement_reuses_upload_error_categories_and_oversized_rejection(self):
        for code, expected in [(1,'server upload limit'),(2,'server upload limit'),(3,'interrupted'),(4,'Choose'),(6,'temporary upload storage'),(7,'temporary upload storage'),(8,'temporary upload storage')]:
            result = self.php("$_FILES['resource']=['error'=>" + str(code) + "];try{wzf_mascot_resource_upload();}catch(Throwable $e){$error=$e->getMessage();}echo json_encode(['error'=>$error]);")
            self.assertIn(expected, result['error'])
        result = self.php("function esc_html($s){return $s;}$_SERVER['CONTENT_LENGTH']=PHP_INT_MAX;try{wzf_mascot_upload_referer('wzf_mascot_manage');}catch(Throwable $e){$error=$e->getMessage();}echo json_encode(['error'=>$error,'unchanged'=>$options===[]]);")
        self.assertEqual(result['error'], 'forbidden'); self.assertTrue(result['unchanged'])


if __name__ == '__main__': unittest.main()
