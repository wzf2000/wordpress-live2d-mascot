<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
function wzf_mascot_save_mobile($version, $enabled, $pause_input) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    if (!is_string($version) || !preg_match('/\A[0-9a-f]{64}\z/D', $version) || !is_bool($enabled) || !is_bool($pause_input)) throw new RuntimeException(__('Mobile settings request is invalid.', 'live2d-show'));
    $task = wzf_mascot_task_begin('mobile');
    $token = $task['token'];
    try {
        $config = $task['config'];
        if (!hash_equals(wzf_mascot_config_version($config), $version)) throw new RuntimeException(__('Another request changed the resource configuration. Refresh before retrying.', 'live2d-show'));
        if (!is_array($config) || !is_array($config['characters'] ?? null)) throw new RuntimeException(__('Resource configuration is invalid.', 'live2d-show'));
        if (($config['mobileEnabled'] ?? false) === $enabled && ($config['mobilePauseOnInput'] ?? true) === $pause_input) return;
        $config['mobileEnabled'] = $enabled; $config['mobilePauseOnInput'] = $pause_input;
        if (!update_option(WZF_MASCOT_OPTION, $config, false)) throw new RuntimeException(__('Cannot save mobile settings.', 'live2d-show'));
    } finally {
        wzf_mascot_task_end($task);
    }
}
function wzf_mascot_mobile_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_mobile');
    try {
        $version = isset($_POST['version']) && is_string($_POST['version']) ? wp_unslash($_POST['version']) : '';
        foreach (['mobile_enabled','pause_input'] as $key) if (isset($_POST[$key]) && $_POST[$key] !== '1') throw new RuntimeException(__('Mobile settings request is invalid.', 'live2d-show'));
        wzf_mascot_save_mobile($version, isset($_POST['mobile_enabled']), isset($_POST['pause_input']));
        $notice = __('Mobile settings saved. Each browser still requires separate consent and opt-in.', 'live2d-show');
    } catch (Throwable $e) { $notice = wzf_mascot_error_message($e); }
    wp_safe_redirect(add_query_arg('mascot_notice', rawurlencode($notice), admin_url('options-general.php?page=wzf-mascot')));
    exit;
}
function wzf_mascot_mobile_panel($config) {
    echo ('<section class="wzf-mascot-card"><h2>' . esc_html__('Mobile display', 'live2d-show') . '</h2><p class="description">' . esc_html__('Off by default. After mobile display is allowed, each browser must still consent and opt in separately. Desktop preferences never automatically enable mobile animation. Reduced motion, account display permission and reading suspension always apply.', 'live2d-show') . '</p><form method="post" action="') . esc_url(admin_url('admin-post.php')) . '">';
    wp_nonce_field('wzf_mascot_mobile');
    echo '<input type="hidden" name="action" value="wzf_mascot_mobile"><input type="hidden" name="version" value="' . esc_attr(wzf_mascot_config_version($config)) . '"><p><label><input type="checkbox" name="mobile_enabled" value="1" ' . checked(($config['mobileEnabled'] ?? false) === true, true, false) . ('> ' . esc_html__('Allow readers to opt in to the mascot in mobile browsers', 'live2d-show') . '</label></p><p><label><input type="checkbox" name="pause_input" value="1" ') . checked(($config['mobilePauseOnInput'] ?? true) !== false, true, false) . ('> ' . esc_html__('Pause when mobile inputs are focused (keep inputs and the keyboard clear)', 'live2d-show') . '</label></p>');
    submit_button(__('Save mobile settings', 'live2d-show')); echo '</form></section>';
}
add_action('admin_post_wzf_mascot_mobile', 'wzf_mascot_mobile_post');
