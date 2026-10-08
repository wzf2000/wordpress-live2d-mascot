<?php
/*
Plugin Name: WordPress Live2D Mascot
Plugin URI: https://github.com/wzf2000/wordpress-live2d-mascot
Description: 为 WordPress 提供看板娘互动；管理员自行导入有权使用的 Core 与模型，插件不附带这些资源。
Version: 3.5.0
Author: wzf2000
Author URI: https://github.com/wzf2000
License: GPL-2.0-or-later
License URI: https://github.com/wzf2000/wordpress-live2d-mascot/blob/main/LICENSE
Update URI: https://github.com/wzf2000/wordpress-live2d-mascot
Text Domain: live2d-show
Requires PHP: 8.2
*/
if (!defined('ABSPATH')) exit;
require_once __DIR__ . '/includes/admin-import.php';
function wzf_mascot_action_links($links) {
    if (current_user_can('manage_options')) {
        array_unshift($links, '<a href="' . esc_url(admin_url('options-general.php?page=wzf-mascot')) . '">设置</a>');
    }
    return $links;
}
add_filter('plugin_action_links_' . plugin_basename(__FILE__), 'wzf_mascot_action_links');
function wzf_mascot_row_meta($links, $plugin_file) {
    if ($plugin_file !== plugin_basename(__FILE__)) return $links;
    $links[] = '<a href="' . esc_url('https://github.com/wzf2000/wordpress-live2d-mascot#readme') . '">文档</a>';
    $links[] = '<a href="' . esc_url('https://github.com/wzf2000/wordpress-live2d-mascot/issues') . '">反馈</a>';
    return $links;
}
add_filter('plugin_row_meta', 'wzf_mascot_row_meta', 10, 2);
function wzf_haru_visible($user) {
    return !metadata_exists('user',$user->ID,'show_live2d_front') || get_user_meta($user->ID,'show_live2d_front',true)==='true';
}
function wzf_haru_output() {
    if (is_admin() || in_array($GLOBALS['pagenow']??'', ['wp-login.php','wp-register.php','wp-signup.php','wp-activate.php'],true)) return;
    if (is_user_logged_in() && !wzf_haru_visible(wp_get_current_user())) return;
    $resources = get_option(WZF_MASCOT_OPTION, []);
    if (!is_array($resources) || empty($resources['core']) || empty($resources['characters']) || !is_array($resources['characters'])) return;
    try {
        $uploads = wzf_mascot_uploads();
        $core = wzf_mascot_path($resources['core']['path'] ?? null);
        if (($resources['core']['sha256'] ?? '') !== WZF_MASCOT_CORE_SHA || !is_file(wzf_mascot_no_links($uploads['path'].'/'.$core))) return;
        $characters = [];
        foreach ($resources['characters'] as $id=>$c) {
            if (!is_array($c)) return;
            $root = wzf_mascot_path(rtrim($c['root'] ?? '', '/'));
            $file = wzf_mascot_path($c['file'] ?? null);
            if (!is_file(wzf_mascot_no_links($uploads['path'].'/'.$root.'/'.$file))) return;
            $c['root'] = $uploads['url'] . $root . '/';
            $characters[$id] = $c;
        }
        $assets=json_decode(file_get_contents(__DIR__.'/haru-assets.json'),true,32,JSON_THROW_ON_ERROR);
    } catch (Throwable $e) { return; }
    $base=plugins_url('',__FILE__).'/';
    $first=reset($characters);
    $config=['characters'=>$characters,'core'=>$uploads['url'].$core,'engine'=>$base.$assets['engine'],'model'=>$first['root'],'shaders'=>$base.$assets['shaders'],'terms'=>$base.$assets['terms'],'termsVersion'=>'2026-10-08-user-import-v1'];
    echo '<link rel="stylesheet" href="'.esc_url($base.$assets['css']).'">';
    echo '<script id="wzf-live2d-config" type="application/json">'.wp_json_encode($config,JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT).'</script>';
    echo '<script defer src="'.esc_url($base.$assets['loader']).'"></script>';
}
add_action('wp_print_scripts','wzf_haru_output');
function wzf_haru_profile($user) {
    echo '<h3>看板娘</h3>';wp_nonce_field('wzf_haru_profile','wzf_haru_nonce');
    echo '<table class="form-table"><tr><th>显示设置</th><td><label><input name="live2d_front" type="checkbox" value="1" '.checked(wzf_haru_visible($user),true,false).'> 允许前台显示看板娘（访客仍可自行收起）</label><p>前台角色选择保存在当前浏览器；手机默认隐藏。管理员需先在“设置 → Live2D Mascot”导入资源。</p></td></tr></table>';
}
add_action('show_user_profile','wzf_haru_profile');add_action('edit_user_profile','wzf_haru_profile');
function wzf_haru_profile_save($uid) {
    if(!current_user_can('edit_user',$uid) || !isset($_POST['wzf_haru_nonce']) || !is_string($_POST['wzf_haru_nonce']) || !wp_verify_nonce(wp_unslash($_POST['wzf_haru_nonce']),'wzf_haru_profile'))return;
    update_user_meta($uid,'show_live2d_front',isset($_POST['live2d_front'])?'true':'false');
}
add_action('personal_options_update','wzf_haru_profile_save');add_action('edit_user_profile_update','wzf_haru_profile_save');
