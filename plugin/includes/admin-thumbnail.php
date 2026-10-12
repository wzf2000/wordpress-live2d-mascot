<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
function wzf_mascot_thumbnail_bytes($file) {
    if (!is_string($file) || str_contains($file, '://') || !is_file($file) || is_link($file) || filesize($file) < 1 || filesize($file) > 4 * 1024 * 1024) throw new RuntimeException('缩略图须为不超过 4 MiB 的本地图片文件。');
    if (!function_exists('imagecreatefromstring') || !function_exists('imagepng')) throw new RuntimeException('缩略图导入需要 PHP GD。');
    $raw = @file_get_contents($file);
    if ($raw === false || strlen($raw) > 4 * 1024 * 1024) throw new RuntimeException('不能读取缩略图。');
    $info = @getimagesizefromstring($raw);
    if (!$info || !in_array($info[2], [IMAGETYPE_PNG,IMAGETYPE_JPEG,IMAGETYPE_WEBP], true) || $info[0] < 1 || $info[1] < 1 || $info[0] > 2048 || $info[1] > 2048 || $info[0] * $info[1] > 4 * 1024 * 1024) throw new RuntimeException('仅接受 PNG、JPEG 或 WebP；宽高均须不超过 2048，最多 4M 像素。');
    $source = @imagecreatefromstring($raw);
    if ($source === false) throw new RuntimeException('图片解码失败。');
    $target = null;
    try {
        $scale = min(1, 512 / max($info[0], $info[1]));
        $width = max(1, (int)round($info[0] * $scale)); $height = max(1, (int)round($info[1] * $scale));
        $target = imagecreatetruecolor($width, $height);
        if ($target === false) throw new RuntimeException('不能建立缩略图。');
        imagealphablending($target, false); imagesavealpha($target, true);
        if (!imagecopyresampled($target, $source, 0, 0, 0, 0, $width, $height, $info[0], $info[1])) throw new RuntimeException('不能生成缩略图。');
        // Re-encoding pixels discards EXIF/text chunks, scripts and trailing source bytes.
        ob_start();
        try { $ok = imagepng($target, null, 6); $bytes = ob_get_contents(); }
        finally { ob_end_clean(); }
        if (!$ok || !is_string($bytes) || strlen($bytes) > 2 * 1024 * 1024 || !getimagesizefromstring($bytes)) throw new RuntimeException('缩略图编码失败。');
        return $bytes;
    } finally {
        unset($source, $target);
    }
}
function wzf_mascot_thumbnail_url($character) {
    if (!is_array($character) || !isset($character['thumbnail'])) return null;
    try {
        $relative = $character['thumbnail'];
        if (!is_string($relative) || !preg_match('~\Athumbnail-[0-9a-f]{32}/image\.png\z~D', $relative)) return null;
        $u = wzf_mascot_uploads(); $path = wzf_mascot_no_links($u['path'] . '/' . $relative);
        if (!is_file($path) || filesize($path) < 1 || filesize($path) > 2 * 1024 * 1024) return null;
        return $u['url'] . $relative;
    } catch (Throwable $e) { return null; }
}
function wzf_mascot_save_thumbnail($id, $version, $file = null) {
    if (!current_user_can('manage_options')) throw new RuntimeException('需要管理员权限。');
    $bytes = $file === null ? null : wzf_mascot_thumbnail_bytes($file);
    wzf_mascot_locked_character($id, $version, function($config, $token) use ($id, $bytes) {
        if ($bytes === null) {
            if (!array_key_exists('thumbnail', $config['characters'][$id])) return;
            unset($config['characters'][$id]['thumbnail']);
            if (!update_option(WZF_MASCOT_OPTION, $config, false)) throw new RuntimeException('缩略图清除失败。');
            return;
        }
        $u = wzf_mascot_uploads(true);
        $dirname = 'thumbnail-' . $token;
        $stage = $u['path'] . '/stage-thumbnail-' . $token; $final = $u['path'] . '/' . $dirname;
        $owned = false; $saved = false;
        try {
            if (file_exists($stage) || file_exists($final) || !mkdir($stage, 0755)) throw new RuntimeException('不能建立缩略图候选目录。');
            $owned = true;
            $path = $stage . '/image.png';
            if (file_put_contents($path, $bytes, LOCK_EX) !== strlen($bytes) || !hash_equals(hash('sha256', $bytes), hash_file('sha256', $path))) throw new RuntimeException('缩略图写入校验失败。');
            if (!rename($stage, $final)) throw new RuntimeException('缩略图提交失败。');
            $stage = null;
            $config['characters'][$id]['thumbnail'] = $dirname . '/image.png';
            if (!update_option(WZF_MASCOT_OPTION, $config, false)) throw new RuntimeException('缩略图配置保存失败。');
            $saved = true;
        } finally { if ($owned && !$saved) wzf_mascot_cleanup($stage ?? $final); }
    });
}
function wzf_mascot_thumbnail_post() {
    if (!current_user_can('manage_options')) wp_die('需要管理员权限。', '', ['response'=>403]);
    check_admin_referer('wzf_mascot_thumbnail');
    $id = isset($_POST['character']) && is_string($_POST['character']) ? wp_unslash($_POST['character']) : '';
    try {
        $version = isset($_POST['version']) && is_string($_POST['version']) ? wp_unslash($_POST['version']) : '';
        $operation = $_POST['operation'] ?? null;
        if ($operation === 'clear') wzf_mascot_save_thumbnail($id, $version);
        elseif ($operation === 'upload') {
            if (($_POST['rights'] ?? '') !== '1') throw new RuntimeException('请确认有权使用缩略图。');
            $upload = $_FILES['thumbnail'] ?? null;
            if (!is_array($upload) || ($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_string($upload['tmp_name'] ?? null) || !is_uploaded_file($upload['tmp_name'])) throw new RuntimeException('缩略图上传失败。');
            wzf_mascot_save_thumbnail($id, $version, $upload['tmp_name']);
        } else throw new RuntimeException('缩略图操作无效。');
        $notice = $operation === 'clear' ? '缩略图引用已清除，原文件保留。' : '缩略图已上传并重新编码。';
    } catch (Throwable $e) { $notice = $e->getMessage(); }
    wp_safe_redirect(add_query_arg(['mascot_notice'=>rawurlencode($notice),'character'=>$id], admin_url('options-general.php?page=wzf-mascot')));
    exit;
}
function wzf_mascot_admin_thumbnail($character) {
    $url = wzf_mascot_thumbnail_url($character);
    $name = is_array($character) && is_string($character['name'] ?? null) ? $character['name'] : '角色';
    if ($url !== null) echo '<img class="wzf-mascot-admin-thumbnail" src="' . esc_url($url) . '" alt="' . esc_attr($name . ' 的缩略图') . '" loading="lazy" width="64" height="64">';
    else echo '<span class="wzf-mascot-admin-initials" aria-label="' . esc_attr($name . ' 暂无缩略图') . '">' . esc_html(function_exists('mb_substr') ? mb_substr($name, 0, 2) : substr($name, 0, 1)) . '</span>';
}
function wzf_mascot_thumbnail_fields($config, $id) {
    wp_nonce_field('wzf_mascot_thumbnail');
    echo '<input type="hidden" name="action" value="wzf_mascot_thumbnail"><input type="hidden" name="character" value="' . esc_attr($id) . '"><input type="hidden" name="version" value="' . esc_attr(wzf_mascot_config_version($config)) . '">';
}
function wzf_mascot_thumbnail_panel($config, $id) {
    echo '<section class="wzf-mascot-card"><h2>角色缩略图</h2>';
    wzf_mascot_admin_thumbnail($config['characters'][$id]);
    echo '<p class="description">用于候选角色预览，不自动生成或抓取图片。PNG／JPEG／WebP 最多 4 MiB，宽高不超过 2048（最多 4M 像素）；解码后缩至最长边 512 并重编码 PNG，移除元数据与尾部内容。独立保存，不随模型更新或回退改变。</p><form method="post" enctype="multipart/form-data" action="' . esc_url(admin_url('admin-post.php')) . '">';
    wzf_mascot_thumbnail_fields($config, $id);
    echo '<input type="hidden" name="operation" value="upload"><div class="wzf-mascot-field"><label for="mascot-thumbnail">选择图片</label><input id="mascot-thumbnail" type="file" name="thumbnail" accept="image/png,image/jpeg,image/webp" required></div><p><label><input type="checkbox" name="rights" value="1" required> 我有权在本站使用这张图片，并已阅读来源许可与使用条件。</label></p>';
    submit_button('保存缩略图'); echo '</form>';
    if (array_key_exists('thumbnail', $config['characters'][$id])) {
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wzf_mascot_thumbnail_fields($config, $id);
        echo '<p><button class="button" name="operation" value="clear">清除缩略图引用（保留文件）</button></p></form>';
    }
    echo '</section>';
}
add_action('admin_post_wzf_mascot_thumbnail', 'wzf_mascot_thumbnail_post');
