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
