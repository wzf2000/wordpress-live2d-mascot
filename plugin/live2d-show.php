<?php
/*
Plugin Name: WordPress Live2D Mascot
Plugin URI: https://github.com/wzf2000/wordpress-live2d-mascot
Description: 为 WordPress 提供看板娘互动；管理员自行导入有权使用的 Core 与模型，插件不附带这些资源。
Version: 3.10.0-rc.3
Author: wzf2000
Author URI: https://github.com/wzf2000
License: GPL-2.0-or-later
License URI: https://github.com/wzf2000/wordpress-live2d-mascot/blob/main/LICENSE
Update URI: https://github.com/wzf2000/wordpress-live2d-mascot
Text Domain: live2d-show
Domain Path: /languages
Requires PHP: 8.2
*/
if (!defined('ABSPATH')) exit;
require_once __DIR__ . '/includes/admin-import.php';
function wzf_mascot_action_links($links) {
    if (current_user_can('manage_options')) {
        $links = ['settings'=>'<a href="' . esc_url(admin_url('options-general.php?page=wzf-mascot')) . ('">' . esc_html__('Settings', 'live2d-show') . '</a>')] + $links;
    }
    return $links;
}
add_filter('plugin_action_links_' . plugin_basename(__FILE__), 'wzf_mascot_action_links');
add_filter('network_admin_plugin_action_links_' . plugin_basename(__FILE__), 'wzf_mascot_action_links');
function wzf_mascot_row_meta($links, $plugin_file) {
    if ($plugin_file !== plugin_basename(__FILE__)) return $links;
    $links = wzf_mascot_action_links($links);
    $links[] = '<a href="' . esc_url('https://github.com/wzf2000/wordpress-live2d-mascot#readme') . ('">' . esc_html__('Documentation', 'live2d-show') . '</a>');
    $links[] = '<a href="' . esc_url('https://github.com/wzf2000/wordpress-live2d-mascot/issues') . ('">' . esc_html__('Feedback', 'live2d-show') . '</a>');
    return $links;
}
add_filter('plugin_row_meta', 'wzf_mascot_row_meta', 10, 2);
function wzf_haru_visible($user) {
    return !metadata_exists('user',$user->ID,'show_live2d_front') || get_user_meta($user->ID,'show_live2d_front',true)==='true';
}
// Optional server-managed presentation for installations retaining their own terms.
// No backend upload/editor endpoint accepts HTML or changes these fields.
function wzf_mascot_presentation($resources, $uploads) {
    if (!array_key_exists('presentation', $resources)) return [];
    $value = $resources['presentation'];
    if (!is_array($value) || count($value) !== 3 || array_diff(array_keys($value), ['terms','termsVersion','consentText'])) {
        throw new RuntimeException(__('Site terms configuration is invalid.', 'live2d-show'));
    }
    $terms = wzf_mascot_path($value['terms'] ?? null);
    $path = wzf_mascot_no_links($uploads['path'] . '/' . $terms);
    if (!str_ends_with($terms, '.html') || !is_file($path) || !is_readable($path) || filesize($path) > 2 * 1024 * 1024) {
        throw new RuntimeException(__('Site terms file is invalid.', 'live2d-show'));
    }
    foreach (['termsVersion'=>200,'consentText'=>2000] as $key=>$limit) {
        $text = $value[$key] ?? null;
        if (!is_string($text) || trim($text) === '' || strlen($text) > $limit || strip_tags($text) !== $text || preg_match('/[\x00-\x1f\x7f]/', $text)) {
            throw new RuntimeException(__('Site terms information must be valid plain text.', 'live2d-show'));
        }
    }
    return ['terms'=>$uploads['url'] . $terms, 'termsVersion'=>$value['termsVersion'], 'consentText'=>$value['consentText']];
}
function wzf_haru_output() {
    if (is_admin() || in_array($GLOBALS['pagenow']??'', ['wp-login.php','wp-register.php','wp-signup.php','wp-activate.php'],true)) return;
    if (is_user_logged_in() && !wzf_haru_visible(wp_get_current_user())) return;
    $resources = get_option(WZF_MASCOT_OPTION, []);
    if (!is_array($resources) || !is_array($resources['core'] ?? null) || empty($resources['core']) || empty($resources['characters']) || !is_array($resources['characters'])) return;
    $available = array_filter($resources['characters'], function($c) { return is_array($c) && wzf_mascot_character_status($c) === 'active'; });
    if (!$available) return;
    try {
        $uploads = wzf_mascot_uploads();
        $core = wzf_mascot_path($resources['core']['path'] ?? null);
        $core_path = wzf_mascot_no_links($uploads['path'].'/'.$core);
        if (($resources['core']['sha256'] ?? '') !== WZF_MASCOT_CORE_SHA || !is_file($core_path) || !is_readable($core_path) || filesize($core_path) < 1 || filesize($core_path) > 8 * 1024 * 1024) return;
        $characters = [];
        foreach ($available as $id=>$c) {
            try { $root = wzf_mascot_character_display_check($id, $c, $uploads); }
            catch (Throwable $e) { continue; }
            $c['dialogue'] = wzf_mascot_dialogue($c['dialogue'] ?? []);
            // Keep the HTTP entry cheap: catalog filtering happens after the loader loads it.
            $c['presets'] = wzf_mascot_presets($c['presets'] ?? [], null, null);
            unset($c['presetWarnings'], $c['hitWarnings']);
            $c['hitBindings'] = wzf_mascot_hit_bindings($c['hitBindings'] ?? []);
            $c['captureAllowed'] = ($c['captureAllowed'] ?? false) === true;
            $thumbnail = wzf_mascot_thumbnail_url($c);
            unset($c['status'], $c['restoreStatus'], $c['thumbnail']);
            if ($thumbnail !== null) $c['thumbnail'] = $thumbnail;
            $c['root'] = $uploads['url'] . $root . '/';
            $characters[$id] = $c;
        }
        if (!$characters) return;
        $asset_raw = @file_get_contents(__DIR__.'/haru-assets.json');
        if (!is_string($asset_raw)) return;
        $assets=json_decode($asset_raw,true,32,JSON_THROW_ON_ERROR);
        if (!is_array($assets)) return;
        foreach (['engine','loader','css','shaders','terms'] as $key) {
            if (!is_string($assets[$key] ?? null)) return;
            wzf_mascot_path(rtrim($assets[$key], '/'));
        }
        $presentation = wzf_mascot_presentation($resources, $uploads);
    } catch (Throwable $e) { return; }
    $base=plugins_url('',__FILE__).'/';
    $first=reset($characters);
    $config=['version'=>'3.10.0-rc.3','mobileEnabled'=>($resources['mobileEnabled'] ?? false) === true,'mobilePauseOnInput'=>($resources['mobilePauseOnInput'] ?? true) !== false,'characters'=>$characters,'core'=>$uploads['url'].$core,'engine'=>$base.$assets['engine'],'model'=>$first['root'],'shaders'=>$base.$assets['shaders'],'terms'=>$base.$assets['terms'],'termsVersion'=>'2026-10-08-user-import-v1'];
    $config = array_merge($config, $presentation);
    $config['i18n'] = wzf_mascot_frontend_translations();
    // This flag exposes only an optional local tool, never server data or authority.
    // Logged-in HTML must bypass shared page caches (WordPress's normal contract).
    $config['diagnosticsAllowed'] = current_user_can('manage_options') === true;
    $config['accountEndpoint'] = admin_url('admin-ajax.php');
    echo '<link rel="stylesheet" href="'.esc_url($base.$assets['css']).'">';
    echo '<script id="wzf-live2d-config" type="application/json">'.wp_json_encode($config,JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT).'</script>';
    echo '<script defer src="'.esc_url($base.$assets['loader']).'"></script>';
}
add_action('wp_print_scripts','wzf_haru_output');
function wzf_haru_profile($user) {
    echo ('<section class="wzf-mascot-profile" aria-labelledby="wzf-mascot-profile-title"><h3 id="wzf-mascot-profile-title">Live2D Mascot</h3><p>' . esc_html__('Control whether this account allows the mascot to appear on the frontend.', 'live2d-show') . '</p>');
    wp_nonce_field('wzf_haru_profile','wzf_haru_nonce');
    echo '<label class="wzf-mascot-profile-choice"><input name="live2d_front" type="checkbox" value="1" ' . checked(wzf_haru_visible($user),true,false) . ('> ' . esc_html__('Allow the mascot on the frontend', 'live2d-show') . '</label><p>' . esc_html__('Character selection, favorites, size and visibility are stored in this browser. Mobile display requires administrator permission and separate browser opt-in. Reduced motion always prevents display. You must still accept the terms and show the mascot on the frontend.', 'live2d-show') . '</p>');
    if (current_user_can('manage_options')) echo '<p><a href="' . esc_url(admin_url('options-general.php?page=wzf-mascot')) . ('">' . esc_html__('Manage Core and character resources', 'live2d-show') . '</a></p>');
    echo '</section>';
}
add_action('show_user_profile','wzf_haru_profile');add_action('edit_user_profile','wzf_haru_profile');
function wzf_haru_profile_save($uid) {
    if(!current_user_can('edit_user',$uid) || !isset($_POST['wzf_haru_nonce']) || !is_string($_POST['wzf_haru_nonce']) || !wp_verify_nonce(wp_unslash($_POST['wzf_haru_nonce']),'wzf_haru_profile'))return;
    update_user_meta($uid,'show_live2d_front',isset($_POST['live2d_front'])?'true':'false');
}
add_action('personal_options_update','wzf_haru_profile_save');add_action('edit_user_profile_update','wzf_haru_profile_save');
