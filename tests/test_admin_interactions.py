"""Unsaved previews and all-or-nothing template batch boundaries."""
import json
import unittest
import test_importer


class AdminInteractionTests(unittest.TestCase):
    def setUp(self):
        self.helper=test_importer.ImporterTests();self.helper.setUp()
    def tearDown(self): self.helper.tearDown()
    def php(self, body): return self.helper.php(body)
    def setup(self):
        return self.helper.settings_setup()+'''
        function get_current_user_id(){return $GLOBALS['preview_user']??7;}
        function get_current_blog_id(){return 1;}
        function plugins_url($path,$file){return 'https://example.invalid/plugin';}
        function wzf_mascot_presentation($config,$uploads){if(($config['presentation']??null)==='bad')throw new RuntimeException('terms');return [];}
        $options[WZF_MASCOT_OPTION]['characters']['second']=$c;
        $options[WZF_MASCOT_OPTION]['characters']['second']['dialogue']=['idle'=>['enabled'=>false,'cooldown'=>120,'lines'=>['Old'],'motions'=>['01']]];
        if(!is_dir($u['path'].'/core-test'))mkdir($u['path'].'/core-test');file_put_contents($u['path'].'/core-test/core.js','synthetic');
        $options[WZF_MASCOT_OPTION]['core']=['path'=>'core-test/core.js','sha256'=>WZF_MASCOT_CORE_SHA];
        $config=$options[WZF_MASCOT_OPTION];$version=wzf_mascot_config_version($config);
        $template=['type'=>'wzf-mascot-interactions','schema'=>1,'dialogue'=>wzf_mascot_dialogue([],true),'presets'=>[]];
        $template['dialogue']['click']=['enabled'=>true,'cooldown'=>30,'lines'=>['New draft']];$raw=json_encode($template);
        '''
    def test_preview_uses_draft_patches_without_writing(self):
        result=self.php(self.setup()+'''
        $before=$options;$draft=json_encode(['dialogue'=>['click'=>['enabled'=>true,'cooldown'=>30,'lines'=>['Unsaved & text']]],'presets'=>[['id'=>'hello','name'=>'Hello','motion'=>'01','expression'=>'','line'=>'Unsaved preset']]]);
        $plan=wzf_mascot_preview_plan($config,'legacy_character',$version,$draft);
        echo json_encode(['same'=>$before===$options,'plan'=>$plan]);''')
        self.assertTrue(result['same']);self.assertEqual(result['plan']['dialogue']['click']['lines'],['Unsaved & text'])
        self.assertEqual(result['plan']['presets'][0]['motion'],'01');self.assertEqual(result['plan']['motionCount'],2)
        self.assertEqual(result['plan']['expressionCount'],0)
    def test_draft_rejects_urls_unknown_keys_duplicates_and_bad_resources(self):
        values=[{'root':'https://bad'},{'dialogue':{'click':{'url':'https://bad'}}}, {'presets':[{'id':'a','name':'A','line':'x','motion':'missing'}]}]
        for value in values:
            r=self.php(self.setup()+"wzf_mascot_preview_draft($c,"+json.dumps(json.dumps(value))+ ");echo json_encode(['ok'=>true]);")
            self.assertFalse(r['ok'])
        self.assertFalse(self.php(self.setup()+'''wzf_mascot_preview_draft($c,'{"dialogue":{},"dialogue":{}}');echo json_encode(['ok'=>true]);''')['ok'])
    def test_preview_rejects_stale_version_core_terms_and_permission(self):
        for mutation in ["$version=str_repeat('0',64);", "$config['core']['sha256']='wrong';$version=wzf_mascot_config_version($config);", "$config['presentation']='bad';$version=wzf_mascot_config_version($config);", "$allowed=false;"]:
            r=self.php(self.setup()+mutation+'''wzf_mascot_preview_plan($config,'legacy_character',$version,'{"dialogue":{}}');echo json_encode(['ok'=>true]);''')
            self.assertFalse(r['ok'])
        self.assertFalse(self.php('wzf_mascot_preview_post();')['ok'])
    def test_batch_preview_canonical_targets_and_one_invalid_target_block_all(self):
        r=self.php(self.setup()+'''
        $before=$options;$review=wzf_mascot_template_batch_preview(['second','legacy_character','second'],$version,$raw,'dialogue');
        $blocked=wzf_mascot_template_batch_preview(['second','missing'],$version,$raw,'dialogue');
        echo json_encode(['same'=>$options===$before,'targets'=>$review['targets'],'blocked'=>$blocked['blocked'],'signature'=>$blocked['signature']]);''')
        self.assertTrue(r['same']);self.assertEqual(r['targets'],['legacy_character','second']);self.assertTrue(r['blocked']);self.assertEqual(r['signature'],'')
    def test_batch_apply_preserves_unselected_fields_and_idle_optin(self):
        r=self.php(self.setup()+'''
        $options['user-marker']=['private'=>'same'];$before=$options;
        $r=wzf_mascot_template_batch_preview(['second','legacy_character'],$version,$raw,'dialogue');
        wzf_mascot_template_batch_apply($r['targets'],$r['version'],$r['payload'],$r['scope'],$r['issued'],$r['signature'],'1');
        $after=$options;foreach(['legacy_character','second'] as $id){unset($before[WZF_MASCOT_OPTION]['characters'][$id]['dialogue']);unset($after[WZF_MASCOT_OPTION]['characters'][$id]['dialogue']);}
        echo json_encode(['rest'=>$before===$after,'click'=>$options[WZF_MASCOT_OPTION]['characters']['second']['dialogue']['click'],'idle'=>$options[WZF_MASCOT_OPTION]['characters']['second']['dialogue']['idle']]);''')
        self.assertTrue(r['rest']);self.assertEqual(r['click']['lines'],['New draft']);self.assertFalse(r['idle']['enabled']);self.assertEqual(r['idle']['motions'],['01'])
    def test_batch_tampering_stale_and_bad_target_never_write(self):
        mutations=["$r['targets']=['second'];","$r['issued']='1';","$r['scope']='dialogue-presets';","$r['payload'].=' ';","$preview_user=8;","$options[WZF_MASCOT_OPTION]['marker']='changed';", "$r['signature']=str_repeat('0',64);", "$r['targets']=['second','missing'];"]
        for mutation in mutations:
            r=self.php(self.setup()+'''$r=wzf_mascot_template_batch_preview(['second','legacy_character'],$version,$raw,'dialogue');'''+mutation+'''
            $before=$options;$failed=false;try{wzf_mascot_template_batch_apply($r['targets'],$r['version'],$r['payload'],$r['scope'],$r['issued'],$r['signature'],'1');}catch(Throwable $e){$failed=true;}echo json_encode(['failed'=>$failed,'same'=>$options===$before]);''')
            self.assertTrue(r['failed']);self.assertTrue(r['same'])
    def test_target_bounds_and_permissions(self):
        for targets in ["[]", "array_fill(0,51,'second')", "['../x']", "[23]", "['x'=> 'second']"]:
            self.assertFalse(self.php('wzf_mascot_template_targets('+targets+");echo json_encode(['ok'=>true]);")['ok'])
        self.assertFalse(self.php(self.setup()+"$allowed=false;wzf_mascot_template_batch_preview(['second'],$version,$raw,'dialogue');echo json_encode(['ok'=>true]);")['ok'])

    def test_batch_panel_does_not_read_single_target_character(self):
        r=self.php('''function esc_html($s){return htmlspecialchars((string)$s,ENT_QUOTES);}function esc_attr($s){return esc_html($s);}function esc_url($s){return esc_html($s);}
        function admin_url($s){return '/'.$s;}function add_query_arg($a,$b){return $b;}function wp_nonce_field($s){}function submit_button(...$a){}function checked(...$a){return '';}
        $wzf_mascot_template_review=['batch'=>true,'blocked'=>true,'rows'=>['bad-name'=>['error'=>'Invalid name']],'scope'=>'dialogue'];ob_start();wzf_mascot_template_panel(['characters'=>['bad-name'=>['name'=>['invalid']]]],'x');$html=ob_get_clean();echo json_encode(['blocked'=>str_contains($html,'One or more targets are blocked'),'targetFallback'=>str_contains($html,'bad-name · bad-name</label>'),'reviewFallback'=>str_contains($html,'bad-name · bad-name · Blocked'),'noArray'=>!str_contains($html,'Array')]);''')
        self.assertTrue(r['blocked']);self.assertTrue(r['targetFallback']);self.assertTrue(r['reviewFallback']);self.assertTrue(r['noArray'])

if __name__=='__main__':unittest.main()
