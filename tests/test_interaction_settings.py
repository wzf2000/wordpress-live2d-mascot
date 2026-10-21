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
