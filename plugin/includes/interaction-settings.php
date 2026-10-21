<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;

function wzf_mascot_line_events() {
    return ['welcome'=>__('Welcome', 'live2d-show'), 'click'=>__('Click', 'live2d-show'), 'morning'=>__('Morning', 'live2d-show'), 'afternoon'=>__('Afternoon', 'live2d-show'), 'evening'=>__('Evening', 'live2d-show'), 'return'=>__('Return after absence', 'live2d-show')];
}
// Optional presentation never participates in whole-character isolation.
function wzf_mascot_dialogue($value, $strict = false) {
    $result = [];
    foreach (wzf_mascot_line_events() as $event=>$label) {
        try {
            $rule = is_array($value) ? ($value[$event] ?? []) : [];
            if (!is_array($rule)) throw new RuntimeException(__('Dialogue settings are invalid.', 'live2d-show'));
            $enabled = $rule['enabled'] ?? false;
            $cooldown = $rule['cooldown'] ?? 60;
            if (!is_bool($enabled) || !is_int($cooldown) || $cooldown < 15 || $cooldown > 3600) throw new RuntimeException(__('Dialogue cooldown must be 15–3600 seconds.', 'live2d-show'));
            $lines = wzf_mascot_list($rule['lines'] ?? [], 'Lines');
            if (count($lines) > 8) throw new RuntimeException(__('Use up to 8 plain-text lines per event, each at most 300 bytes.', 'live2d-show'));
            $valid = [];
            foreach ($lines as $line) {
                $line = trim(wzf_mascot_plain_text($line, 300));
                if ($line !== '') $valid[] = $line;
            }
            $result[$event] = ['enabled'=>$enabled && !!$valid, 'cooldown'=>$cooldown, 'lines'=>array_values(array_unique($valid))];
        } catch (Throwable $e) { if ($strict) throw $e; }
    }
    return $result;
}
function wzf_mascot_save_interaction($id, $version, $dialogue) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    if (!is_string($id) || !is_string($version) || !preg_match('/\A[0-9a-f]{64}\z/D', $version) || !is_array($dialogue)) throw new RuntimeException(__('Dialogue settings are invalid.', 'live2d-show'));
    $dialogue = wzf_mascot_dialogue($dialogue, true);
    $task = wzf_mascot_task_begin('settings');
    try {
        $config = $task['config'];
        if (!hash_equals(wzf_mascot_config_version($config), $version)) throw new RuntimeException(__('Another request changed the resource configuration. Refresh before editing again.', 'live2d-show'));
        if (!is_array($config['characters'][$id] ?? null)) throw new RuntimeException(__('The character does not exist or its configuration is invalid.', 'live2d-show'));
        if (($config['characters'][$id]['dialogue'] ?? null) === $dialogue) return;
        $config['characters'][$id]['dialogue'] = $dialogue;
        if (!update_option(WZF_MASCOT_OPTION, $config, false)) throw new RuntimeException(__('Cannot save character settings.', 'live2d-show'));
    } finally { wzf_mascot_task_end($task); }
}
function wzf_mascot_interaction_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_interaction');
    $id = is_string($_POST['character'] ?? null) ? wp_unslash($_POST['character']) : '';
    try {
        $rules = [];
        foreach (wzf_mascot_line_events() as $event=>$label) {
            $row = $_POST['dialogue'][$event] ?? [];
            if (!is_array($row) || !is_string($row['lines'] ?? null) || strlen($row['lines']) > 2408 || !is_string($row['cooldown'] ?? null) || !preg_match('/\A[0-9]{1,4}\z/D', $row['cooldown']) || (isset($row['enabled']) && $row['enabled'] !== '1')) throw new RuntimeException(__('Dialogue settings are invalid.', 'live2d-show'));
            $rules[$event] = ['enabled'=>isset($row['enabled']), 'cooldown'=>(int)$row['cooldown'], 'lines'=>preg_split('/\r\n|\r|\n/', wp_unslash($row['lines']))];
        }
        wzf_mascot_save_interaction($id, is_string($_POST['version'] ?? null) ? wp_unslash($_POST['version']) : '', $rules);
        $notice = __('Dialogue settings saved.', 'live2d-show');
    } catch (Throwable $e) { $notice = wzf_mascot_error_message($e); }
    wp_safe_redirect(add_query_arg(['mascot_notice'=>rawurlencode($notice), 'character'=>$id], admin_url('options-general.php?page=wzf-mascot')));
    exit;
}
function wzf_mascot_interaction_panel($config, $id) {
    $rules = wzf_mascot_dialogue($config['characters'][$id]['dialogue'] ?? []);
    echo '<section class="wzf-mascot-card"><h2>' . esc_html__('Character dialogue', 'live2d-show') . '</h2><p class="description">' . esc_html__('Optional local text only. One alternative per line; up to 8 lines per event and 300 bytes per line. No periodic chatter. Return requires at least 60 seconds away. Readers can choose automatic, active only or silent.', 'live2d-show') . '</p><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    wp_nonce_field('wzf_mascot_interaction');
    echo '<input type="hidden" name="action" value="wzf_mascot_interaction"><input type="hidden" name="character" value="' . esc_attr($id) . '"><input type="hidden" name="version" value="' . esc_attr(wzf_mascot_config_version($config)) . '"><div class="wzf-mascot-fields">';
    foreach (wzf_mascot_line_events() as $event=>$label) {
        $rule = $rules[$event] ?? ['enabled'=>false,'cooldown'=>60,'lines'=>[]];
        $prefix = 'dialogue[' . $event . ']';
        echo '<fieldset class="wzf-mascot-field"><legend>' . esc_html($label) . '</legend><label><input type="checkbox" name="' . esc_attr($prefix . '[enabled]') . '" value="1" ' . checked($rule['enabled'], true, false) . '> ' . esc_html__('Enable dialogue', 'live2d-show') . '</label><label>' . esc_html__('Cooldown (seconds)', 'live2d-show') . '<input type="number" min="15" max="3600" required name="' . esc_attr($prefix . '[cooldown]') . '" value="' . esc_attr($rule['cooldown']) . '"></label><label>' . esc_html__('Alternative lines', 'live2d-show') . '<textarea rows="3" name="' . esc_attr($prefix . '[lines]') . '">' . esc_textarea(implode("\n", $rule['lines'])) . '</textarea></label></fieldset>';
    }
    echo '</div>'; submit_button(__('Save dialogue settings', 'live2d-show')); echo '</form></section>';
}
add_action('admin_post_wzf_mascot_interaction', 'wzf_mascot_interaction_post');

