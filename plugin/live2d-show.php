<?php
/*
Plugin Name: 看板娘 · 角色互动
Description: 看板娘控制器，使用官方样例与 Cubism SDK。
Version: 3.4.0
Author: wzf2000
Text Domain: live2d-show
*/
if (!defined('ABSPATH')) exit;
function wzf_haru_visible($user) {
    return !metadata_exists('user',$user->ID,'show_live2d_front') || get_user_meta($user->ID,'show_live2d_front',true)==='true';
}
function wzf_haru_output() {
    if (is_admin() || in_array($GLOBALS['pagenow']??'', ['wp-login.php','wp-register.php','wp-signup.php','wp-activate.php'],true)) return;
    if (is_user_logged_in() && !wzf_haru_visible(wp_get_current_user())) return;
    $assets=json_decode(file_get_contents(__DIR__.'/haru-assets.json'),true);if(!$assets)return;
    $base=plugins_url('',__FILE__).'/';
    $characters=json_decode(file_get_contents(__DIR__.'/characters.json'),true);foreach($characters as &$character){$character['root']=$base.$character['root'];}unset($character);
    $config=['characters'=>$characters,'core'=>$base.$assets['core'],'engine'=>$base.$assets['engine'],'model'=>$base.$assets['model'],'shaders'=>$base.$assets['shaders'],'terms'=>$base.$assets['terms'],'termsVersion'=>'2026-10-06-official-candidate-v1'];
    echo '<link rel="stylesheet" href="'.esc_url($base.$assets['css']).'">';
    echo '<script id="wzf-live2d-config" type="application/json">'.wp_json_encode($config,JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT).'</script>';
    echo '<script defer src="'.esc_url($base.$assets['loader']).'"></script>';
}
add_action('wp_print_scripts','wzf_haru_output');
function wzf_haru_profile($user) {
    $assets=json_decode(file_get_contents(__DIR__.'/haru-assets.json'),true);
    $old=get_user_meta($user->ID,'live2d_model',true);$legacy=$old && $old!=='official-haru';
    echo '<h3>看板娘</h3>';wp_nonce_field('wzf_haru_profile','wzf_haru_nonce');
    echo '<table class="form-table"><tr><th>显示设置</th><td><label><input name="live2d_front" type="checkbox" value="1" '.checked(wzf_haru_visible($user),true,false).'> 允许前台显示看板娘（访客仍可自行收起）</label></td></tr>';
    echo '<tr><th><label for="live2d_model">角色</label></th><td><select id="live2d_model" name="live2d_model">';
    if($legacy)echo '<option value="__preserve_legacy" selected>保留旧选择记录，前台可选择角色</option>';
    echo '<option value="official-haru" '.selected(!$legacy,true,false).'>默认 Haru（前台可切换）</option></select><p class="description">旧选择记录仅作保留。角色预览和切换请使用前台互动面板，选择保存在当前浏览器；手机默认隐藏。</p><a href="'.esc_url(plugins_url($assets['terms'],__FILE__)).'" target="_blank" rel="noopener">角色来源和使用条款</a></td></tr></table>';
}
add_action('show_user_profile','wzf_haru_profile');add_action('edit_user_profile','wzf_haru_profile');
function wzf_haru_profile_save($uid) {
    if(!current_user_can('edit_user',$uid) || !isset($_POST['wzf_haru_nonce']) || !is_string($_POST['wzf_haru_nonce']) || !wp_verify_nonce(wp_unslash($_POST['wzf_haru_nonce']),'wzf_haru_profile'))return;
    if(!isset($_POST['live2d_model']) || !is_string($_POST['live2d_model']))return;
    $choice=wp_unslash($_POST['live2d_model']);if(!in_array($choice,['official-haru','__preserve_legacy'],true))return;
    if($choice==='official-haru')update_user_meta($uid,'live2d_model','official-haru');
    update_user_meta($uid,'show_live2d_front',isset($_POST['live2d_front'])?'true':'false');
}
add_action('personal_options_update','wzf_haru_profile_save');add_action('edit_user_profile_update','wzf_haru_profile_save');
