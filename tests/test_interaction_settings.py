"""Optional dialogue is bounded and isolated from character validity."""
import unittest
import test_importer

class InteractionTests(unittest.TestCase):
    def setUp(self):
        self.helper = test_importer.ImporterTests(); self.helper.setUp()
    def tearDown(self): self.helper.tearDown()
    def php(self, body): return self.helper.php(body)
    def test_optional_bad_rules_are_local(self):
        result = self.php("echo json_encode(wzf_mascot_dialogue(['welcome'=>['enabled'=>true,'cooldown'=>15,'lines'=>['Hello','Hello','  ']],'click'=>['enabled'=>true,'lines'=>['<script>bad</script>']]]));")
        self.assertEqual(result['welcome']['lines'], ['Hello']); self.assertNotIn('click', result)
    def test_limits_reject_on_save(self):
        for rule in ["['enabled'=>true,'cooldown'=>14,'lines'=>['ok']]", "['enabled'=>true,'cooldown'=>3601,'lines'=>['ok']]", "['enabled'=>true,'lines'=>array_fill(0,9,'ok')]", "['enabled'=>true,'lines'=>[str_repeat('a',301)]]", "['enabled'=>true,'lines'=>[\"a\\nb\"]]"]:
            result = self.php("wzf_mascot_dialogue(['welcome'=>" + rule + "],true);echo json_encode(['accepted'=>true]);")
            self.assertFalse(result.get('ok', True))
    def test_save_needs_no_catalog_and_retains_unexposed_fields(self):
        result = self.php("""$options[WZF_MASCOT_OPTION]=['characters'=>['text-only'=>['name'=>'Original','root'=>'missing/','marker'=>42]],'marker'=>17];
        $before=$options[WZF_MASCOT_OPTION];$version=wzf_mascot_config_version($before);
        wzf_mascot_save_interaction('text-only',$version,['welcome'=>['enabled'=>true,'cooldown'=>15,'lines'=>['Hello']]]);
        $saved=$options[WZF_MASCOT_OPTION];$stale=false;
        try {wzf_mascot_save_interaction('text-only',$version,[]);}catch(Throwable $e){$stale=true;}
        echo json_encode(['saved'=>$saved,'stale'=>$stale,'retained'=>$options[WZF_MASCOT_OPTION]===$saved,'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
        self.assertEqual(result['saved']['characters']['text-only']['marker'],42);self.assertEqual(result['saved']['marker'],17)
        self.assertTrue(result['stale']);self.assertTrue(result['retained']);self.assertFalse(result['lock'])
    def test_permissions_and_nonce_are_required(self):
        for body in ["$allowed=false;wzf_mascot_save_interaction('x',str_repeat('0',64),[]);", "wzf_mascot_interaction_post();", "$allowed=false;wzf_mascot_interaction_post();"]:
            result=self.php(body);self.assertFalse(result['ok'])
    def test_idle_limits_defaults_and_template_library(self):
        result=self.php("echo json_encode(['rules'=>wzf_mascot_dialogue([],true),'drafts'=>wzf_mascot_dialogue_drafts()]);")
        self.assertEqual(result['rules']['idle']['cooldown'],120)
        self.assertFalse(result['rules']['idle']['enabled'])
        self.assertEqual(len(result['drafts']),26)
        for draft in result['drafts'].values():
            for lines in draft['lines'].values():
                self.assertLessEqual(len(lines),8)
                for line in lines:self.assertLessEqual(len(line.encode()),300)
        for cooldown in [89,1801]:
            self.assertFalse(self.php("wzf_mascot_dialogue(['idle'=>['enabled'=>true,'cooldown'=>"+str(cooldown)+",'lines'=>['Hi']]],true);")['ok'])

    def test_empty_rule_is_disabled(self):
        result=self.php("echo json_encode(wzf_mascot_dialogue(['welcome'=>['enabled'=>true,'lines'=>[' ','']]],true));")
        self.assertFalse(result['welcome']['enabled'])

    def test_presets_skip_only_invalid_rows_and_reject_invalid_saves(self):
        result=self.php("""$rows=[['id'=>'hello','name'=>'Hello','motion'=>'wave','expression'=>'','line'=>'Hello'],['id'=>'bad','name'=>'Bad','motion'=>'missing','expression'=>'','line'=>'Never']];
        $safe=wzf_mascot_presets($rows,['wave'=>[]],[]);$rejected=false;
        try {wzf_mascot_presets($rows,['wave'=>[]],[],true);}catch(Throwable $e){$rejected=true;}
        echo json_encode(['safe'=>$safe,'rejected'=>$rejected]);""")
        self.assertEqual(len(result['safe']),1);self.assertTrue(result['rejected'])

    def test_presets_save_keeps_dialogue_and_rejects_stale_and_permissions(self):
        result=self.php(self.helper.settings_setup()+"""
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['dialogue']=['retained'=>'yes'];
        $version=wzf_mascot_config_version($options[WZF_MASCOT_OPTION]);
        $rows=[['id'=>'hello','name'=>'Hello','motion'=>'01','expression'=>'','line'=>'Hello']];
        wzf_mascot_save_presets('legacy_character',$version,$rows);$saved=$options[WZF_MASCOT_OPTION];$stale=false;$permission=false;
        try {wzf_mascot_save_presets('legacy_character',$version,[]);}catch(Throwable $e){$stale=true;}
        $allowed=false;try {wzf_mascot_save_presets('legacy_character',wzf_mascot_config_version($saved),[]);}catch(Throwable $e){$permission=true;}
        echo json_encode(['saved'=>$saved,'stale'=>$stale,'permission'=>$permission,'retained'=>$options[WZF_MASCOT_OPTION]===$saved,'lock'=>get_option(WZF_MASCOT_LOCK)]);""")
        self.assertTrue(result['stale']);self.assertTrue(result['permission']);self.assertTrue(result['retained']);self.assertFalse(result['lock'])
        self.assertEqual(result['saved']['characters']['legacy_character']['dialogue'],{'retained':'yes'})

    def test_presets_map_both_channels_by_file_and_drop_whole_unmapped_preset(self):
        result=self.php(self.helper.settings_setup()+"""
        $root=$u['path'].'/'.$c['root'];mkdir($root.'expression');
        file_put_contents($root.'expression/a.exp3.json','{}');file_put_contents($root.'expression/b.exp3.json','{}');
        $cat=json_decode(file_get_contents($root.'catalog.json'),true);
        $cat['expressions']=[['id'=>'expression-1','file'=>'expression/a.exp3.json'],['id'=>'expression-2','file'=>'expression/b.exp3.json']];
        file_put_contents($root.'catalog.json',json_encode($cat));
        $c['presets']=[['id'=>'mapped','name'=>'Mapped','motion'=>'01','expression'=>'expression-1','line'=>'A'],['id'=>'gone','name'=>'Gone','motion'=>'','expression'=>'expression-2','line'=>'B']];
        $next=['motions'=>[['id'=>'01','file'=>'motion/idle.motion3.json'],['id'=>'wave-new','file'=>'motion/greet.motion3.json']], 'expressions'=>[['id'=>'expression-1','file'=>'expression/new.exp3.json'],['id'=>'expression-2','file'=>'expression/a.exp3.json']]];
        echo json_encode(wzf_mascot_remap_presets($c,wzf_mascot_character_catalog($c),$next));""")
        self.assertEqual(len(result['presets']),1);self.assertEqual(result['presets'][0]['motion'],'wave-new')
        self.assertEqual(result['presets'][0]['expression'],'expression-2');self.assertEqual(result['presetWarnings'],1)

    def test_rollback_restores_history_presets_or_removes_new_fields(self):
        replacement=self.helper.replacement_fixture()
        result=self.php(self.helper.settings_setup()+"""
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['presets']=[['id'=>'greet','name'=>'Greet','motion'=>'01','expression'=>'','line'=>'Original']];
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['dialogue']=['retained'=>'yes'];
        wzf_mascot_replace_resource("""+replacement+""",'legacy_character',wzf_mascot_config_version($options[WZF_MASCOT_OPTION]));
        $mapped=$options[WZF_MASCOT_OPTION]['characters']['legacy_character'];
        wzf_mascot_manage_character('legacy_character',wzf_mascot_config_version($options[WZF_MASCOT_OPTION]),'rollback');
        $rolled=$options[WZF_MASCOT_OPTION]['characters']['legacy_character'];
        unset($options[WZF_MASCOT_OPTION]['history']['legacy_character']['presets']);
        wzf_mascot_manage_character('legacy_character',wzf_mascot_config_version($options[WZF_MASCOT_OPTION]),'rollback');
        echo json_encode(['mapped'=>$mapped,'rolled'=>$rolled,'last'=>$options[WZF_MASCOT_OPTION]['characters']['legacy_character']]);""")
        self.assertEqual(result['mapped']['presets'][0]['motion'],'motion-1');self.assertEqual(result['rolled']['presets'][0]['motion'],'01')
        self.assertNotIn('presets',result['last']);self.assertEqual(result['last']['dialogue'],{'retained':'yes'})

    def test_preset_bounds_and_nonce(self):
        rows=["array_fill(0,9,[])","[['id'=>'a','name'=>'A','motion'=>'','expression'=>'','line'=>'']]","[['id'=>'a','name'=>str_repeat('a',81),'line'=>'ok']]","[['id'=>'a','name'=>'A','line'=>str_repeat('a',301)]]"]
        for row in rows:
            result=self.php("wzf_mascot_presets("+row+",[],[],true);echo json_encode(['accepted'=>true]);")
            self.assertFalse(result.get('ok',True))
        self.assertFalse(self.php('wzf_mascot_presets_post();')['ok'])

    def test_actual_replacement_expression_reordering_uses_files_not_reused_ids(self):
        def change(files):
            files['Model.model3.json']['FileReferences']['Expressions']=[{'Name':'B','File':'expression/b.exp3.json'},{'Name':'A','File':'expression/a.exp3.json'}]
            files['expression/a.exp3.json']={};files['expression/b.exp3.json']={}
        import json
        replacement=json.dumps(str(self.helper.fixture(change)))
        result=self.php(self.helper.settings_setup()+"""
        $root=$u['path'].'/'.$c['root'];mkdir($root.'expression');
        file_put_contents($root.'expression/a.exp3.json','{}');file_put_contents($root.'expression/b.exp3.json','{}');
        $cat=json_decode(file_get_contents($root.'catalog.json'),true);
        $cat['expressions']=[['id'=>'expression-1','file'=>'expression/a.exp3.json'],['id'=>'expression-2','file'=>'expression/b.exp3.json']];
        file_put_contents($root.'catalog.json',json_encode($cat));
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['presets']=[['id'=>'a','name'=>'A','motion'=>'','expression'=>'expression-1','line'=>'A']];
        wzf_mascot_replace_resource("""+replacement+""",'legacy_character',wzf_mascot_config_version($options[WZF_MASCOT_OPTION]));
        $mapped=$options[WZF_MASCOT_OPTION]['characters']['legacy_character']['presets'];
        wzf_mascot_manage_character('legacy_character',wzf_mascot_config_version($options[WZF_MASCOT_OPTION]),'rollback');
        echo json_encode(['mapped'=>$mapped,'rolled'=>$options[WZF_MASCOT_OPTION]['characters']['legacy_character']['presets']]);""")
        self.assertEqual(result['mapped'][0]['expression'],'expression-2');self.assertEqual(result['rolled'][0]['expression'],'expression-1')

    def test_hit_bindings_use_values_not_field_keys_and_filter_local_failures(self):
        result=self.php("""$rows=[['area'=>'Head [special]','preset'=>'hello'],['area'=>'__proto__','preset'=>'hello'],['area'=>'Missing','preset'=>'hello'],['area'=>'Body','preset'=>'missing']];
        $safe=wzf_mascot_hit_bindings($rows,['Head [special]','Body'],[['id'=>'hello']]);$rejected=false;
        try {wzf_mascot_hit_bindings($rows,['Head [special]','Body'],[['id'=>'hello']],true);}catch(Throwable $e){$rejected=true;}
        echo json_encode(['safe'=>$safe,'rejected'=>$rejected]);""")
        self.assertEqual(result['safe'],[{'area':'Head [special]','preset':'hello'}]);self.assertTrue(result['rejected'])

    def test_hit_save_validates_current_model_and_preset_removal_drops_binding(self):
        result=self.php(self.helper.settings_setup()+"""
        $root=$u['path'].'/'.$c['root'];$model=json_decode(file_get_contents($root.$c['file']),true);$model['HitAreas']=[['Name'=>'Head','Id'=>'head-drawable']];file_put_contents($root.$c['file'],json_encode($model));
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['presets']=[['id'=>'hello','name'=>'Hello','motion'=>'','expression'=>'','line'=>'Hello']];
        wzf_mascot_save_hits('legacy_character',wzf_mascot_config_version($options[WZF_MASCOT_OPTION]),[['area'=>'Head','preset'=>'hello']]);
        $saved=$options[WZF_MASCOT_OPTION];$bad=false;
        try {wzf_mascot_save_hits('legacy_character',wzf_mascot_config_version($saved),[['area'=>'Body','preset'=>'hello']]);}catch(Throwable $e){$bad=true;}
        wzf_mascot_save_presets('legacy_character',wzf_mascot_config_version($options[WZF_MASCOT_OPTION]),[]);
        echo json_encode(['saved'=>$saved,'bad'=>$bad,'after'=>$options[WZF_MASCOT_OPTION]['characters']['legacy_character']]);""")
        self.assertEqual(result['saved']['characters']['legacy_character']['hitBindings'],[{'area':'Head','preset':'hello'}]);self.assertTrue(result['bad'])
        self.assertEqual(result['after']['hitBindings'],[]);self.assertEqual(result['after']['hitWarnings'],1)

    def test_hit_nonce_and_permissions(self):
        self.assertFalse(self.php('wzf_mascot_hits_post();')['ok'])
        self.assertFalse(self.php("$allowed=false;wzf_mascot_save_hits('x',str_repeat('0',64),[]);")['ok'])

    def account(self, body):
        setup='''$test_uid=7;$test_blog=1;$test_metadata=[];$test_writes=0;$test_filter=false;
        function get_current_user_id(){global $test_uid;return $test_uid;}
        function get_current_blog_id(){global $test_blog;return $test_blog;}
        function update_user_meta($uid,$key,$value){global $test_metadata,$test_writes,$test_filter;$test_writes++;if($test_filter)$value['preferences']['character']='changed';$test_metadata[$uid][$key]=[serialize($value)];return true;}
        class PreferenceDatabase extends TaskDatabase {
          public $usermeta='stub_usermeta';public $query_args=[];
          function get_blog_prefix($blog){return $blog===1?'wp_':'wp_'.$blog.'_';}
          function prepare($sql,...$args){$this->query_args=$args;return $sql;}
          function get_results(...$args){global $test_metadata;$sql=$args[0]??'';if(strpos($sql,'meta_value')!==false){$values=$test_metadata[$this->query_args[0]][$this->query_args[1]]??[];return array_map(function($value){return ['meta_value'=>$value];},$values);}return parent::get_results(...$args);}
        }
        $wpdb=new PreferenceDatabase();
        $preferences=['character'=>'temporarily-disabled','favorites'=>['legacy_character','23','temporarily-disabled'],'layouts'=>[['id'=>'legacy_character','position'=>'left','size'=>200,'anchor'=>['x'=>0,'y'=>0.25]]]];
        '''
        return self.php(setup+body)

    def test_account_revision_fresh_reads_and_no_admin_task_option(self):
        result=self.account("""$initial=wzf_mascot_preference_snapshot(7);$before=$options;
        $first=wzf_mascot_save_preferences(7,0,$preferences);$conflict=wzf_mascot_save_preferences(7,0,$preferences);
        echo json_encode(['initial'=>$initial,'first'=>$first,'conflict'=>$conflict,'writes'=>$test_writes,'options_unchanged'=>$options===$before]);""")
        self.assertEqual(result['initial'],{'revision':0,'preferences':None});self.assertEqual(result['first']['state']['revision'],1)
        self.assertFalse(result['conflict']['ok']);self.assertEqual(result['conflict']['code'],'conflict');self.assertEqual(result['writes'],1);self.assertTrue(result['options_unchanged'])
        self.assertEqual(result['first']['state']['preferences']['character'],'temporarily-disabled')

    def test_account_blog_keys_are_isolated(self):
        result=self.account("""$key1=wzf_mascot_preference_key();wzf_mascot_save_preferences(7,0,$preferences);$test_blog=2;$key2=wzf_mascot_preference_key();$empty=wzf_mascot_preference_snapshot(7);wzf_mascot_save_preferences(7,0,$preferences);echo json_encode(['keys'=>[$key1,$key2],'empty'=>$empty,'count'=>count($test_metadata[7])]);""")
        self.assertNotEqual(*result['keys']);self.assertEqual(result['empty']['revision'],0);self.assertEqual(result['count'],2)

    def test_account_cannot_address_another_user_and_guard_conflicts(self):
        result=self.account("""$foreign=false;try{wzf_mascot_save_preferences(8,0,$preferences);}catch(Throwable $e){$foreign=true;}
        $guard=wzf_mascot_task_guard(true);flock($guard,LOCK_EX);$busy=false;try{wzf_mascot_save_preferences(7,0,$preferences);}catch(Throwable $e){$busy=$e->getMessage()==='account-busy';}flock($guard,LOCK_UN);fclose($guard);
        echo json_encode(['foreign'=>$foreign,'busy'=>$busy,'writes'=>$test_writes]);""")
        self.assertTrue(result['foreign']);self.assertTrue(result['busy']);self.assertEqual(result['writes'],0)

    def test_account_schema_rejects_extra_and_dangerous_data(self):
        mutations=["$preferences['mobile']=true;","$preferences['favorites']=['__proto__'];","$preferences['character']='constructor';","$preferences['layouts'][0]['anchor']['x']=INF;","$preferences['layouts'][0]['anchor']['y']=-0.1;","$preferences['layouts'][0]['size']=201;","$preferences['layouts'][0]['offset']=10;","$preferences['favorites']=array_fill(0,101,'a');","$preferences['layouts'][0]['anchor']['prototype']=0;"]
        for mutation in mutations:
            result=self.account(mutation+"wzf_mascot_save_preferences(7,0,$preferences);echo json_encode(['accepted'=>true]);")
            self.assertFalse(result.get('ok',True))

    def test_account_write_confirmation_detects_mutating_filter(self):
        result=self.account("$test_filter=true;wzf_mascot_save_preferences(7,0,$preferences);echo json_encode(['accepted'=>true]);")
        self.assertFalse(result['ok']);self.assertEqual(result['error'],'account-unavailable')

    def test_account_duplicate_metadata_rows_never_overwrite(self):
        result=self.account("""$test_metadata[7][wzf_mascot_preference_key()]=[serialize(['revision'=>1,'preferences'=>$preferences]),serialize(['revision'=>1,'preferences'=>$preferences])];wzf_mascot_save_preferences(7,1,$preferences);echo json_encode(['accepted'=>true]);""")
        self.assertFalse(result['ok']);self.assertEqual(result['error'],'account-unavailable')

    def test_capture_requires_explicit_confirmation_and_admin_nonce(self):
        result=self.php(self.helper.settings_setup()+"""$before=$options[WZF_MASCOT_OPTION];$rejected=false;
        try{wzf_mascot_save_capture('legacy_character',$version,true,false);}catch(Throwable $e){$rejected=true;}
        wzf_mascot_save_capture('legacy_character',$version,true,true);$enabled=$options[WZF_MASCOT_OPTION]['characters']['legacy_character']['captureAllowed'];
        $allowed=false;$permission=false;try{wzf_mascot_save_capture('legacy_character',wzf_mascot_config_version($options[WZF_MASCOT_OPTION]),false,false);}catch(Throwable $e){$permission=true;}
        echo json_encode(['rejected'=>$rejected,'enabled'=>$enabled,'permission'=>$permission]);""")
        self.assertTrue(result['rejected']);self.assertTrue(result['enabled']);self.assertTrue(result['permission']);self.assertFalse(self.php('wzf_mascot_capture_post();')['ok'])

    def test_capture_permission_is_reset_on_replace_and_rollback(self):
        replacement=self.helper.replacement_fixture()
        result=self.php(self.helper.settings_setup()+"""
        wzf_mascot_save_capture('legacy_character',$version,true,true);
        wzf_mascot_replace_resource("""+replacement+""",'legacy_character',wzf_mascot_config_version($options[WZF_MASCOT_OPTION]));$replaced=$options[WZF_MASCOT_OPTION]['characters']['legacy_character']['captureAllowed'];
        wzf_mascot_save_capture('legacy_character',wzf_mascot_config_version($options[WZF_MASCOT_OPTION]),true,true);
        wzf_mascot_manage_character('legacy_character',wzf_mascot_config_version($options[WZF_MASCOT_OPTION]),'rollback');
        echo json_encode(['replaced'=>$replaced,'rolled'=>$options[WZF_MASCOT_OPTION]['characters']['legacy_character']['captureAllowed']]);""")
        self.assertFalse(result['replaced']);self.assertFalse(result['rolled'])

    def transfer_setup(self):
        return '''
        function get_current_user_id(){return 7;}
        function get_current_blog_id(){return 1;}
        $template=['type'=>'wzf-mascot-interactions','schema'=>1,'dialogue'=>wzf_mascot_dialogue([],true),'presets'=>[]];
        $template['dialogue']['welcome']=['enabled'=>true,'cooldown'=>15,'lines'=>['New welcome']];
        $template['dialogue']['idle']=['enabled'=>true,'cooldown'=>120,'lines'=>['New chatter']];
        $raw=json_encode($template);
        '''

    def test_template_export_preview_do_not_write_or_create_guard(self):
        result=self.php(self.transfer_setup()+'''
        $options[WZF_MASCOT_OPTION]=['characters'=>['text'=>['root'=>'missing/','marker'=>42,'presets'=>[['id'=>'hello','name'=>'Hello','motion'=>'','expression'=>'','line'=>'Hello']]]],'marker'=>17];
        $before=$options;$version=wzf_mascot_config_version($options[WZF_MASCOT_OPTION]);
        $export=wzf_mascot_template_export($options[WZF_MASCOT_OPTION],'text',$version);
        $review=wzf_mascot_template_preview('text',$version,$raw,'dialogue');
        echo json_encode(['export'=>json_decode($export,true),'same'=>$before===$options,'guard'=>file_exists(wzf_mascot_uploads()['path'].'/'.WZF_MASCOT_GUARD_FILE),'review'=>$review]);
        ''')
        self.assertTrue(result['same']);self.assertFalse(result['guard'])
        self.assertEqual(set(result['export']),{'type','schema','dialogue','presets'})
        self.assertEqual(result['export']['presets'][0]['motionFile'],'')
        self.assertNotIn('missing/',str(result['export']))
        self.assertFalse(result['review']['plan']['after']['dialogue']['idle']['enabled'])

    def test_template_strict_schema_all_levels_and_types(self):
        mutations=["$template['extra']=1;", "$template['type']='other';", "$template['schema']='1';",
                   "$template['dialogue']['extra']=[];", "unset($template['dialogue']['click']);",
                   "$template['dialogue']['click']['extra']=true;", "$template['dialogue']['click']['lines']=(object)[];",
                   "$template['dialogue']['click']['enabled']=1;", "$template['dialogue']['click']['enabled']=null;",
                   "$template['dialogue']['click']['cooldown']=null;", "$template['dialogue']['idle']['cooldown']=89;",
                   "$template['dialogue']['welcome']['lines']=['<b>bad</b>'];", "$template['dialogue']['welcome']['lines']=[\"a\\nb\"];",
                   "$template['dialogue']['welcome']['lines']=array_fill(0,9,'x');", "$template['dialogue']['welcome']['lines']=[str_repeat('a',301)];",
                   "$template['presets']=(object)[];", "$template['presets']=[(object)['id'=>'a']];"]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                result=self.php(self.transfer_setup()+mutation+"wzf_mascot_template_decode(json_encode($template));echo json_encode(['ok'=>true]);")
                self.assertFalse(result['ok'])

    def test_template_rejects_malformed_utf8_duplicate_keys_depth_and_size(self):
        for value in ["str_repeat('x',65537)", "'{}'", "'['.str_repeat('[',20).'0'.str_repeat(']',20).']'", "chr(255)",
                      "str_replace('\"schema\":1','\"schema\":1,\"schema\":1',$raw)",
                      "str_replace('\"schema\":1','\"schema\":1,\"sche\\\\u006da\":1',$raw)",
                      "str_replace('\"enabled\":true','\"enabled\":true,\"enabled\":false',$raw)"]:
            with self.subTest(value=value):
                result=self.php(self.transfer_setup()+f"wzf_mascot_template_decode({value});echo json_encode(['ok'=>true]);")
                self.assertFalse(result['ok'])

    def test_template_paths_and_preset_limits(self):
        for path in ['../escape.motion3.json','/a.motion3.json','https://example.invalid/a.motion3.json','a%2fb.motion3.json','a\\b.motion3.json','C:/a.motion3.json','bad.php.motion3.json','x.exp3.json']:
            result=self.php(self.transfer_setup()+"$template['presets']=[['id'=>'hello','name'=>'Hello','motionFile'=>"+__import__('json').dumps(path)+",'expressionFile'=>'','line'=>'Hello']];wzf_mascot_template_decode(json_encode($template));echo json_encode(['ok'=>true]);")
            self.assertFalse(result['ok'],path)
        for mutation in ["$template['presets'][0]['extra']=1;", "$template['presets'][0]['name']=str_repeat('a',81);", "$template['presets'][0]['line']='';", "$template['presets'][]=$template['presets'][0];", "$template['presets']=array_fill(0,9,$template['presets'][0]);", "unset($template['presets'][0]['motionFile']);"]:
            result=self.php(self.transfer_setup()+"$template['presets']=[['id'=>'hello','name'=>'Hello','motionFile'=>'','expressionFile'=>'','line'=>'Text']];"+mutation+"wzf_mascot_template_decode(json_encode($template));echo json_encode(['ok'=>true]);")
            self.assertFalse(result['ok'],mutation)

    def test_template_apply_only_selected_fields_preserves_chatter_and_other_data(self):
        result=self.php(self.helper.settings_setup()+self.transfer_setup()+'''
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['captureAllowed']=true;
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['hitBindings']=[['area'=>'Head','preset'=>'hello']];
        $options[WZF_MASCOT_OPTION]['characters']['legacy_character']['presets']=[['id'=>'hello','name'=>'Old','motion'=>'01','expression'=>'','line'=>'Old']];
        $options[WZF_MASCOT_OPTION]['history']=['unchanged'=>'sentinel'];$options['account-sentinel']=['private'=>'same'];
        $before=$options;$version=wzf_mascot_config_version($options[WZF_MASCOT_OPTION]);
        $r=wzf_mascot_template_preview('legacy_character',$version,$raw,'dialogue');
        wzf_mascot_template_apply('legacy_character',$version,$r['payload'],$r['scope'],$r['issued'],$r['signature'],'1');
        $saved=$options;$rules=$saved[WZF_MASCOT_OPTION]['characters']['legacy_character']['dialogue'];
        unset($saved[WZF_MASCOT_OPTION]['characters']['legacy_character']['dialogue']);
        echo json_encode(['rules'=>$rules,'same'=>$saved===$before,'lock'=>get_option(WZF_MASCOT_LOCK)]);
        ''')
        self.assertTrue(result['same']);self.assertFalse(result['lock']);self.assertEqual(result['rules']['welcome']['lines'],['New welcome'])
        self.assertFalse(result['rules']['idle']['enabled'])
        for enabled,lines,expected in [(True,['x'],True),(True,[],False),(False,['x'],False)]:
            result=self.php(self.transfer_setup()+"$config=['characters'=>['text'=>['dialogue'=>['idle'=>['enabled'=>"+('true' if enabled else 'false')+",'cooldown'=>120,'lines'=>['old']]]]]];$template['dialogue']['idle']['lines']="+__import__('json').dumps(lines)+";$plan=wzf_mascot_template_plan($config,'text',wzf_mascot_config_version($config),json_encode($template),'dialogue');echo json_encode($plan['after']['dialogue']['idle']);")
            self.assertEqual(result['enabled'],expected)

    def test_template_resource_mapping_export_and_ambiguity(self):
        result=self.php(self.helper.settings_setup()+self.transfer_setup()+'''
        $root=$u['path'].'/'.$c['root'];mkdir($root.'expression');file_put_contents($root.'expression/a.exp3.json','{}');
        $cat=json_decode(file_get_contents($root.'catalog.json'),true);$cat['expressions']=[['id'=>'smile','file'=>'expression/a.exp3.json']];file_put_contents($root.'catalog.json',json_encode($cat));
        $template['presets']=[['id'=>'hello','name'=>'Hello','motionFile'=>'motion/greet.motion3.json','expressionFile'=>'expression/a.exp3.json','line'=>'Hello']];
        $raw=json_encode($template);$r=wzf_mascot_template_preview('legacy_character',$version,$raw,'dialogue-presets');
        wzf_mascot_template_apply('legacy_character',$version,$r['payload'],$r['scope'],$r['issued'],$r['signature'],'1');
        $config=$options[WZF_MASCOT_OPTION];$export=json_decode(wzf_mascot_template_export($config,'legacy_character',wzf_mascot_config_version($config)),true);
        $cat['motions'][]=['id'=>'duplicate-file','file'=>'motion/greet.motion3.json'];file_put_contents($root.'catalog.json',json_encode($cat));
        $duplicate=false;try{wzf_mascot_template_plan($config,'legacy_character',wzf_mascot_config_version($config),$raw,'dialogue-presets');}catch(Throwable $e){$duplicate=true;}
        $export_duplicate=false;try{wzf_mascot_template_export($config,'legacy_character',wzf_mascot_config_version($config));}catch(Throwable $e){$export_duplicate=true;}
        echo json_encode(['mapping'=>$r['plan']['mapping'],'presets'=>$config['characters']['legacy_character']['presets'],'export'=>$export,'duplicate'=>$duplicate,'exportDuplicate'=>$export_duplicate]);
        ''')
        self.assertTrue(result['duplicate']);self.assertTrue(result['exportDuplicate']);self.assertEqual(result['presets'][0]['motion'],'01');self.assertEqual(result['presets'][0]['expression'],'smile')
        self.assertEqual(result['export']['presets'][0]['expressionFile'],'expression/a.exp3.json');self.assertEqual(len(result['mapping']),2)

    def test_template_missing_mapping_and_bound_hits_reject_without_mutation(self):
        for mutation in ["$template['presets']=[['id'=>'hello','name'=>'Hello','motionFile'=>'missing.motion3.json','expressionFile'=>'','line'=>'Hello']];",
                         "$options[WZF_MASCOT_OPTION]['characters']['legacy_character']['hitBindings']=[['area'=>'Head','preset'=>'hello']];"]:
            result=self.php(self.helper.settings_setup()+self.transfer_setup()+mutation+'''
            $before=$options;$failed=false;try{wzf_mascot_template_preview('legacy_character',wzf_mascot_config_version($options[WZF_MASCOT_OPTION]),json_encode($template),'dialogue-presets');}catch(Throwable $e){$failed=true;}
            echo json_encode(['failed'=>$failed,'same'=>$before===$options]);
            ''')
            self.assertTrue(result['failed']);self.assertTrue(result['same'])

    def test_template_signature_scope_payload_id_time_confirmation_and_version(self):
        mutations=["$r['payload'].=' ';", "$r['scope']='dialogue-presets';", "$r['character']='other';", "$r['issued']=(string)(time()-901);$r['signature']=wzf_mascot_template_signature($r['character'],$r['version'],$r['payload'],$r['scope'],$r['issued']);",
                   "$r['issued']=(string)(time()+5);$r['signature']=wzf_mascot_template_signature($r['character'],$r['version'],$r['payload'],$r['scope'],$r['issued']);", "$confirm='';", "$allowed=false;", "$options[WZF_MASCOT_OPTION]['marker']='concurrent';"]
        for mutation in mutations:
            result=self.php(self.transfer_setup()+'''
            $options[WZF_MASCOT_OPTION]=['characters'=>['text'=>['root'=>'missing/']]];$version=wzf_mascot_config_version($options[WZF_MASCOT_OPTION]);
            $r=wzf_mascot_template_preview('text',$version,$raw,'dialogue');$confirm='1';
            '''+mutation+'''
            $before=$options;$failed=false;try{wzf_mascot_template_apply($r['character'],$r['version'],$r['payload'],$r['scope'],$r['issued'],$r['signature'],$confirm);}catch(Throwable $e){$failed=true;}
            echo json_encode(['failed'=>$failed,'same'=>$before===$options,'guard'=>file_exists(wzf_mascot_uploads()['path'].'/'.WZF_MASCOT_GUARD_FILE)]);
            ''')
            self.assertTrue(result['failed'],mutation);self.assertTrue(result['same']);self.assertFalse(result['guard'])

    def test_template_fresh_revalidation_busy_guard_and_failed_write(self):
        for mutation in ["$write_fail=true;", "$guard=wzf_mascot_task_guard(true);flock($guard,LOCK_EX);", "$database_before_read=function($n){global $options;if($n===3)$options[WZF_MASCOT_OPTION]['marker']='changed-under-lock';};$wpdb->reads=0;"]:
            result=self.php(self.transfer_setup()+'''
            $options[WZF_MASCOT_OPTION]=['characters'=>['text'=>['root'=>'missing/']]];$version=wzf_mascot_config_version($options[WZF_MASCOT_OPTION]);
            $r=wzf_mascot_template_preview('text',$version,$raw,'dialogue');
            '''+mutation+'''
            $failed=false;try{wzf_mascot_template_apply('text',$version,$r['payload'],$r['scope'],$r['issued'],$r['signature'],'1');}catch(Throwable $e){$failed=true;}
            echo json_encode(['failed'=>$failed,'unchanged'=>!isset($options[WZF_MASCOT_OPTION]['characters']['text']['dialogue'])]);
            ''')
            self.assertTrue(result['failed'],mutation);self.assertTrue(result['unchanged'])

    def test_template_http_handlers_require_nonce_and_permissions(self):
        for handler in ['wzf_mascot_template_export_post','wzf_mascot_template_apply_post','wzf_mascot_template_preview_gate']:
            setup="$_GET=['page'=>'wzf-mascot','mascot_template_preview'=>'1'];"
            for denied in ['', '$allowed=false;']:
                result=self.php(setup+denied+handler+'();')
                self.assertFalse(result['ok'])


    def test_template_signed_payload_survives_native_form_newline_normalization(self):
        result=self.php(self.transfer_setup()+'''
        $options[WZF_MASCOT_OPTION]=['characters'=>['text'=>['root'=>'missing/']]];
        $version=wzf_mascot_config_version($options[WZF_MASCOT_OPTION]);
        $export=wzf_mascot_template_export($options[WZF_MASCOT_OPTION],'text',$version);
        $r=wzf_mascot_template_preview('text',$version,$raw,'dialogue');
        $posted=preg_replace("/\\r\\n|\\r|\\n/", "\\r\\n", $r['payload']);
        wzf_mascot_template_apply('text',$version,$posted,$r['scope'],$r['issued'],$r['signature'],'1');
        echo json_encode(['sameBytes'=>$posted===$r['payload'],'compact'=>strpos($r['payload'],"\\n")===false && strpos($r['payload'],"\\r")===false,'readableExport'=>strpos($export,"\\n")!==false,'saved'=>$options[WZF_MASCOT_OPTION]['characters']['text']['dialogue']['welcome']['lines']]);
        ''')
        self.assertTrue(result['sameBytes']);self.assertTrue(result['compact']);self.assertTrue(result['readableExport'])
        self.assertEqual(result['saved'],['New welcome'])
