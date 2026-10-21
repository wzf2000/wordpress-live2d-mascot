<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
function wzf_mascot_save_capture($id, $version, $allowed, $confirmed) {
    if (!is_bool($allowed) || !is_bool($confirmed) || ($allowed && !$confirmed)) throw new RuntimeException(__('Explicitly confirm that PNG capture is permitted for this character.', 'live2d-show'));
    wzf_mascot_locked_character($id, $version, function($config) use ($id, $allowed) {
        if (($config['characters'][$id]['captureAllowed'] ?? false) === $allowed) return;
        $config['characters'][$id]['captureAllowed'] = $allowed;
        if (!update_option(WZF_MASCOT_OPTION, $config, false)) throw new RuntimeException(__('Cannot save character settings.', 'live2d-show'));
    }, 'settings');
}
function wzf_mascot_capture_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_capture');
    $id = is_string($_POST['character'] ?? null) ? wp_unslash($_POST['character']) : '';
    try {
        foreach (['capture_allowed','capture_confirmed'] as $key) if (isset($_POST[$key]) && $_POST[$key] !== '1') throw new RuntimeException(__('PNG capture settings are invalid.', 'live2d-show'));
        wzf_mascot_save_capture($id, is_string($_POST['version'] ?? null) ? wp_unslash($_POST['version']) : '', isset($_POST['capture_allowed']), isset($_POST['capture_confirmed']));
        $notice = __('PNG capture settings saved.', 'live2d-show');
    } catch (Throwable $e) { $notice = wzf_mascot_error_message($e); }
    wp_safe_redirect(add_query_arg(['mascot_notice'=>rawurlencode($notice),'character'=>$id], admin_url('options-general.php?page=wzf-mascot'))); exit;
}
function wzf_mascot_capture_panel($config, $id) {
    echo '<section class="wzf-mascot-card"><h2>' . esc_html__('Character PNG download', 'live2d-show') . '</h2><p class="description">' . esc_html__('Off by default for every character. Enable only when the resource terms permit readers to save a transparent character PNG. Updating or rolling back model resources disables this permission until you explicitly confirm again.', 'live2d-show') . '</p><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">'; wp_nonce_field('wzf_mascot_capture');
    echo '<input type="hidden" name="action" value="wzf_mascot_capture"><input type="hidden" name="character" value="' . esc_attr($id) . '"><input type="hidden" name="version" value="' . esc_attr(wzf_mascot_config_version($config)) . '"><p><label><input type="checkbox" name="capture_allowed" value="1" ' . checked(($config['characters'][$id]['captureAllowed'] ?? false) === true,true,false) . '> ' . esc_html__('Allow transparent PNG download for this character', 'live2d-show') . '</label></p><p><label><input type="checkbox" name="capture_confirmed" value="1"> ' . esc_html__('I have checked the resource terms and explicitly authorize character PNG downloads.', 'live2d-show') . '</label></p>';
    submit_button(__('Save PNG permission', 'live2d-show')); echo '</form></section>';
}
add_action('admin_post_wzf_mascot_capture', 'wzf_mascot_capture_post');
