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
