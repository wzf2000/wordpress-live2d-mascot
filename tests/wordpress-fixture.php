<?php
// Synthetic fixtures only. Invoked by the guarded integration runner through WP-CLI.
if (!defined('ABSPATH') || wp_get_environment_type() !== 'local' || !str_starts_with(ABSPATH, '/tmp/mascot-ci-') || !is_file(dirname(rtrim(ABSPATH, '/')) . '/mascot-ci-owner')) throw new RuntimeException('Synthetic lab required.');
$mode = getenv('MASCOT_CI_MODE');
if ($mode === 'seed') {
    $u = wzf_mascot_uploads(true);
    mkdir($u['path'] . '/core-synthetic');
    file_put_contents($u['path'] . '/core-synthetic/core.js', '// Synthetic non-executable fixture; not Cubism Core.');
    $c = get_option(WZF_MASCOT_OPTION);
    // Metadata permits testing server output only. Production hash constants and
    // the Core import validator are unchanged; this fixture cannot render a model.
    $c['core'] = ['path'=>'core-synthetic/core.js','sha256'=>WZF_MASCOT_CORE_SHA];
    $original = $c['characters']['fixture'];
    $root = $u['path'] . '/' . $original['root'];
    $hit_model = json_decode(file_get_contents($root . $original['file']), true);
    $hit_model['HitAreas'] = [['Name'=>'Head [synthetic]', 'Id'=>'synthetic-head']];
    file_put_contents($root . $original['file'], json_encode($hit_model));
    file_put_contents($root . 'motion/extra.motion3.json', '{"Version":3}');
    $catalog = json_decode(file_get_contents($root . 'catalog.json'), true);
    $catalog['motions'][] = ['id'=>'01_extra','file'=>'motion/extra.motion3.json','label'=>'Extra maintained action'];
    file_put_contents($root . 'catalog.json', json_encode($catalog));
    $c['characters']['legacy_character'] = $original;
    $c['characters'][23] = $original;
    $c['characters']['legacy_character']['welcome'] = '01_extra';
    $c['characters']['legacy_character']['greetings'] = ['01_extra'];
    $c['characters']['legacy_character']['termsAnchor'] = 'synthetic-owner';
    $c['characters']['legacy_character']['renderScale'] = 1.1;
    $c['retainedMarker'] = ['privateSetting'=>'synthetic-only'];
    file_put_contents($u['path'] . '/terms.html', '<html>Synthetic terms</html>');
    $c['presentation'] = ['terms'=>'terms.html','termsVersion'=>'synthetic-v1','consentText'=>'Synthetic local consent'];
    update_option(WZF_MASCOT_OPTION, $c, false);
} elseif ($mode === 'inventory-review') {
    $root = wzf_mascot_uploads()['path'];
    $old = time() - 40 * DAY_IN_SECONDS;
    foreach (['review-old', 'review-recent', 'core-retained-old'] as $name) {
        mkdir($root . '/' . $name);
        file_put_contents($root . '/' . $name . '/synthetic.txt', 'Synthetic review bytes only.');
        touch($root . '/' . $name . '/synthetic.txt', $old);
        touch($root . '/' . $name, $old);
    }
    // Old directory metadata must not hide a newly modified descendant.
    touch($root . '/review-recent/synthetic.txt', time());
    mkdir($root . '/review-parent'); mkdir($root . '/review-parent/core-old');
    file_put_contents($root . '/review-parent/core-old/synthetic.txt', 'Nested protected bytes.');
    foreach (['review-parent/core-old/synthetic.txt', 'review-parent/core-old', 'review-parent'] as $path) touch($root . '/' . $path, $old);
} elseif ($mode === 'state') {
    echo wp_json_encode(['config'=>get_option(WZF_MASCOT_OPTION),'lock'=>get_option(WZF_MASCOT_LOCK), 'version'=>wzf_mascot_config_version(get_option(WZF_MASCOT_OPTION))]);
} elseif ($mode === 'task-abandon') {
    wp_set_current_user(get_user_by('login', 'mascot-admin')->ID);
    wzf_mascot_task_begin('settings'); // Process exit releases flock, leaves record.
} elseif ($mode === 'task-legacy') {
    add_option(WZF_MASCOT_LOCK, ['token'=>'synthetic-legacy', 'started'=>1], '', false);
} elseif ($mode === 'task-change') {
    $record = get_option(WZF_MASCOT_LOCK); $record['token'] = bin2hex(random_bytes(16));
    update_option(WZF_MASCOT_LOCK, $record, false);
} elseif ($mode === 'task-clear') {
    delete_option(WZF_MASCOT_LOCK); // Explicit synthetic fixture cleanup only.
} elseif ($mode === 'task-cache-check') {
    wp_set_current_user(get_user_by('login', 'mascot-admin')->ID);
    get_option(WZF_MASCOT_OPTION); get_option(WZF_MASCOT_LOCK);
    // Prewarm stale request caches, then emulate a previously finished writer.
    $old = get_option(WZF_MASCOT_OPTION); $next = $old; $next['syntheticConcurrent'] = true;
    update_option(WZF_MASCOT_OPTION, $next, false);
    wp_cache_set(WZF_MASCOT_OPTION, $old, 'options');
    $rejected = false;
    try { wzf_mascot_save_mobile(wzf_mascot_config_version($old), true, true); }
    catch (RuntimeException $e) { $rejected = str_contains($e->getMessage(), 'changed'); }
    $fresh = wzf_mascot_task_snapshot();
    echo wp_json_encode(['rejected'=>$rejected, 'retained'=>$fresh['config']===$next, 'lock'=>$fresh['exists']]);
} elseif ($mode === 'restore') {
    update_option(WZF_MASCOT_OPTION, json_decode(file_get_contents(getenv('MASCOT_CI_SNAPSHOT')), true), false);
} elseif ($mode === 'fault') {
    $c = get_option(WZF_MASCOT_OPTION); $good = $c['characters']['legacy_character'];
    $c['characters']['bad-root'] = array_replace($good, ['root'=>['broken']]);
    $c['characters']['bad-file'] = array_replace($good, ['file'=>'../escape.model3.json']);
    $c['characters']['missing'] = array_replace($good, ['root'=>'missing/']);
    $c['characters']['bad-name'] = array_replace($good, ['name'=>['broken']]);
    $c['characters']['bad-state'] = array_replace($good, ['status'=>['broken']]);
    $c['characters']['bad-greetings'] = array_replace($good, ['greetings'=>'broken']);
    $c['characters']['not-array'] = 'broken';
    $u = wzf_mascot_uploads(); symlink($u['path'].'/'.$good['root'], $u['path'].'/linked');
    $c['characters']['linked'] = array_replace($good, ['root'=>'linked/']);
    update_option(WZF_MASCOT_OPTION, $c, false);
} elseif ($mode === 'all-bad') {
    $c = get_option(WZF_MASCOT_OPTION);
    foreach ($c['characters'] as &$row) $row = ['root'=>[]]; unset($row);
    update_option(WZF_MASCOT_OPTION, $c, false);
} elseif ($mode === 'bad-core' || $mode === 'bad-terms' || $mode === 'bad-structure') {
    $c = get_option(WZF_MASCOT_OPTION);
    if ($mode === 'bad-core') $c['core']['sha256'] = str_repeat('0', 64);
    if ($mode === 'bad-terms') $c['presentation']['terms'] = '../terms.html';
    if ($mode === 'bad-structure') $c['characters'] = 'broken';
    update_option(WZF_MASCOT_OPTION, $c, false);
} elseif ($mode === 'diagnose') {
    wp_set_current_user(get_user_by('login', 'mascot-admin')->ID);
    echo wp_json_encode(wzf_mascot_diagnose_resources(get_option(WZF_MASCOT_OPTION)));
} else throw new RuntimeException('Unknown synthetic operation.');
