"""Bounded read-only inventory, administrator filtering and gettext regressions."""
import gettext
import json
from pathlib import Path
import unittest
import test_importer

ROOT = Path(__file__).resolve().parents[1]
STATE = '''
define('ARRAY_A', 'ARRAY_A');
function wp_unslash($value) {return $value;}
function maybe_unserialize($value) {return unserialize($value);}
class InventoryDatabase {
    public $options = 'stub_options'; public $last_error = ''; public $reads = 0;
    function prepare($sql, ...$args) {return $sql;}
    function get_results(...$args) {
        global $options, $concurrent;
        $this->reads++;
        if ($this->reads === 2 && isset($concurrent)) $options = $concurrent;
        $rows = [];
        foreach ([WZF_MASCOT_OPTION, WZF_MASCOT_LOCK] as $key)
            if (array_key_exists($key, $options)) $rows[] = ['option_name'=>$key,'option_value'=>serialize($options[$key])];
        return $rows;
    }
}
$wpdb = new InventoryDatabase();
'''


class AdminInventoryTests(unittest.TestCase):
    def setUp(self):
        self.helper = test_importer.ImporterTests()
        self.helper.setUp()

    def tearDown(self): self.helper.tearDown()

    def php(self, body): return self.helper.php(STATE + body)

    def setup(self):
        return self.helper.settings_setup() + '''
        unset($options[WZF_MASCOT_OPTION]['presentation']);
        file_put_contents($u['path'].'/core.js','synthetic non-executable Core');
        $options[WZF_MASCOT_OPTION]['core']=['path'=>'core.js','sha256'=>WZF_MASCOT_CORE_SHA];
        file_put_contents($u['path'].'/'.$c['root'].'motion/extra.motion3.json','{"Version":3}');
        $options[WZF_MASCOT_OPTION]['characters']['disabled'] = array_replace($c,['status'=>'disabled']);
        $options[WZF_MASCOT_OPTION]['characters']['trash'] = array_replace($c,['status'=>'trash']);
        $options[WZF_MASCOT_OPTION]['history']['legacy_character'] = $c;
        file_put_contents($u['path'].'/unreferenced.bin','extra');
        '''

    def test_whole_model_directories_history_and_shared_refs_protected(self):
        result = self.php(self.setup() + '''
        $before=$options;$report=wzf_mascot_disk_inventory($options[WZF_MASCOT_OPTION]);
        echo json_encode(['report'=>$report,'unchanged'=>$before===$options]);''')
        self.assertTrue(result['unchanged'])
        report = result['report']; self.assertTrue(report['complete']); self.assertTrue(report['referencesComplete'])
        rows = {row['path']: row['kind'] for row in report['paths']}
        self.assertIn('current-model', next(kind for path, kind in rows.items() if path.endswith('extra.motion3.json')))
        self.assertIn('previous-model', next(kind for path, kind in rows.items() if path.endswith('extra.motion3.json')))
        self.assertEqual(rows['unreferenced.bin'], 'unreferenced')
        self.assertEqual(rows['index.html'], 'directory-guard')
        self.assertTrue(any(ref['characterId'] == 'disabled' for ref in report['references']))

    def test_missing_null_invalid_and_symlink_refs_withhold_unreferenced(self):
        for change in ["$options[WZF_MASCOT_OPTION]['characters']=null;", "unset($options[WZF_MASCOT_OPTION]['characters']);", "$options[WZF_MASCOT_OPTION]=false;", "$options[WZF_MASCOT_OPTION]['history']=null;", "$options[WZF_MASCOT_OPTION]['characters']['legacy_character']['root']='../outside/';", "$options[WZF_MASCOT_OPTION]['characters']['legacy_character']['root']='missing/';", "symlink('/tmp',$u['path'].'/external');"]:
            with self.subTest(change=change):
                report = self.php(self.setup() + change + "echo json_encode(wzf_mascot_disk_inventory($options[WZF_MASCOT_OPTION]));")
                self.assertFalse(report['complete'] and report['referencesComplete'])
                self.assertNotIn('unreferenced', [row['kind'] for row in report['paths']])
                self.assertFalse(any(row['path'].startswith('external/') for row in report['paths']))

    def test_nested_migration_roots_and_thumbnails(self):
        report = self.php(self.setup() + '''
        mkdir($u['path'].'/nested');mkdir($u['path'].'/nested/child');file_put_contents($u['path'].'/nested/child/extra','x');
        $options[WZF_MASCOT_OPTION]['characters']['disabled']['root']='nested/';
        $options[WZF_MASCOT_OPTION]['history']['legacy_character']['root']='nested/child/';
        file_put_contents($u['path'].'/preview.png','thumbnail');
        $options[WZF_MASCOT_OPTION]['characters']['trash']['thumbnail']='preview.png';
        $options[WZF_MASCOT_OPTION]['history']['legacy_character']['thumbnail']='preview.png';
        echo json_encode(wzf_mascot_disk_inventory($options[WZF_MASCOT_OPTION]));''')
        rows = {row['path']: row['kind'] for row in report['paths']}
        self.assertIn('current-model', rows['nested/child/extra']); self.assertIn('previous-model', rows['nested'])
        self.assertEqual(rows['preview.png'], 'current-thumbnail, previous-thumbnail')

    def test_hardlinks_count_logical_bytes_and_staging_preserved(self):
        report = self.php("$u=wzf_mascot_uploads(true);$options[WZF_MASCOT_OPTION]=['characters'=>[]];" + '''
        file_put_contents($u['path'].'/one','1234');link($u['path'].'/one',$u['path'].'/two');
        mkdir($u['path'].'/stage-synthetic');file_put_contents($u['path'].'/stage-synthetic/data','x');
        echo json_encode(wzf_mascot_disk_inventory($options[WZF_MASCOT_OPTION]));''')
        self.assertEqual(report['hardlinkedFiles'], 2)
        self.assertEqual(next(row['bytes'] for row in report['paths'] if row['path'] == 'two'), 4)
        self.assertEqual(next(row['kind'] for row in report['paths'] if row['path'] == 'stage-synthetic/data'), 'staging')

    def test_bounds_and_display_truncation_are_distinct(self):
        for limit in ["['entries'=>1]", "['seconds'=>0.001,'entries'=>1]"]:
            report = self.php(self.setup() + "echo json_encode(wzf_mascot_disk_inventory($options[WZF_MASCOT_OPTION]," + limit + "));")
            self.assertFalse(report['complete']); self.assertNotIn('unreferenced', [row['kind'] for row in report['paths']])
        report = self.php(self.setup() + "echo json_encode(wzf_mascot_disk_inventory($options[WZF_MASCOT_OPTION],['rows'=>1]));")
        self.assertTrue(report['complete']); self.assertTrue(report['displayTruncated']); self.assertEqual(len(report['paths']), 1)

    def test_concurrent_uncached_config_and_lock_changes_are_unknown(self):
        for mutation in ["$concurrent[WZF_MASCOT_OPTION]['changed']=true;", "$concurrent[WZF_MASCOT_LOCK]=['token'=>'other'];"]:
            report = self.php(self.setup() + '$concurrent=$options;' + mutation + "echo json_encode(wzf_mascot_disk_inventory($options[WZF_MASCOT_OPTION]));")
            self.assertFalse(report['complete']); self.assertFalse(report['referencesComplete'])
            self.assertNotIn('unreferenced', [row['kind'] for row in report['paths']])

    def test_empty_install_and_file_at_resource_root(self):
        report = self.php("echo json_encode(wzf_mascot_disk_inventory(['characters'=>[]]));")
        self.assertTrue(report['complete']); self.assertEqual(report['files'], 0)
        report = self.php("mkdir(getenv('TEST_UPLOADS'),0755,true);file_put_contents(getenv('TEST_UPLOADS').'/wzf-mascot','bad');echo json_encode(wzf_mascot_disk_inventory(['characters'=>[]]));")
        self.assertFalse(report['complete']); self.assertFalse(report['referencesComplete'])

    def test_capability_nonce_and_get_without_scan(self):
        report = self.php("$allowed=false;echo json_encode(wzf_mascot_disk_inventory(['characters'=>[]]));")
        self.assertFalse(report['ok'])
        report = self.php("$_GET['page']='wzf-mascot';$_POST['mascot_inventory']='1';wzf_mascot_inventory_gate();echo json_encode(['ok'=>true]);")
        self.assertFalse(report['ok']); self.assertEqual(report['error'], 'nonce rejected')
        report = self.php("$_GET['page']='wzf-mascot';wzf_mascot_inventory_gate();echo json_encode(['reads'=>$wpdb->reads]);")
        self.assertEqual(report['reads'], 0)

    def test_search_filters_invalid_input_and_preserved_data(self):
        result = self.php(self.setup() + '''
        $before=$options;$characters=$options[WZF_MASCOT_OPTION]['characters'];$characters['broken']=false;
        $characters['unicode']=array_replace($c,['name'=>'测试角色']);$rows=wzf_mascot_display_report(['characters'=>$characters]);
        $out=[];foreach(['all','active','disabled','trash','isolated','ready'] as $filter) $out[$filter]=array_keys(wzf_mascot_character_listing($characters,$rows,['mascot_status'=>$filter])['characters']);
        $out['name']=array_keys(wzf_mascot_character_listing($characters,$rows,['mascot_search'=>'测试'])['characters']);
        $out['id']=array_keys(wzf_mascot_character_listing($characters,$rows,['mascot_search'=>'LEGACY'])['characters']);
        $out['invalid']=wzf_mascot_character_listing($characters,$rows,['mascot_search'=>[],'mascot_status'=>[]])['filter'];
        echo json_encode(['result'=>$out,'unchanged'=>$options===$before]);''')
        self.assertTrue(result['unchanged']); rows = result['result']
        self.assertEqual(rows['isolated'], ['broken']); self.assertEqual(rows['disabled'], ['disabled']); self.assertEqual(rows['trash'], ['trash'])
        self.assertEqual(rows['name'], ['unicode']); self.assertEqual(rows['id'], ['legacy_character']); self.assertEqual(rows['invalid'], 'all')

    def test_locales_and_interpolation_and_safe_error(self):
        for locale, expected in [('en_US','Disk inventory'),('zh_CN','磁盘资源盘点')]:
            with (ROOT / 'plugin/languages' / ('live2d-show-' + locale + '.mo')).open('rb') as stream: tr = gettext.GNUTranslations(stream)
            self.assertEqual(tr.gettext('Disk inventory'), expected)
            self.assertIn('%1$s', tr.gettext('Using %1$s; this browser will remember your selection.'))
        result = self.php("echo json_encode(['type'=>wzf_mascot_error_message(new TypeError('/private/secret')), 'json'=>wzf_mascot_error_message(new JsonException('private parse error')), 'upload'=>wzf_mascot_upload_error(UPLOAD_ERR_INI_SIZE), 'dictionary'=>wzf_mascot_frontend_translations()]);")
        self.assertNotIn('/private', result['type']); self.assertNotIn('private parse', result['json']); self.assertIn('upload_max_filesize', result['upload'])
        self.assertEqual(result['dictionary']['Using %1$s; this browser will remember your selection.'], 'Using %1$s; this browser will remember your selection.');
        self.assertEqual(result['dictionary']['Show mascot'], 'Show mascot'); self.assertNotIn('Disk inventory', result['dictionary'])


if __name__ == '__main__': unittest.main()
