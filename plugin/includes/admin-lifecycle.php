<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
function wzf_mascot_character_status($character) {
    return $character['status'] ?? 'active';
}
function wzf_mascot_locked_character($id, $version, $callback) {
    if (!current_user_can('manage_options')) throw new RuntimeException('需要管理员权限。');
    if (!is_string($id) || !is_string($version) || !preg_match('/\A[0-9a-f]{64}\z/D', $version)) throw new RuntimeException('角色管理请求无效。');
    $token = bin2hex(random_bytes(16));
    if (!add_option(WZF_MASCOT_LOCK, ['token'=>$token,'started'=>time()], '', false)) throw new RuntimeException('已有资源或设置任务正在进行，请稍后重试。');
    try {
        $config = get_option(WZF_MASCOT_OPTION, []);
        if (!hash_equals(wzf_mascot_config_version($config), $version)) throw new RuntimeException('资源配置已被其他请求修改，请刷新页面后重新操作。');
        if (!is_array($config) || !is_array($config['characters'] ?? null) || !is_array($config['characters'][$id] ?? null)) throw new RuntimeException('角色不存在或配置无效。');
        return $callback($config, $token);
    } finally {
        $lock = get_option(WZF_MASCOT_LOCK);
        if (is_array($lock) && ($lock['token'] ?? null) === $token) delete_option(WZF_MASCOT_LOCK);
    }
}
function wzf_mascot_manage_character($id, $version, $operation) {
    if (!in_array($operation, ['disable','enable','trash','restore','rollback'], true)) throw new RuntimeException('角色管理操作无效。');
    wzf_mascot_locked_character($id, $version, function($config) use ($id, $operation) {
        $c = $config['characters'][$id];
        $status = wzf_mascot_character_status($c);
        if ($operation === 'disable' && $status === 'active') $c['status'] = 'disabled';
        elseif ($operation === 'enable' && $status === 'disabled') $c['status'] = 'active';
        elseif ($operation === 'trash' && in_array($status, ['active','disabled'], true)) {
            $c['restoreStatus'] = $status; $c['status'] = 'trash';
        } elseif ($operation === 'restore' && $status === 'trash') {
            $c['status'] = ($c['restoreStatus'] ?? '') === 'disabled' ? 'disabled' : 'active';
            unset($c['restoreStatus']);
        } elseif ($operation === 'rollback' && in_array($status, ['active','disabled','trash'], true)) {
            $previous = $config['history'][$id] ?? null;
            if (!is_array($previous)) throw new RuntimeException('没有可回退的上一版角色资源。');
            // Roll back resources and their motion references, retaining current presentation/state.
            $rollback = array_replace($c, array_intersect_key($previous, array_flip(['root','file','idle','welcome','greetings'])));
            wzf_mascot_character_runtime_files($rollback);
            wzf_mascot_character_catalog($rollback);
            $config['history'][$id] = $c; $c = $rollback;
        } else throw new RuntimeException('角色状态已经改变，请刷新页面后重试。');
        $config['characters'][$id] = $c;
        if (!update_option(WZF_MASCOT_OPTION, $config, false)) throw new RuntimeException('角色管理保存失败。');
    });
}
function wzf_mascot_remap_motions($character, $old, $new, $default_idle, $reset) {
    $by_file = [];
    foreach ($new as $motion) if (!isset($by_file[$motion['file']])) $by_file[$motion['file']] = $motion['id'];
    $map = function($id) use ($old, $by_file) {
        return is_string($id) && isset($old[$id]) ? ($by_file[$old[$id]['file']] ?? null) : null;
    };
    $missing = [];
    $idle = $map($character['idle'] ?? null);
    if ($idle === null) $missing[] = '待机';
    $welcome = null;
    if (($character['welcome'] ?? null) !== null && $character['welcome'] !== '') {
        $welcome = $map($character['welcome']);
        if ($welcome === null) $missing[] = '欢迎';
    }
    $greetings = [];
    foreach (wzf_mascot_list($character['greetings'] ?? [], 'Greetings') as $id) {
        $mapped = $map($id);
        if ($mapped === null) $missing[] = '招呼';
        elseif (!in_array($mapped, $greetings, true)) $greetings[] = $mapped;
    }
    if ($missing && !$reset) throw new RuntimeException('新模型无法按文件路径保留现有' . implode('、', array_unique($missing)) . '动作。配置未改变；确认后勾选“允许重置不兼容动作”再上传。');
    return ['idle'=>$idle ?? $default_idle,'welcome'=>$welcome,'greetings'=>$greetings];
}
function wzf_mascot_replace_resource($file, $id, $version, $reset = false) {
    if (!current_user_can('manage_options')) throw new RuntimeException('需要管理员权限。');
    if (!is_file($file) || is_link($file) || !is_bool($reset)) throw new RuntimeException('上传文件或更新请求无效。');
    $model = wzf_mascot_model_zip($file);
    wzf_mascot_locked_character($id, $version, function($config, $token) use ($id, $model, $reset) {
        $c = $config['characters'][$id];
        if (!in_array(wzf_mascot_character_status($c), ['active','disabled'], true)) throw new RuntimeException('请先恢复角色有效状态再更新资源。');
        if (isset($config['history']) && !is_array($config['history'])) throw new RuntimeException('角色历史配置无效。');
        $old = wzf_mascot_character_catalog($c);
        $new = wzf_mascot_json($model['files']['catalog.json'])['motions'];
        $mapped = wzf_mascot_remap_motions($c, $old, $new, $model['idle'], $reset);
        $u = wzf_mascot_uploads(true);
        $dirname = 'model-' . $token;
        $stage = $u['path'] . '/stage-' . $token; $final = $u['path'] . '/' . $dirname;
        $owned = false; $saved = false;
        try {
            if (file_exists($stage) || file_exists($final) || !mkdir($stage, 0755)) throw new RuntimeException('不能建立独立候选目录。');
            $owned = true;
            foreach ($model['files'] as $relative=>$raw) {
                $path = $stage . '/' . wzf_mascot_path($relative);
                if (!is_dir(dirname($path)) && !wp_mkdir_p(dirname($path))) throw new RuntimeException('资源目录建立失败。');
                if (file_put_contents($path, $raw, LOCK_EX) !== strlen($raw) || !hash_equals(hash('sha256', $raw), hash_file('sha256', $path))) throw new RuntimeException('资源写入校验失败。');
            }
            if (!rename($stage, $final)) throw new RuntimeException('资源提交失败。');
            $stage = null;
            $config['history'][$id] = $c;
            $config['characters'][$id] = array_replace($c, $mapped, ['root'=>$dirname . '/', 'file'=>$model['file']]);
            if (!update_option(WZF_MASCOT_OPTION, $config, false)) throw new RuntimeException('角色资源更新保存失败。');
            $saved = true;
        } finally {
            if ($owned && !$saved) wzf_mascot_cleanup($stage ?? $final);
        }
    });
}
function wzf_mascot_manage_post() {
    if (!current_user_can('manage_options')) wp_die('需要管理员权限。', '', ['response'=>403]);
    check_admin_referer('wzf_mascot_manage');
    $id = isset($_POST['character']) && is_string($_POST['character']) ? wp_unslash($_POST['character']) : '';
    try {
        $version = isset($_POST['version']) && is_string($_POST['version']) ? wp_unslash($_POST['version']) : '';
        $operation = isset($_POST['operation']) && is_string($_POST['operation']) ? wp_unslash($_POST['operation']) : '';
        if ($operation === 'replace') {
            if (($_POST['rights'] ?? '') !== '1') throw new RuntimeException('请确认有权使用上传资源。');
            $upload = $_FILES['resource'] ?? null;
            if (!is_array($upload) || ($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_string($upload['tmp_name'] ?? null) || !is_uploaded_file($upload['tmp_name'])) throw new RuntimeException('上传失败。');
            if (isset($_POST['reset_motions']) && $_POST['reset_motions'] !== '1') throw new RuntimeException('更新确认无效。');
            wzf_mascot_replace_resource($upload['tmp_name'], $id, $version, ($_POST['reset_motions'] ?? '') === '1');
            $notice = '角色资源已更新，上一版可回退。';
        } else {
            wzf_mascot_manage_character($id, $version, $operation);
            $notice = '角色管理操作已保存。';
        }
    } catch (Throwable $e) { $notice = $e->getMessage(); }
    wp_safe_redirect(add_query_arg(['mascot_notice'=>rawurlencode($notice),'character'=>$id], admin_url('options-general.php?page=wzf-mascot')));
    exit;
}
function wzf_mascot_management_fields($config, $id) {
    wp_nonce_field('wzf_mascot_manage');
    echo '<input type="hidden" name="action" value="wzf_mascot_manage"><input type="hidden" name="character" value="' . esc_attr($id) . '"><input type="hidden" name="version" value="' . esc_attr(wzf_mascot_config_version($config)) . '">';
}
function wzf_mascot_character_management($config, $id) {
    $c = $config['characters'][$id];
    if (!is_string($c['name'] ?? null)) $c['name'] = (string)$id;
    $status = wzf_mascot_character_status($c);
    echo '<section class="wzf-mascot-card"><h2>资源与状态 · ' . esc_html($c['name'] ?? $id) . '</h2><p class="description">停用或移入回收站会从前台隐藏角色，保留文件、浏览器收藏及已有选择。恢复后重新可用；回收站不会永久删除资源。</p><div class="wzf-mascot-actions">';
    $buttons = $status === 'trash' ? ['restore'=>'从回收站恢复'] : ($status === 'disabled' ? ['enable'=>'启用角色','trash'=>'移入回收站'] : ['disable'=>'停用角色','trash'=>'移入回收站']);
    if (is_array($config['history'][$id] ?? null)) $buttons['rollback'] = '回退到上一版资源与动作';
    foreach ($buttons as $operation=>$label) {
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wzf_mascot_management_fields($config, $id);
        echo '<button class="button" name="operation" value="' . esc_attr($operation) . '">' . esc_html($label) . '</button></form>';
    }
    echo '</div>';
    if ($status !== 'trash') {
        echo '<details class="wzf-mascot-replace"><summary>更新此角色的模型 ZIP</summary><p>保留角色 ID、名称、署名、布局与其他显示配置。使用新独立资源目录，旧文件保留供缓存与回退；回退只恢复资源和动作，保留当前显示信息与启用状态。动作按相对文件路径映射；无法保留时默认拒绝。</p><form method="post" enctype="multipart/form-data" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wzf_mascot_management_fields($config, $id);
        echo '<input type="hidden" name="operation" value="replace"><div class="wzf-mascot-field"><label for="mascot-replacement">新单模型运行 ZIP</label><input id="mascot-replacement" type="file" name="resource" required accept=".zip"></div><p><label><input type="checkbox" name="reset_motions" value="1"> 允许重置不兼容动作：无法映射的待机使用新默认动作，移除无法映射的欢迎与招呼；可映射的动作和招呼顺序保留。</label></p><p><label><input type="checkbox" name="rights" value="1" required> 我有权在本站使用新资源，并已阅读来源许可与使用条件。</label></p>';
        submit_button('更新角色资源'); echo '</form></details>';
    }
    echo '</section>';
}
add_action('admin_post_wzf_mascot_manage', 'wzf_mascot_manage_post');
