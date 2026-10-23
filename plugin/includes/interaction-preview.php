<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;

function wzf_mascot_preview_draft($character, $raw) {
    if (!is_string($raw) || strlen($raw) > 65536) throw new RuntimeException(__('Interaction draft is invalid.', 'live2d-show'));
    try { $draft = json_decode(json_encode(wzf_mascot_interaction_json($raw), JSON_THROW_ON_ERROR), true, 12, JSON_THROW_ON_ERROR); }
    catch (Throwable $e) { throw new RuntimeException(__('Interaction draft is invalid.', 'live2d-show')); }
    if (!is_array($draft) || !$draft || array_diff(array_keys($draft), ['dialogue','presets'])) throw new RuntimeException(__('Interaction draft is invalid.', 'live2d-show'));
    if (array_key_exists('dialogue', $draft)) {
        if (!is_array($draft['dialogue']) || array_diff(array_keys($draft['dialogue']), array_keys(wzf_mascot_line_events()))) throw new RuntimeException(__('Dialogue settings are invalid.', 'live2d-show'));
        foreach ($draft['dialogue'] as $event=>$rule) {
            if (!is_array($rule) || array_diff(array_keys($rule), $event === 'idle' ? ['enabled','cooldown','lines','motions'] : ['enabled','cooldown','lines'])) throw new RuntimeException(__('Dialogue settings are invalid.', 'live2d-show'));
        }
        $character = wzf_mascot_dialogue_patch($character, $draft['dialogue']);
    }
    if (array_key_exists('presets', $draft)) $character = wzf_mascot_presets_patch($character, $draft['presets']);
    return $character;
}
function wzf_mascot_preview_plan($config, $id, $version, $raw) {
    $character = wzf_mascot_template_character($config, $id, $version);
    $character = wzf_mascot_preview_draft($character, $raw);
    $uploads = wzf_mascot_uploads();
    $root = wzf_mascot_character_display_check($id, $character, $uploads);
    $core = wzf_mascot_path($config['core']['path'] ?? null);
    $file = wzf_mascot_no_links($uploads['path'] . '/' . $core);
    if (($config['core']['sha256'] ?? null) !== WZF_MASCOT_CORE_SHA || !is_file($file) || !is_readable($file) || filesize($file) < 1 || filesize($file) > 8*1024*1024) throw new RuntimeException(__('Import the verified Core before previewing.', 'live2d-show'));
    $assets = json_decode(file_get_contents(dirname(__DIR__) . '/haru-assets.json'), true, 16, JSON_THROW_ON_ERROR);
    foreach (['engine','shaders','terms'] as $key) wzf_mascot_path(rtrim($assets[$key] ?? '', '/'));
    $base = plugins_url('', dirname(__DIR__) . '/live2d-show.php') . '/';
    $presentation = wzf_mascot_presentation($config, $uploads);
    $terms = $presentation['terms'] ?? $base . $assets['terms'];
    if (!isset($presentation['terms']) && !is_readable(dirname(__DIR__) . '/' . $assets['terms'])) throw new RuntimeException(__('Site terms file is invalid.', 'live2d-show'));
    $options = array_intersect_key($character, array_flip(['file','idle','welcome','greetings','size','offset','renderScale','renderX','renderY']));
    return ['name'=>$character['name'] ?? $id, 'root'=>$uploads['url'] . $root . '/', 'core'=>$uploads['url'] . $core,
        'engine'=>$base . $assets['engine'], 'shaders'=>$base . $assets['shaders'], 'terms'=>$terms, 'options'=>$options,
        'eventLabels'=>wzf_mascot_line_events(), 'dialogue'=>wzf_mascot_dialogue($character['dialogue'] ?? []), 'presets'=>wzf_mascot_current_presets($character),
        'motionCount'=>count(wzf_mascot_character_catalog($character)), 'expressionCount'=>count(wzf_mascot_character_expressions($character))];
}
function wzf_mascot_preview_labels() {
    return ['title'=>__('Unsaved interaction preview', 'live2d-show'), 'start'=>__('Start preview', 'live2d-show'),
        'stop'=>__('End preview', 'live2d-show'), 'pause'=>__('Pause', 'live2d-show'), 'resume'=>__('Resume', 'live2d-show'),
        'terms'=>__('Check resource terms', 'live2d-show'), 'ready'=>__('Choose a draft rule or preset to try.', 'live2d-show'),
        'loading'=>__('Loading preview…', 'live2d-show'), 'idle'=>__('Nothing is loaded until you start. Changes remain unsaved.', 'live2d-show'),
        'ended'=>__('Preview ended.', 'live2d-show'), 'failed'=>__('Preview could not load. Check the installed resources and try again.', 'live2d-show'),
        'try'=>__('Simulate trigger', 'live2d-show'), 'none'=>__('No draft lines or presets are available.', 'live2d-show'),
        'noMotion'=>__('No associated motion; showing text only.', 'live2d-show'),
        'disabled'=>__('This rule is disabled.', 'live2d-show'), 'empty'=>__('This rule has no lines.', 'live2d-show'),
        'welcome'=>__('Welcome takes priority over the time-of-day rule. Both run only on the first display.', 'live2d-show'),
        'chatter'=>__('Automatic chatter requires an enabled rule, reader opt-in and automatic dialogue mode.', 'live2d-show'),
        'rules'=>__('Rule notes', 'live2d-show'), 'capabilities'=>__('Runtime capabilities', 'live2d-show'), 'gaze'=>__('Gaze parameters', 'live2d-show'), 'hits'=>__('Hit areas', 'live2d-show'),
        'motions'=>__('Motions', 'live2d-show'), 'expressions'=>__('Expressions', 'live2d-show')];
}
function wzf_mascot_preview_document($plan) {
    $plan['labels'] = wzf_mascot_preview_labels();
    $base = plugins_url('', dirname(__DIR__) . '/live2d-show.php') . '/';
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="' . esc_url($base . 'admin.css?ver=3.11.0-rc.1') . '"></head><body class="wzf-mascot-admin"><main class="wzf-mascot-preview-root"></main><script id="wzf-mascot-preview-data" type="application/json">' . wp_json_encode($plan, JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT) . '</script><script src="' . esc_url($base . 'interaction-preview.js?ver=3.11.0-rc.1') . '" defer></script></body></html>';
}
function wzf_mascot_preview_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_interaction_preview');
    try {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || array_diff(array_keys($_POST), ['action','_wpnonce','character','version','draft'])) throw new RuntimeException(__('Interaction draft is invalid.', 'live2d-show'));
        $fields = wzf_mascot_template_post_fields(['character','version','draft']);
        $plan = wzf_mascot_preview_plan(wzf_mascot_task_snapshot()['config'], $fields['character'], $fields['version'], $fields['draft']);
        nocache_headers(); header('Content-Type: text/html; charset=UTF-8'); header('X-Content-Type-Options: nosniff');
        echo wzf_mascot_preview_document($plan);
    } catch (Throwable $e) { wp_send_json_error(['message'=>wzf_mascot_error_message($e)], 400); }
    exit;
}
function wzf_mascot_preview_button($id, $config) {
    echo '<button type="button" class="button wzf-mascot-preview-draft" data-nonce="' . esc_attr(wp_create_nonce('wzf_mascot_interaction_preview')) . '" data-endpoint="' . esc_url(admin_url('admin-post.php')) . '" data-title="' . esc_attr__('Unsaved interaction preview', 'live2d-show') . '" data-close="' . esc_attr__('Close preview', 'live2d-show') . '" data-loading="' . esc_attr__('Preparing preview…', 'live2d-show') . '" data-failed="' . esc_attr__('Preview could not load. Check the installed resources and try again.', 'live2d-show') . '">' . esc_html__('Try unsaved changes', 'live2d-show') . '</button>';
    echo '<p class="description">' . esc_html__('Preview uses this form’s current values without saving them.', 'live2d-show') . '</p>';
}
add_action('admin_post_wzf_mascot_interaction_preview', 'wzf_mascot_preview_post');
