<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
function wzf_mascot_character_status($character) {
    return $character['status'] ?? 'active';
}
function wzf_mascot_status_label($status) {
    $labels = ['active'=>__('Active', 'live2d-show'), 'disabled'=>__('Disabled', 'live2d-show'), 'trash'=>__('Trash', 'live2d-show')];
    return is_string($status) ? ($labels[$status] ?? __('Invalid status', 'live2d-show')) : __('Invalid status', 'live2d-show');
}
function wzf_mascot_locked_character($id, $version, $callback, $kind = 'lifecycle') {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    if (!is_string($id) || !is_string($version) || !preg_match('/\A[0-9a-f]{64}\z/D', $version)) throw new RuntimeException(__('Character management request is invalid.', 'live2d-show'));
    $task = wzf_mascot_task_begin($kind);
    $token = $task['token'];
    try {
        $config = $task['config'];
        if (!hash_equals(wzf_mascot_config_version($config), $version)) throw new RuntimeException(__('Another request changed the resource configuration. Refresh before trying again.', 'live2d-show'));
        if (!is_array($config) || !is_array($config['characters'] ?? null) || !is_array($config['characters'][$id] ?? null)) throw new RuntimeException(__('The character does not exist or its configuration is invalid.', 'live2d-show'));
        return $callback($config, $token);
    } finally {
        wzf_mascot_task_end($task);
    }
}
function wzf_mascot_manage_character($id, $version, $operation) {
    if (!in_array($operation, ['disable','enable','trash','restore','rollback'], true)) throw new RuntimeException(__('Character management operation is invalid.', 'live2d-show'));
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
            if (!is_array($previous)) throw new RuntimeException(__('No previous character resources are available for rollback.', 'live2d-show'));
            // Roll back resources and their motion references, retaining current presentation/state.
            $rollback = array_replace($c, array_intersect_key($previous, array_flip(['root','file','idle','welcome','greetings'])));
            if (array_key_exists('presets', $previous)) {
                $rollback['presets'] = wzf_mascot_current_presets($previous);
                $rollback['presetWarnings'] = is_array($previous['presets']) ? max(0, count($previous['presets']) - count($rollback['presets'])) : 1;
            } else { unset($rollback['presets'], $rollback['presetWarnings']); }
            if (array_key_exists('motions', $previous['dialogue']['idle'] ?? [])) $rollback['dialogue']['idle']['motions'] = wzf_mascot_chatter_motions($previous['dialogue']['idle']['motions'], wzf_mascot_character_catalog($rollback));
            else unset($rollback['dialogue']['idle']['motions']);
            $rollback['captureAllowed'] = false;
            $rollback['hitBindings'] = wzf_mascot_hit_bindings($previous['hitBindings'] ?? [], wzf_mascot_character_hit_names($rollback), $rollback['presets'] ?? []);
            $rollback['hitWarnings'] = is_array($previous['hitBindings'] ?? null) ? max(0,count($previous['hitBindings'])-count($rollback['hitBindings'])) : 0;
            wzf_mascot_character_runtime_files($rollback);
            wzf_mascot_character_catalog($rollback);
            $config['history'][$id] = $c; $c = $rollback;
        } else throw new RuntimeException(__('The character status has changed. Refresh before trying again.', 'live2d-show'));
        $config['characters'][$id] = $c;
        if (!wzf_mascot_resources_update($config)) throw new RuntimeException(__('Cannot save character management changes.', 'live2d-show'));
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
    if ($idle === null) $missing[] = __('idle', 'live2d-show');
    $welcome = null;
    if (($character['welcome'] ?? null) !== null && $character['welcome'] !== '') {
        $welcome = $map($character['welcome']);
        if ($welcome === null) $missing[] = __('welcome', 'live2d-show');
    }
    $greetings = [];
    foreach (wzf_mascot_list($character['greetings'] ?? [], 'Greetings') as $id) {
        $mapped = $map($id);
        if ($mapped === null) $missing[] = __('greeting', 'live2d-show');
        elseif (!in_array($mapped, $greetings, true)) $greetings[] = $mapped;
    }
    if ($missing && !$reset) throw new RuntimeException(sprintf(__('The new model cannot preserve %s motions by file path. Configuration is unchanged. Review and select “Allow incompatible motion reset” before uploading again.', 'live2d-show'), implode(', ', array_unique($missing))));
    return ['idle'=>$idle ?? $default_idle,'welcome'=>$welcome,'greetings'=>$greetings];
}
function wzf_mascot_replace_resource($file, $id, $version, $reset = false) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    if (!is_file($file) || is_link($file) || !is_bool($reset)) throw new RuntimeException(__('The uploaded file or update request is invalid.', 'live2d-show'));
    $model = wzf_mascot_model_zip($file);
    wzf_mascot_locked_character($id, $version, function($config, $token) use ($id, $model, $reset) {
        $c = $config['characters'][$id];
        if (!in_array(wzf_mascot_character_status($c), ['active','disabled'], true)) throw new RuntimeException(__('Restore the character to a valid status before updating resources.', 'live2d-show'));
        if (isset($config['history']) && !is_array($config['history'])) throw new RuntimeException(__('Character history configuration is invalid.', 'live2d-show'));
        $old = wzf_mascot_character_catalog($c);
        $new_catalog = wzf_mascot_json($model['files']['catalog.json']);
        $new = $new_catalog['motions'];
        $mapped = wzf_mascot_remap_motions($c, $old, $new, $model['idle'], $reset);
        $mapped = array_replace($mapped, wzf_mascot_remap_presets($c, $old, $new_catalog));
        $mapped['captureAllowed'] = false;
        $mapped['hitBindings'] = wzf_mascot_hit_bindings($c['hitBindings'] ?? [], wzf_mascot_hit_names(wzf_mascot_json($model['files'][$model['file']])), $mapped['presets']);
        $mapped['hitWarnings'] = is_array($c['hitBindings'] ?? null) ? max(0,count($c['hitBindings'])-count($mapped['hitBindings'])) : 0;
        $u = wzf_mascot_uploads(true);
        $dirname = 'model-' . $token;
        $stage = $u['path'] . '/stage-' . $token; $final = $u['path'] . '/' . $dirname;
        $owned = false; $saved = false;
        try {
            if (file_exists($stage) || file_exists($final) || !mkdir($stage, 0755)) throw new RuntimeException(__('Cannot create an isolated staging directory.', 'live2d-show'));
            $owned = true;
            foreach ($model['files'] as $relative=>$raw) {
                $path = $stage . '/' . wzf_mascot_path($relative);
                if (!is_dir(dirname($path)) && !wp_mkdir_p(dirname($path))) throw new RuntimeException(__('Cannot create a resource directory.', 'live2d-show'));
                if (file_put_contents($path, $raw, LOCK_EX) !== strlen($raw) || !hash_equals(hash('sha256', $raw), hash_file('sha256', $path))) throw new RuntimeException(__('Resource write verification failed.', 'live2d-show'));
            }
            if (!rename($stage, $final)) throw new RuntimeException(__('Resource commit failed.', 'live2d-show'));
            $stage = null;
            $config['history'][$id] = $c;
            $config['characters'][$id] = array_replace($c, $mapped, ['root'=>$dirname . '/', 'file'=>$model['file']]);
            if (!wzf_mascot_resources_update($config)) throw new RuntimeException(__('Cannot save the character resource update.', 'live2d-show'));
            $saved = true;
        } finally {
            if ($owned && !$saved) wzf_mascot_cleanup($stage ?? $final);
        }
    }, 'replace');
}
function wzf_mascot_manage_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    wzf_mascot_upload_referer('wzf_mascot_manage');
    $id = isset($_POST['character']) && is_string($_POST['character']) ? wp_unslash($_POST['character']) : '';
    try {
        $version = isset($_POST['version']) && is_string($_POST['version']) ? wp_unslash($_POST['version']) : '';
        $operation = isset($_POST['operation']) && is_string($_POST['operation']) ? wp_unslash($_POST['operation']) : '';
        if ($operation === 'replace') {
            if (($_POST['rights'] ?? '') !== '1') throw new RuntimeException(__('Confirm your right to use the uploaded resources.', 'live2d-show'));
            $upload = wzf_mascot_resource_upload();
            if (isset($_POST['reset_motions']) && $_POST['reset_motions'] !== '1') throw new RuntimeException(__('Update confirmation is invalid.', 'live2d-show'));
            wzf_mascot_replace_resource($upload['tmp_name'], $id, $version, ($_POST['reset_motions'] ?? '') === '1');
            $notice = __('Character resources updated. The previous version is available for rollback.', 'live2d-show');
        } else {
            wzf_mascot_manage_character($id, $version, $operation);
            $notice = __('Character management changes saved.', 'live2d-show');
        }
    } catch (Throwable $e) { $notice = wzf_mascot_error_message($e); }
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
    echo ('<section class="wzf-mascot-card"><h2>' . esc_html(sprintf(__('Resources and status · %s', 'live2d-show'), $c['name'] ?? $id))) . ('</h2><p class="description">' . esc_html__('Disabling or trashing hides the character from the frontend while retaining files, browser favorites and selections. Restoring makes it available again. Trash never permanently deletes resources.', 'live2d-show') . '</p><div class="wzf-mascot-actions">');
    $buttons = $status === 'trash' ? ['restore'=>__('Restore from trash', 'live2d-show')] : ($status === 'disabled' ? ['enable'=>__('Enable character', 'live2d-show'),'trash'=>__('Move to trash', 'live2d-show')] : ['disable'=>__('Disable character', 'live2d-show'),'trash'=>__('Move to trash', 'live2d-show')]);
    if (is_array($config['history'][$id] ?? null)) $buttons['rollback'] = __('Roll back to previous resources and motions', 'live2d-show');
    foreach ($buttons as $operation=>$label) {
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php?action=wzf_mascot_manage')) . '">';
        wzf_mascot_management_fields($config, $id);
        echo '<button class="button" name="operation" value="' . esc_attr($operation) . '">' . esc_html($label) . '</button></form>';
    }
    echo '</div>';
    if ($status !== 'trash') {
        echo ('<details class="wzf-mascot-replace"><summary>' . esc_html__('Update this character’s model ZIP', 'live2d-show') . '</summary><p>' . esc_html__('Retains character ID, name, credit, layout and other display settings. New resources use a separate directory; old files remain for caches and rollback. Rollback restores only resources and motions, preserving current display settings and status. Motions map by relative file path; incompatible changes are rejected by default.', 'live2d-show') . '</p><form method="post" enctype="multipart/form-data" action="') . esc_url(admin_url('admin-post.php?action=wzf_mascot_manage')) . '">';
        wzf_mascot_management_fields($config, $id);
        echo ('<input type="hidden" name="operation" value="replace"><div class="wzf-mascot-field"><label for="mascot-replacement">' . esc_html__('New single-model runtime ZIP', 'live2d-show') . '</label><input id="mascot-replacement" type="file" name="resource" required accept=".zip"></div><p><label><input type="checkbox" name="reset_motions" value="1"> ' . esc_html__('Allow incompatible motion reset: use the new default idle if unmappable and remove unmappable welcome/greetings. Preserve compatible motions and greeting order.', 'live2d-show') . '</label></p><p><label><input type="checkbox" name="rights" value="1" required> ' . esc_html__('I have the right to use the new resources on this site and have read their source licenses and terms.', 'live2d-show') . '</label></p>');
        submit_button(__('Update character resources', 'live2d-show')); echo '</form></details>';
    }
    echo '</section>';
}
add_action('admin_post_wzf_mascot_manage', 'wzf_mascot_manage_post');