// Read expressions independently; optional preset failures never isolate a role.
function wzf_mascot_character_expressions($character) {
    $u = wzf_mascot_uploads();
    $root = wzf_mascot_no_links($u['path'] . '/' . wzf_mascot_path(rtrim($character['root'] ?? '', '/')));
    $catalog = wzf_mascot_json(@file_get_contents(wzf_mascot_no_links($root . '/catalog.json')));
    $items = wzf_mascot_list($catalog['expressions'] ?? [], 'Expressions');
    if (count($items) > 1000) throw new RuntimeException(__('Expression catalog is too large.', 'live2d-show'));
    $result = [];
    foreach ($items as $item) {
        $id = wzf_mascot_plain_text($item['id'] ?? null, 200, true);
        $file = wzf_mascot_path($item['file'] ?? null);
        $path = wzf_mascot_no_links($root . '/' . $file);
        if (isset($result[$id]) || !str_ends_with($file, '.exp3.json') || !is_file($path) || !is_readable($path) || filesize($path) > 8 * 1024 * 1024) throw new RuntimeException(__('Expression catalog is invalid.', 'live2d-show'));
        $result[$id] = ['file'=>$file, 'label'=>is_string($item['label'] ?? null) ? $item['label'] : $id];
    }
    return $result;
}
function wzf_mascot_presets($value, $motions, $expressions, $strict = false) {
    $result = []; $ids = [];
    if (!is_array($value) || !array_is_list($value) || count($value) > 8) {
        if ($strict) throw new RuntimeException(__('Use up to 8 interaction presets.', 'live2d-show'));
        return [];
    }
    foreach ($value as $row) {
        try {
            if (!is_array($row) || array_diff(array_keys($row), ['id','name','motion','expression','line'])) throw new RuntimeException(__('Interaction preset is invalid.', 'live2d-show'));
            $preset = [];
            foreach (['id'=>64,'name'=>80,'motion'=>200,'expression'=>200,'line'=>300] as $key=>$limit) $preset[$key] = trim(wzf_mascot_plain_text($row[$key] ?? '', $limit));
            if ($preset['name'] === '' && $preset['motion'] === '' && $preset['expression'] === '' && $preset['line'] === '') continue;
            if (!preg_match('/\A[a-z][a-z0-9-]{0,63}\z/D', $preset['id']) || isset($ids[$preset['id']]) || $preset['name'] === '' || ($preset['motion'] === '' && $preset['expression'] === '' && $preset['line'] === '')) throw new RuntimeException(__('A preset needs a name and at least one motion, expression or line.', 'live2d-show'));
            if (($motions !== null && $preset['motion'] !== '' && !isset($motions[$preset['motion']])) || ($expressions !== null && $preset['expression'] !== '' && !isset($expressions[$preset['expression']]))) throw new RuntimeException(__('Preset motion or expression is not in the current catalog.', 'live2d-show'));
            $ids[$preset['id']] = true; $result[] = $preset;
        } catch (Throwable $e) { if ($strict) throw $e; }
    }
    return $result;
}
function wzf_mascot_current_presets($character) {
    if (empty($character['presets'])) return [];
    try { $motions = wzf_mascot_character_catalog($character); } catch (Throwable $e) { $motions = []; }
    try { $expressions = wzf_mascot_character_expressions($character); } catch (Throwable $e) { $expressions = []; }
    return wzf_mascot_presets($character['presets'], $motions, $expressions);
}
function wzf_mascot_save_presets($id, $version, $presets) {
    wzf_mascot_locked_character($id, $version, function($config) use ($id, $presets) {
        $c = $config['characters'][$id];
        $next = wzf_mascot_presets($presets, wzf_mascot_character_catalog($c), wzf_mascot_character_expressions($c), true);
        if (($c['presets'] ?? []) === $next && empty($c['presetWarnings'])) return;
        $config['characters'][$id]['presets'] = $next;
        unset($config['characters'][$id]['presetWarnings']);
        if (!update_option(WZF_MASCOT_OPTION, $config, false)) throw new RuntimeException(__('Cannot save character settings.', 'live2d-show'));
    }, 'settings');
}
function wzf_mascot_presets_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_presets');
    $id = is_string($_POST['character'] ?? null) ? wp_unslash($_POST['character']) : '';
    try {
        wzf_mascot_save_presets($id, is_string($_POST['version'] ?? null) ? wp_unslash($_POST['version']) : '', wp_unslash($_POST['presets'] ?? []));
        $notice = __('Interaction presets saved.', 'live2d-show');
    } catch (Throwable $e) { $notice = wzf_mascot_error_message($e); }
    wp_safe_redirect(add_query_arg(['mascot_notice'=>rawurlencode($notice), 'character'=>$id], admin_url('options-general.php?page=wzf-mascot'))); exit;
}
function wzf_mascot_presets_panel($config, $id) {
    $c = $config['characters'][$id]; $presets = wzf_mascot_current_presets($c);
    echo '<section class="wzf-mascot-card"><h2>' . esc_html__('Quick interactions', 'live2d-show') . '</h2><p class="description">' . esc_html__('Up to 8 named combinations. Choose a motion, an expression, a plain-text line, or combine them. Leave all fields blank to remove a preset. Names: 80 bytes; lines: 300 bytes. Playback always starts from a reader action.', 'live2d-show') . '</p>';
    if (!empty($c['presetWarnings']) || (isset($c['presets']) && $presets !== $c['presets'])) echo '<div class="notice notice-warning inline"><p>' . esc_html__('Some presets are invalid or could not follow the resource update and were skipped. Review and save valid presets. The character remains available.', 'live2d-show') . '</p></div>';
    try { $motions = wzf_mascot_character_motions($c); $expressions = array_map(function($item) {return $item['label'];}, wzf_mascot_character_expressions($c)); }
    catch (Throwable $e) { echo '<p>' . esc_html(wzf_mascot_error_message($e)) . '</p></section>'; return; }
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">'; wp_nonce_field('wzf_mascot_presets');
    echo '<input type="hidden" name="action" value="wzf_mascot_presets"><input type="hidden" name="character" value="' . esc_attr($id) . '"><input type="hidden" name="version" value="' . esc_attr(wzf_mascot_config_version($config)) . '">';
    $used = array_column($presets, 'id');
    for ($index = 0; $index < 8; $index++) {
        $row = $presets[$index] ?? [];
        $new_id = 'preset-' . ($index + 1);
        while (in_array($new_id, $used, true)) $new_id .= '-new';
        $preset_id = $row['id'] ?? $new_id; $used[] = $preset_id;
        $prefix = 'presets[' . $index . ']';
        echo '<details class="wzf-mascot-replace"><summary>' . esc_html($row['name'] ?? sprintf(__('New preset %s', 'live2d-show'), $index + 1)) . '</summary><div class="wzf-mascot-fields"><input type="hidden" name="' . esc_attr($prefix . '[id]') . '" value="' . esc_attr($preset_id) . '">';
        foreach (['name'=>__('Preset name', 'live2d-show'),'line'=>__('Preset line', 'live2d-show')] as $key=>$label) echo '<label class="wzf-mascot-field">' . esc_html($label) . '<input type="text" name="' . esc_attr($prefix . '[' . $key . ']') . '" value="' . esc_attr($row[$key] ?? '') . '"></label>';
        foreach (['motion'=>[__('Preset motion', 'live2d-show'),$motions], 'expression'=>[__('Preset expression', 'live2d-show'),$expressions]] as $key=>$field) {
            echo '<label class="wzf-mascot-field">' . esc_html($field[0]) . '<select name="' . esc_attr($prefix . '[' . $key . ']') . '"><option value="">' . esc_html__('None', 'live2d-show') . '</option>';
            foreach ($field[1] as $value=>$label) echo '<option value="' . esc_attr($value) . '" ' . selected($row[$key] ?? '', (string)$value, false) . '>' . esc_html($label . ' · ' . $value) . '</option>';
            echo '</select></label>';
        }
        echo '</div></details>';
    }
    submit_button(__('Save interaction presets', 'live2d-show')); echo '</form></section>';
}
add_action('admin_post_wzf_mascot_presets', 'wzf_mascot_presets_post');

function wzf_mascot_remap_presets($character, $old_motions, $new_catalog) {
    try { $old_expressions = wzf_mascot_character_expressions($character); } catch (Throwable $e) { $old_expressions = []; }
    $maps = [];
    foreach (['motion'=>'motions','expression'=>'expressions'] as $channel=>$key) {
        foreach ($new_catalog[$key] ?? [] as $item) $maps[$channel][$item['file']] = $item['id'];
    }
    $presets = wzf_mascot_presets($character['presets'] ?? [], $old_motions, $old_expressions);
    $result = [];
    foreach ($presets as $preset) {
        foreach (['motion'=>$old_motions,'expression'=>$old_expressions] as $channel=>$old) {
            if ($preset[$channel] === '') continue;
            $mapped = $maps[$channel][$old[$preset[$channel]]['file']] ?? null;
            if ($mapped === null) continue 2;
            $preset[$channel] = $mapped;
        }
        $result[] = $preset;
    }
    $raw_count = is_array($character['presets'] ?? null) ? count($character['presets']) : 0;
    return ['presets'=>$result, 'presetWarnings'=>max(0, $raw_count - count($result))];
}
