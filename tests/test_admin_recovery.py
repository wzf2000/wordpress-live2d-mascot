"""Private single-root quarantine, immutable review and interrupted purge regressions."""
import json
import unittest
import test_importer


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.helper = test_importer.ImporterTests(); self.helper.setUp()
        self.archive = json.dumps(str(self.helper.fixture()))
    def tearDown(self): self.helper.tearDown()
    def php(self, body): return self.helper.php(body)
    def setup(self, configured=True, delete=False):
        private=json.dumps(str(self.helper.root/'recovery'))
        return '''function get_current_user_id(){return $GLOBALS['user']??7;}
        function get_current_blog_id(){return 1;}
        function wp_unslash($v){return $v;}
        ''' + (f"if(!is_dir({private}))mkdir({private},0700);define('WZF_MASCOT_RECOVERY_DIR',{private});" if configured else '') + ("define('WZF_MASCOT_ALLOW_PERMANENT_DELETE',true);" if delete else '') + '''
        wzf_mascot_save_resource('model','''+self.archive+''',['id'=>'alpha','name'=>'Alpha']);
        $u=wzf_mascot_uploads();$old=rtrim($options[WZF_MASCOT_OPTION]['characters']['alpha']['root'],'/');
        wzf_mascot_replace_resource('''+self.archive+''','alpha',wzf_mascot_config_version($options[WZF_MASCOT_OPTION]));
        $previous=rtrim($options[WZF_MASCOT_OPTION]['characters']['alpha']['root'],'/');
        wzf_mascot_replace_resource('''+self.archive+''','alpha',wzf_mascot_config_version($options[WZF_MASCOT_OPTION]));
        $current=rtrim($options[WZF_MASCOT_OPTION]['characters']['alpha']['root'],'/');
        $options['account-preferences']=['keep'=>'exact'];
        function age_root($root){foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST)as$item)touch($item->getPathname(),time()-40*86400);touch($root,time()-40*86400);clearstatcache();}
        age_root($u['path'].'/'.$old);$before=$options;
        '''
    def test_actual_two_replacements_quarantine_restore_preserve_everything_else(self):
        r=self.php(self.setup()+'''
        $outside=[];foreach([$current,$previous]as$n)$outside[$n]=wzf_mascot_recovery_tree($u['path'].'/'.$n)['hash'];
        $p=wzf_mascot_recovery_preview('quarantine',$old);$id=wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1');
        $r=wzf_mascot_recovery_record($id);$gone=!file_exists($u['path'].'/'.$old);
        $p=wzf_mascot_recovery_preview('restore',$id);wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1');
        $same=true;foreach($outside as$n=>$hash)$same=$same&&$hash===wzf_mascot_recovery_tree($u['path'].'/'.$n)['hash'];
        echo json_encode(['same'=>$before===$options,'outside'=>$same,'gone'=>$gone,'restored'=>is_dir($u['path'].'/'.$old),'state'=>wzf_mascot_recovery_record($id)['state']]);''')
        self.assertEqual(r,dict(same=True,outside=True,gone=True,restored=True,state='restored'))
    def test_default_disabled_and_protected_references(self):
        self.assertFalse(self.php(self.setup(False)+"wzf_mascot_recovery_preview('quarantine',$old);echo json_encode(['ok'=>true]);")['ok'])
        for patch in ["$old=$current;", "$old=$previous;", "$options[WZF_MASCOT_OPTION]['characters']['disabled']=['root'=>$old.'/','status'=>'disabled'];", "$options[WZF_MASCOT_OPTION]['characters']['trash']=['root'=>$old.'/','status'=>'trash'];", "$options[WZF_MASCOT_OPTION]['characters']['nested']=['root'=>$old.'/textures/'];", "$options[WZF_MASCOT_OPTION]['core']=['path'=>$old.'/Model.moc3'];", "$options[WZF_MASCOT_OPTION]['presentation']=['terms'=>$old.'/Model.model3.json'];", "$old='stage-'.str_repeat('a',32);", "$old='legacy';"]:
            with self.subTest(patch=patch):
                self.assertFalse(self.php(self.setup()+patch+"wzf_mascot_recovery_preview('quarantine',$old,1);echo json_encode(['ok'=>true]);")['ok'])
    def test_incomplete_unknown_links_hardlink_times_and_json(self):
        for patch in ["file_put_contents($u['path'].'/'.$old.'/extra.bin','unknown');", "symlink('/tmp',$u['path'].'/'.$old.'/link');", "link($u['path'].'/'.$old.'/Model.moc3',$u['path'].'/outside-hardlink');", "touch($u['path'].'/'.$old.'/Model.moc3',time()+3600);", "unlink($u['path'].'/'.$old.'/textures/a.png');", "file_put_contents($u['path'].'/'.$old.'/motion/idle.motion3.json','bad');", "mkdir($u['path'].'/'.$old.'/unknown');"]:
            with self.subTest(patch=patch):
                self.assertFalse(self.php(self.setup()+patch+"wzf_mascot_recovery_preview('quarantine',$old,1);echo json_encode(['ok'=>true]);")['ok'])
    def test_permission_nonce_confirm_signature_expiry_and_new_reference(self):
        self.assertFalse(self.php(self.setup()+"$allowed=false;wzf_mascot_recovery_preview('quarantine',$old);echo json_encode(['ok'=>true]);")['ok'])
        self.assertFalse(self.php("$_SERVER['REQUEST_METHOD']='POST';$_POST=['operation'=>'quarantine'];wzf_mascot_recovery_post();echo json_encode(['ok'=>true]);")['ok'])
        for patch in ["$confirm='';", "$p['signature']=str_repeat('0',64);", "$p['plan']['path']=$previous;", "$user=8;", "$p['plan']['issued']=time()-901;$p['signature']=wzf_mascot_recovery_hmac($p['plan']);", "$options[WZF_MASCOT_OPTION]['characters']['new']=['root'=>$old.'/'];"]:
            r=self.php(self.setup()+'''$p=wzf_mascot_recovery_preview('quarantine',$old);$confirm='1';'''+patch+'''
            $before=$options;$failed=false;try{wzf_mascot_recovery_apply($p['plan'],$p['signature'],$confirm);}catch(Throwable $e){$failed=true;}echo json_encode(['failed'=>$failed,'same'=>$before===$options,'source'=>is_dir($u['path'].'/'.$old)]);''')
            self.assertEqual(r,dict(failed=True,same=True,source=True))
    def test_live_guard_zero_mutation(self):
        r=self.php(self.setup()+'''$p=wzf_mascot_recovery_preview('quarantine',$old);$guard=wzf_mascot_guard_scope_begin('resource');$failed=false;try{wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1');}catch(Throwable $e){$failed=true;}wzf_mascot_guard_scope_end($guard);echo json_encode(['failed'=>$failed,'same'=>$before===$options,'source'=>is_dir($u['path'].'/'.$old)]);''')
        self.assertEqual(r,dict(failed=True,same=True,source=True))
    def test_prepared_payload_restore_and_conflict(self):
        r=self.php(self.setup()+'''$p=wzf_mascot_recovery_preview('quarantine',$old);$id=wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1');$r=wzf_mascot_recovery_record($id);$r['state']='prepared';$r['quarantined']=null;wzf_mascot_recovery_write(wzf_mascot_recovery_record_dir($id),$r);
        mkdir($u['path'].'/'.$old);$blocked=false;try{wzf_mascot_recovery_preview('restore',$id);}catch(Throwable $e){$blocked=true;}rmdir($u['path'].'/'.$old);
        $p=wzf_mascot_recovery_preview('restore',$id);wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1');echo json_encode(['blocked'=>$blocked,'state'=>wzf_mascot_recovery_record($id)['state'],'same'=>$options===$before]);''')
        self.assertEqual(r,dict(blocked=True,state='restored',same=True))
    def test_purge_server_gate_age_confirmation_and_tombstone(self):
        for delete in [False,True]:
            r=self.php(self.setup(delete=delete)+'''$p=wzf_mascot_recovery_preview('quarantine',$old);$id=wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1');$blocked=false;try{wzf_mascot_recovery_preview('purge',$id);}catch(Throwable $e){$blocked=true;}echo json_encode(['blocked'=>$blocked]);''')
            self.assertTrue(r['blocked'])
        r=self.php(self.setup(delete=True)+'''$p=wzf_mascot_recovery_preview('quarantine',$old);$id=wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1');$r=wzf_mascot_recovery_record($id);$r['quarantined']=time()-31*86400;wzf_mascot_recovery_write(wzf_mascot_recovery_record_dir($id),$r);
        $p=wzf_mascot_recovery_preview('purge',$id);$blocked=false;try{wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1','wrong');}catch(Throwable $e){$blocked=true;}
        wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1',$old);$again=false;try{wzf_mascot_recovery_preview('purge',$id);}catch(Throwable $e){$again=true;}echo json_encode(['blocked'=>$blocked,'again'=>$again,'state'=>wzf_mascot_recovery_record($id)['state'],'same'=>$before===$options,'payload'=>file_exists(wzf_mascot_recovery_record_dir($id).'/payload')]);''')
        self.assertEqual(r,dict(blocked=True,again=True,state='purged',same=True,payload=False))
    def test_partial_purge_needs_new_review_and_rejects_extra_files(self):
        r=self.php(self.setup(delete=True)+'''$p=wzf_mascot_recovery_preview('quarantine',$old);$id=wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1');$r=wzf_mascot_recovery_record($id);$r['quarantined']=time()-31*86400;wzf_mascot_recovery_write(wzf_mascot_recovery_record_dir($id),$r);$stale=wzf_mascot_recovery_preview('purge',$id);
        $r['state']='purging';wzf_mascot_recovery_write(wzf_mascot_recovery_record_dir($id),$r);unlink(wzf_mascot_recovery_record_dir($id).'/payload/Model.moc3');$failed=false;try{wzf_mascot_recovery_apply($stale['plan'],$stale['signature'],'1',$old);}catch(Throwable $e){$failed=true;}
        $extra=wzf_mascot_recovery_record_dir($id).'/payload/extra';file_put_contents($extra,'x');$blocked=false;try{wzf_mascot_recovery_preview('purge',$id);}catch(Throwable $e){$blocked=true;}unlink($extra);
        $p=wzf_mascot_recovery_preview('purge',$id);wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1',$old);echo json_encode(['stale'=>$failed,'extra'=>$blocked,'state'=>wzf_mascot_recovery_record($id)['state'],'same'=>$before===$options]);''')
        self.assertEqual(r,dict(stale=True,extra=True,state='purged',same=True))

    def test_restoring_after_rename_finishes_record_without_overwriting(self):
        r=self.php(self.setup()+'''$p=wzf_mascot_recovery_preview('quarantine',$old);$id=wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1');$r=wzf_mascot_recovery_record($id);$r['state']='restoring';wzf_mascot_recovery_write(wzf_mascot_recovery_record_dir($id),$r);rename(wzf_mascot_recovery_record_dir($id).'/payload',$u['path'].'/'.$old);
        $p=wzf_mascot_recovery_preview('restore',$id);wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1');echo json_encode(['state'=>wzf_mascot_recovery_record($id)['state'],'same'=>$before===$options]);''')
        self.assertEqual(r,dict(state='restored',same=True))
    def test_partial_checkpoint_prefix_is_skipped(self):
        r=self.php(self.setup(delete=True)+'''$p=wzf_mascot_recovery_preview('quarantine',$old);$id=wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1');$r=wzf_mascot_recovery_record($id);$r['state']='purging';$r['quarantined']=time()-31*86400;unlink(wzf_mascot_recovery_record_dir($id).'/payload/Model.moc3');$r['deleted']['Model.moc3']=true;wzf_mascot_recovery_write(wzf_mascot_recovery_record_dir($id),$r);$p=wzf_mascot_recovery_preview('purge',$id);wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1',$old);echo json_encode(['state'=>wzf_mascot_recovery_record($id)['state'],'same'=>$before===$options]);''')
        self.assertEqual(r,dict(state='purged',same=True))
    def test_private_directory_constraints_and_fanout_bound(self):
        r=self.php(self.setup(False)+'''$private=$u['path'].'/private';mkdir($private,0700);define('WZF_MASCOT_RECOVERY_DIR',$private);wzf_mascot_recovery_base();echo json_encode(['ok'=>true]);''')
        self.assertFalse(r['ok'])
        r=self.php(self.setup(False)+'''$private=dirname(dirname($u['path'])).'/private-link';symlink($u['path'],$private);define('WZF_MASCOT_RECOVERY_DIR',$private);wzf_mascot_recovery_base();echo json_encode(['ok'=>true]);''')
        self.assertFalse(r['ok'])
        r=self.php(self.setup()+'''$fan=$u['path'].'/fanout';mkdir($fan);for($i=0;$i<4000;$i++)file_put_contents($fan.'/'.$i,'');wzf_mascot_recovery_tree($fan);echo json_encode(['ok'=>true]);''')
        self.assertFalse(r['ok'])
    def test_thumbnail_requires_only_image_and_original_root_identity(self):
        r=self.php(self.setup()+'''$thumb='thumbnail-'.str_repeat('a',32);mkdir($u['path'].'/'.$thumb);copy($u['path'].'/'.$old.'/textures/a.png',$u['path'].'/'.$thumb.'/image.png');mkdir($u['path'].'/'.$thumb.'/unknown');age_root($u['path'].'/'.$thumb);wzf_mascot_recovery_preview('quarantine',$thumb);echo json_encode(['ok'=>true]);''')
        self.assertFalse(r['ok'])
        r=self.php(self.setup()+'''$p=wzf_mascot_recovery_preview('quarantine',$old);$id=wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1');rename($u['path'],$u['path'].'-prior');mkdir($u['path']);foreach(new FilesystemIterator($u['path'].'-prior',FilesystemIterator::SKIP_DOTS)as$item)rename($item->getPathname(),$u['path'].'/'.$item->getFilename());wzf_mascot_recovery_preview('restore',$id);echo json_encode(['ok'=>true]);''')
        self.assertFalse(r['ok'])
    def test_manifest_tampering_and_size_refuse_without_losing_payload(self):
        r=self.php(self.setup()+'''$p=wzf_mascot_recovery_preview('quarantine',$old);$id=wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1');$dir=wzf_mascot_recovery_record_dir($id);$r=wzf_mascot_recovery_record($id);$large=$r;$large['extra']=str_repeat('x',2*1024*1024);$size=false;try{wzf_mascot_recovery_write($dir,$large);}catch(Throwable $e){$size=true;}$r['name']='model-'.str_repeat('0',32);file_put_contents($dir.'/manifest.json',json_encode($r));$bad=false;try{wzf_mascot_recovery_record($id);}catch(Throwable $e){$bad=true;}echo json_encode(['size'=>$size,'bad'=>$bad,'payload'=>is_dir($dir.'/payload'),'same'=>$options===$before]);''')
        self.assertEqual(r,dict(size=True,bad=True,payload=True,same=True))

    def test_cross_filesystem_rejected_without_creating_anything(self):
        import os
        self.assertNotEqual(os.stat('/dev/shm').st_dev,os.stat(self.helper.root).st_dev)
        r=self.php(self.setup(False)+"define('WZF_MASCOT_RECOVERY_DIR','/dev/shm');wzf_mascot_recovery_base();echo json_encode(['ok'=>true]);")
        self.assertFalse(r['ok']);self.assertIn('same filesystem',r['error'])
    def test_interruption_keeps_prepared_source_and_partial_purge(self):
        r=self.php(self.setup()+'''$p=wzf_mascot_recovery_preview('quarantine',$old);$database_before_read=function(){global $database_before_read;foreach(glob(wzf_mascot_recovery_blog().'/*/manifest.json')as$file){$r=json_decode(file_get_contents($file),true);if($r['state']==='prepared'){unset($GLOBALS['database_before_read']);throw new RuntimeException('synthetic interruption');}}};$failed=false;try{wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1');}catch(Throwable $e){$failed=true;}$files=glob(wzf_mascot_recovery_blog().'/*/manifest.json');echo json_encode(['failed'=>$failed,'source'=>is_dir($u['path'].'/'.$old),'state'=>json_decode(file_get_contents($files[0]),true)['state'],'same'=>$before===$options]);''')
        self.assertEqual(r,dict(failed=True,source=True,state='prepared',same=True))
        r=self.php(self.setup(delete=True)+'''$p=wzf_mascot_recovery_preview('quarantine',$old);$id=wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1');$r=wzf_mascot_recovery_record($id);$r['quarantined']=time()-31*86400;wzf_mascot_recovery_write(wzf_mascot_recovery_record_dir($id),$r);$p=wzf_mascot_recovery_preview('purge',$id);
        $database_before_read=function()use($id){$r=wzf_mascot_recovery_record($id);if($r['state']==='purging'&&count($r['deleted'])>0){unset($GLOBALS['database_before_read']);throw new RuntimeException('synthetic interruption');}};$failed=false;try{wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1',$old);}catch(Throwable $e){$failed=true;}$partial=wzf_mascot_recovery_record($id)['state'];$p=wzf_mascot_recovery_preview('purge',$id);wzf_mascot_recovery_apply($p['plan'],$p['signature'],'1',$old);echo json_encode(['failed'=>$failed,'partial'=>$partial,'state'=>wzf_mascot_recovery_record($id)['state'],'same'=>$before===$options]);''')
        self.assertEqual(r,dict(failed=True,partial='purging',state='purged',same=True))

if __name__=='__main__': unittest.main()
