<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
function wzf_mascot_save_mobile($version, $enabled, $pause_input) {
    if (!current_user_can('manage_options')) throw new RuntimeException('需要管理员权限。');
    if (!is_string($version) || !preg_match('/\A[0-9a-f]{64}\z/D', $version) || !is_bool($enabled) || !is_bool($pause_input)) throw new RuntimeException('移动端设置请求无效。');
    $token = bin2hex(random_bytes(16));
    if (!add_option(WZF_MASCOT_LOCK, ['token'=>$token,'started'=>time()], '', false)) throw new RuntimeException('已有资源或设置任务正在进行，请稍后重试。');
    try {
        $config = get_option(WZF_MASCOT_OPTION, ['characters'=>[]]);
        if (!hash_equals(wzf_mascot_config_version($config), $version)) throw new RuntimeException('资源配置已被其他请求修改，请刷新后重试。');
        if (!is_array($config) || !is_array($config['characters'] ?? null)) throw new RuntimeException('资源配置无效。');
        if (($config['mobileEnabled'] ?? false) === $enabled && ($config['mobilePauseOnInput'] ?? true) === $pause_input) return;
        $config['mobileEnabled'] = $enabled; $config['mobilePauseOnInput'] = $pause_input;
        if (!update_option(WZF_MASCOT_OPTION, $config, false)) throw new RuntimeException('移动端设置保存失败。');
    } finally {
        $lock = get_option(WZF_MASCOT_LOCK);
        if (is_array($lock) && ($lock['token'] ?? null) === $token) delete_option(WZF_MASCOT_LOCK);
    }
}
function wzf_mascot_mobile_post() {
    if (!current_user_can('manage_options')) wp_die('需要管理员权限。', '', ['response'=>403]);
    check_admin_referer('wzf_mascot_mobile');
    try {
        $version = isset($_POST['version']) && is_string($_POST['version']) ? wp_unslash($_POST['version']) : '';
        foreach (['mobile_enabled','pause_input'] as $key) if (isset($_POST[$key]) && $_POST[$key] !== '1') throw new RuntimeException('移动端设置请求无效。');
        wzf_mascot_save_mobile($version, isset($_POST['mobile_enabled']), isset($_POST['pause_input']));
        $notice = '移动端设置已保存。每个浏览器仍需单独同意并开启。';
    } catch (Throwable $e) { $notice = $e->getMessage(); }
    wp_safe_redirect(add_query_arg('mascot_notice', rawurlencode($notice), admin_url('options-general.php?page=wzf-mascot')));
    exit;
}
function wzf_mascot_mobile_panel($config) {
    echo '<section class="wzf-mascot-card"><h2>移动端显示</h2><p class="description">默认关闭。允许手机显示后，每个浏览器仍需单独同意并开启，已有桌面显示偏好不会自动开启手机动画。减少动画、账号显示权限和阅读暂停规则始终有效。</p><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    wp_nonce_field('wzf_mascot_mobile');
    echo '<input type="hidden" name="action" value="wzf_mascot_mobile"><input type="hidden" name="version" value="' . esc_attr(wzf_mascot_config_version($config)) . '"><p><label><input type="checkbox" name="mobile_enabled" value="1" ' . checked(($config['mobileEnabled'] ?? false) === true, true, false) . '> 允许读者在手机浏览器单独开启看板娘</label></p><p><label><input type="checkbox" name="pause_input" value="1" ' . checked(($config['mobilePauseOnInput'] ?? true) !== false, true, false) . '> 手机输入框聚焦时暂停（避免遮挡输入与软键盘）</label></p>';
    submit_button('保存移动端设置'); echo '</form></section>';
}
add_action('admin_post_wzf_mascot_mobile', 'wzf_mascot_mobile_post');
