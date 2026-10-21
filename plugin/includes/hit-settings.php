<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
function wzf_mascot_hit_names($model) {
    $result = [];
    foreach (is_array($model['HitAreas'] ?? null) ? array_slice($model['HitAreas'], 0, 32) : [] as $area) {
        try {
            $name = wzf_mascot_plain_text($area['Name'] ?? null, 200, true);
            wzf_mascot_plain_text($area['Id'] ?? null, 200, true);
            if (!in_array($name, ['__proto__','constructor','prototype'], true)) $result[] = $name;
        } catch (Throwable $e) {}
    }
    return array_values(array_unique($result));
}
function wzf_mascot_character_hit_names($character) {
    $u = wzf_mascot_uploads();
    $root = wzf_mascot_no_links($u['path'] . '/' . wzf_mascot_path(rtrim($character['root'] ?? '', '/')));
    $file = wzf_mascot_no_links($root . '/' . wzf_mascot_path($character['file'] ?? null));
    if (!is_file($file) || !is_readable($file) || filesize($file) > 8 * 1024 * 1024) return [];
    return wzf_mascot_hit_names(wzf_mascot_json(@file_get_contents($file)));
}
function wzf_mascot_hit_bindings($value, $areas = null, $presets = null, $strict = false) {
    if (!is_array($value) || !array_is_list($value) || count($value) > 32) {
        if ($strict) throw new RuntimeException(__('Hit area bindings are invalid.', 'live2d-show'));
        return [];
    }
    $result = []; $seen = [];
    foreach ($value as $row) {
        try {
            if (!is_array($row) || array_diff(array_keys($row), ['area','preset'])) throw new RuntimeException(__('Hit area bindings are invalid.', 'live2d-show'));
            $area = wzf_mascot_plain_text($row['area'] ?? null, 200, true);
            $preset = wzf_mascot_plain_text($row['preset'] ?? null, 64);
            if ($preset === '') continue;
            if (in_array($area, ['__proto__','constructor','prototype'], true) || in_array($area, $seen, true) || ($areas !== null && !in_array($area, $areas, true)) || ($presets !== null && !in_array($preset, array_column($presets, 'id'), true))) throw new RuntimeException(__('Choose an existing hit area and a valid interaction preset.', 'live2d-show'));
            $seen[] = $area; $result[] = ['area'=>$area,'preset'=>$preset];
        } catch (Throwable $e) { if ($strict) throw $e; }
    }
    return $result;
}
function wzf_mascot_save_hits($id, $version, $rows) {
    wzf_mascot_locked_character($id, $version, function($config) use ($id, $rows) {
        $c = $config['characters'][$id];
        $bindings = wzf_mascot_hit_bindings($rows, wzf_mascot_character_hit_names($c), wzf_mascot_current_presets($c), true);
        if (($c['hitBindings'] ?? []) === $bindings && empty($c['hitWarnings'])) return;
        $config['characters'][$id]['hitBindings'] = $bindings; unset($config['characters'][$id]['hitWarnings']);
        if (!wzf_mascot_resources_update($config)) throw new RuntimeException(__('Cannot save character settings.', 'live2d-show'));
    }, 'settings');
}
function wzf_mascot_hits_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_hits');
    $id = is_string($_POST['character'] ?? null) ? wp_unslash($_POST['character']) : '';
    try {
        wzf_mascot_save_hits($id, is_string($_POST['version'] ?? null) ? wp_unslash($_POST['version']) : '', wp_unslash($_POST['hitBindings'] ?? []));
        $notice = __('Hit area bindings saved.', 'live2d-show');
    } catch (Throwable $e) { $notice = wzf_mascot_error_message($e); }
    wp_safe_redirect(add_query_arg(['mascot_notice'=>rawurlencode($notice),'character'=>$id], admin_url('options-general.php?page=wzf-mascot'))); exit;
}
function wzf_mascot_hits_panel($config, $id) {
    $c = $config['characters'][$id];
    echo '<section class="wzf-mascot-card"><h2>' . esc_html__('Model hit areas', 'live2d-show') . '</h2><p class="description">' . esc_html__('Bind only areas declared by this model to an existing quick interaction. The browser checks actual drawable support. Unbound, missing or invalid areas use the normal greeting.', 'live2d-show') . '</p>';
    try { $areas = wzf_mascot_character_hit_names($c); $presets = wzf_mascot_current_presets($c); }
    catch (Throwable $e) { echo '<p>' . esc_html(wzf_mascot_error_message($e)) . '</p></section>'; return; }
    $bindings = wzf_mascot_hit_bindings($c['hitBindings'] ?? [], $areas, $presets);
    if (!empty($c['hitWarnings']) || $bindings !== ($c['hitBindings'] ?? [])) echo '<div class="notice notice-warning inline"><p>' . esc_html__('Some area bindings are no longer valid and were skipped. Review and save the current bindings.', 'live2d-show') . '</p></div>';
    if (!$areas) { echo '<p>' . esc_html__('This model declares no hit areas. Normal greeting remains available.', 'live2d-show') . '</p></section>'; return; }
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">'; wp_nonce_field('wzf_mascot_hits');
    echo '<input type="hidden" name="action" value="wzf_mascot_hits"><input type="hidden" name="character" value="' . esc_attr($id) . '"><input type="hidden" name="version" value="' . esc_attr(wzf_mascot_config_version($config)) . '"><div class="wzf-mascot-fields">';
    foreach ($areas as $index=>$area) {
        $current = ''; foreach ($bindings as $binding) if ($binding['area'] === $area) $current = $binding['preset'];
        echo '<label class="wzf-mascot-field">' . esc_html($area) . '<input type="hidden" name="hitBindings[' . $index . '][area]" value="' . esc_attr($area) . '"><select name="hitBindings[' . $index . '][preset]"><option value="">' . esc_html__('Normal greeting', 'live2d-show') . '</option>';
        foreach ($presets as $preset) echo '<option value="' . esc_attr($preset['id']) . '" ' . selected($current,$preset['id'],false) . '>' . esc_html($preset['name']) . '</option>';
        echo '</select></label>';
    }
    echo '</div>'; submit_button(__('Save area bindings', 'live2d-show')); echo '</form></section>';
}
add_action('admin_post_wzf_mascot_hits', 'wzf_mascot_hits_post');
