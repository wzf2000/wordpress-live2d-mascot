<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
function wzf_mascot_thumbnail_bytes($file) {
    if (!is_string($file) || str_contains($file, '://') || !is_file($file) || is_link($file) || filesize($file) < 1 || filesize($file) > 4 * 1024 * 1024) throw new RuntimeException(__('The thumbnail must be a local image file no larger than 4 MiB.', 'live2d-show'));
    if (!function_exists('imagecreatefromstring') || !function_exists('imagepng')) throw new RuntimeException(__('Thumbnail import requires PHP GD.', 'live2d-show'));
    $raw = @file_get_contents($file);
    if ($raw === false || strlen($raw) > 4 * 1024 * 1024) throw new RuntimeException(__('Cannot read the thumbnail.', 'live2d-show'));
    $info = @getimagesizefromstring($raw);
    if (!$info || !in_array($info[2], [IMAGETYPE_PNG,IMAGETYPE_JPEG,IMAGETYPE_WEBP], true) || $info[0] < 1 || $info[1] < 1 || $info[0] > 2048 || $info[1] > 2048 || $info[0] * $info[1] > 4 * 1024 * 1024) throw new RuntimeException(__('Only PNG, JPEG or WebP is accepted; dimensions must not exceed 2048 and 4M pixels.', 'live2d-show'));
    $source = @imagecreatefromstring($raw);
    if ($source === false) throw new RuntimeException(__('Image decoding failed.', 'live2d-show'));
    $target = null;
    try {
        $scale = min(1, 512 / max($info[0], $info[1]));
        $width = max(1, (int)round($info[0] * $scale)); $height = max(1, (int)round($info[1] * $scale));
        $target = imagecreatetruecolor($width, $height);
        if ($target === false) throw new RuntimeException(__('Cannot create the thumbnail.', 'live2d-show'));
        imagealphablending($target, false); imagesavealpha($target, true);
        if (!imagecopyresampled($target, $source, 0, 0, 0, 0, $width, $height, $info[0], $info[1])) throw new RuntimeException(__('Cannot generate the thumbnail.', 'live2d-show'));
        // Re-encoding pixels discards EXIF/text chunks, scripts and trailing source bytes.
        ob_start();
        try { $ok = imagepng($target, null, 6); $bytes = ob_get_contents(); }
        finally { ob_end_clean(); }
        if (!$ok || !is_string($bytes) || strlen($bytes) > 2 * 1024 * 1024 || !getimagesizefromstring($bytes)) throw new RuntimeException(__('Thumbnail encoding failed.', 'live2d-show'));
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
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    $bytes = $file === null ? null : wzf_mascot_thumbnail_bytes($file);
    wzf_mascot_locked_character($id, $version, function($config, $token) use ($id, $bytes) {
        if ($bytes === null) {
            if (!array_key_exists('thumbnail', $config['characters'][$id])) return;
            unset($config['characters'][$id]['thumbnail']);
            if (!wzf_mascot_resources_update($config)) throw new RuntimeException(__('Cannot clear the thumbnail reference.', 'live2d-show'));
            return;
        }
        $u = wzf_mascot_uploads(true);
        $dirname = 'thumbnail-' . $token;
        $stage = $u['path'] . '/stage-thumbnail-' . $token; $final = $u['path'] . '/' . $dirname;
        $owned = false; $saved = false;
        try {
            if (file_exists($stage) || file_exists($final) || !mkdir($stage, 0755)) throw new RuntimeException(__('Cannot create a thumbnail staging directory.', 'live2d-show'));
            $owned = true;
            $path = $stage . '/image.png';
            if (file_put_contents($path, $bytes, LOCK_EX) !== strlen($bytes) || !hash_equals(hash('sha256', $bytes), hash_file('sha256', $path))) throw new RuntimeException(__('Thumbnail write verification failed.', 'live2d-show'));
            if (!rename($stage, $final)) throw new RuntimeException(__('Thumbnail commit failed.', 'live2d-show'));
            $stage = null;
            $config['characters'][$id]['thumbnail'] = $dirname . '/image.png';
            if (!wzf_mascot_resources_update($config)) throw new RuntimeException(__('Cannot save thumbnail configuration.', 'live2d-show'));
            $saved = true;
        } finally { if ($owned && !$saved) wzf_mascot_cleanup($stage ?? $final); }
    }, 'thumbnail');
}
function wzf_mascot_thumbnail_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_thumbnail');
    $id = isset($_POST['character']) && is_string($_POST['character']) ? wp_unslash($_POST['character']) : '';
    try {
        $version = isset($_POST['version']) && is_string($_POST['version']) ? wp_unslash($_POST['version']) : '';
        $operation = $_POST['operation'] ?? null;
        if ($operation === 'clear') wzf_mascot_save_thumbnail($id, $version);
        elseif ($operation === 'upload') {
            if (($_POST['rights'] ?? '') !== '1') throw new RuntimeException(__('Confirm your right to use the thumbnail.', 'live2d-show'));
            $upload = $_FILES['thumbnail'] ?? null;
            if (!is_array($upload) || ($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_string($upload['tmp_name'] ?? null) || !is_uploaded_file($upload['tmp_name'])) throw new RuntimeException(__('Thumbnail upload failed.', 'live2d-show'));
            wzf_mascot_save_thumbnail($id, $version, $upload['tmp_name']);
        } else throw new RuntimeException(__('Thumbnail operation is invalid.', 'live2d-show'));
        $notice = $operation === 'clear' ? __('Thumbnail reference cleared; the original file is retained.', 'live2d-show') : __('Thumbnail uploaded and re-encoded.', 'live2d-show');
    } catch (Throwable $e) { $notice = wzf_mascot_error_message($e); }
    wp_safe_redirect(add_query_arg(['mascot_notice'=>rawurlencode($notice),'character'=>$id], admin_url('options-general.php?page=wzf-mascot')));
    exit;
}
function wzf_mascot_admin_thumbnail($character) {
    $url = wzf_mascot_thumbnail_url($character);
    $name = is_array($character) && is_string($character['name'] ?? null) ? $character['name'] : __('Character', 'live2d-show');
    if ($url !== null) echo '<img class="wzf-mascot-admin-thumbnail" src="' . esc_url($url) . '" alt="' . esc_attr(sprintf(__('Thumbnail of %1$s', 'live2d-show'), $name)) . '" loading="lazy" width="64" height="64">';
    else echo '<span class="wzf-mascot-admin-initials" aria-label="' . esc_attr(sprintf(__('%s has no thumbnail', 'live2d-show'), $name)) . '">' . esc_html(function_exists('mb_substr') ? mb_substr($name, 0, 2) : substr($name, 0, 1)) . '</span>';
}
function wzf_mascot_thumbnail_fields($config, $id) {
    wp_nonce_field('wzf_mascot_thumbnail');
    echo '<input type="hidden" name="action" value="wzf_mascot_thumbnail"><input type="hidden" name="character" value="' . esc_attr($id) . '"><input type="hidden" name="version" value="' . esc_attr(wzf_mascot_config_version($config)) . '">';
}
function wzf_mascot_thumbnail_panel($config, $id) {
    echo ('<section class="wzf-mascot-card"><h2>' . esc_html__('Character thumbnail', 'live2d-show') . '</h2>');
    wzf_mascot_admin_thumbnail($config['characters'][$id]);
    echo ('<p class="description">' . esc_html__('Used for candidate previews; no images are automatically generated or fetched. PNG/JPEG/WebP up to 4 MiB, dimensions up to 2048 (4M pixels). Decoded images are resized to a maximum edge of 512 and re-encoded as PNG, removing metadata and trailing content. Stored separately; model updates and rollbacks do not change it.', 'live2d-show') . '</p><form method="post" enctype="multipart/form-data" action="') . esc_url(admin_url('admin-post.php')) . '">';
    wzf_mascot_thumbnail_fields($config, $id);
    echo ('<input type="hidden" name="operation" value="upload"><div class="wzf-mascot-field"><label for="mascot-thumbnail">' . esc_html__('Choose an image', 'live2d-show') . '</label><input id="mascot-thumbnail" type="file" name="thumbnail" accept="image/png,image/jpeg,image/webp" required></div><p><label><input type="checkbox" name="rights" value="1" required> ' . esc_html__('I have the right to use this image on this site and have read its source license and terms.', 'live2d-show') . '</label></p>');
    submit_button(__('Save thumbnail', 'live2d-show')); echo '</form>';
    if (array_key_exists('thumbnail', $config['characters'][$id])) {
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wzf_mascot_thumbnail_fields($config, $id);
        echo ('<p><button class="button" name="operation" value="clear">' . esc_html__('Clear thumbnail reference (retain file)', 'live2d-show') . '</button></p></form>');
    }
    echo '</section>';
}
add_action('admin_post_wzf_mascot_thumbnail', 'wzf_mascot_thumbnail_post');
