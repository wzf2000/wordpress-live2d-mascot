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
} elseif ($mode === 'state') {
    echo wp_json_encode(['config'=>get_option(WZF_MASCOT_OPTION),'lock'=>get_option(WZF_MASCOT_LOCK), 'version'=>wzf_mascot_config_version(get_option(WZF_MASCOT_OPTION))]);
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
