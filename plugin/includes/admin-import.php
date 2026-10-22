<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
require_once __DIR__ . '/i18n.php';
const WZF_MASCOT_CORE_SHA = '8741f739779b5d5210872bd3d7d99f0f1e56e6c87409e7d26d6bb4b80aa1ef47';
const WZF_MASCOT_OPTION = 'wzf_mascot_resources_v1';
const WZF_MASCOT_LOCK = 'wzf_mascot_import_lock_v1';
require_once __DIR__ . '/admin-task.php';
function wzf_mascot_path($name) {
    if (!is_string($name) || !preg_match('~\A[A-Za-z0-9_.\-/]+\z~D', $name) || $name[0] === '/' || strpos($name, '//') !== false) throw new RuntimeException(__('Resource path is invalid.', 'live2d-show'));
    foreach (explode('/', $name) as $part) if ($part === '' || $part === '.' || $part === '..' || preg_match('/(?:^|\.)(?:php[0-9]*|phtml|phar|cgi|pl|py|sh|asp|aspx)(?:\.|$)/i', $part)) throw new RuntimeException(__('Resource path escapes the allowed directory.', 'live2d-show'));
    return $name;
}
// Installed runtime references only. ZIP entries, roots and Core remain strict.
function wzf_mascot_installed_reference($name) {
    if (!is_string($name) || strlen($name) > 1024 || !preg_match('~\A[A-Za-z0-9_. /-]+\z~D', $name)) throw new RuntimeException(__('Resource path is invalid.', 'live2d-show'));
    foreach (explode('/', $name) as $part) if (trim($part) !== $part) throw new RuntimeException(__('Resource path is invalid.', 'live2d-show'));
    // Reuse every traversal and executable-component check after replacing spaces.
    wzf_mascot_path(str_replace(' ', '_', $name));
    return $name;
}
function wzf_mascot_no_links($path) {
    $cursor = $path;
    while ($cursor !== dirname($cursor)) {
        if (is_link($cursor)) throw new RuntimeException(__('Resource paths must not use symbolic links.', 'live2d-show'));
        $cursor = dirname($cursor);
    }
    return $path;
}
function wzf_mascot_uploads($create = false) {
    $u = wp_upload_dir(null, $create);
    if (!empty($u['error'])) throw new RuntimeException(__('The uploads directory is unavailable.', 'live2d-show'));
    $base = wzf_mascot_no_links(rtrim($u['basedir'], '/') . '/wzf-mascot');
    wzf_mascot_guard_assert_root($base);
    if ($create) {
        if (!is_dir($base) && !wp_mkdir_p($base)) throw new RuntimeException(__('Cannot create the resource directory.', 'live2d-show'));
        $guards = ['index.html'=>'', '.htaccess'=>"Options -Indexes\n<FilesMatch \"\\.(php[0-9]*|phtml|phar|cgi|pl|py|sh|asp|aspx)(\\.|$)\">\nRequire all denied\n</FilesMatch>\n", 'web.config'=>'<configuration><system.webServer><directoryBrowse enabled="false"/><security><requestFiltering><fileExtensions><add fileExtension=".php" allowed="false"/><add fileExtension=".phtml" allowed="false"/><add fileExtension=".phar" allowed="false"/></fileExtensions></requestFiltering></security></system.webServer></configuration>'];
        foreach ($guards as $name=>$bytes) {
            $path = wzf_mascot_no_links($base . '/' . $name);
            if (!file_exists($path) && file_put_contents($path, $bytes, LOCK_EX) !== strlen($bytes)) throw new RuntimeException(__('Cannot write the directory protection files.', 'live2d-show'));
        }
    }
    return ['path'=>$base, 'url'=>rtrim($u['baseurl'], '/') . '/wzf-mascot/'];
}
function wzf_mascot_json($raw) {
    if (strlen($raw) > 8 * 1024 * 1024) throw new RuntimeException(__('The JSON file is too large.', 'live2d-show'));
    $v = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($v) || !str_starts_with(ltrim($raw), '{')) throw new RuntimeException(__('JSON must be an object.', 'live2d-show'));
    return $v;
}
function wzf_mascot_list($value, $label) {
    if (!is_array($value) || !array_is_list($value)) throw new RuntimeException(sprintf(__('%s must be an array.', 'live2d-show'), $label));
    return $value;
}
function wzf_mascot_model_zip($path) {
    if (!class_exists('ZipArchive')) throw new RuntimeException(__('The server requires PHP ZipArchive.', 'live2d-show'));
    if (filesize($path) > 64 * 1024 * 1024) throw new RuntimeException(__('ZIP must not exceed 64 MiB.', 'live2d-show'));
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::RDONLY) !== true) throw new RuntimeException(__('The ZIP is invalid.', 'live2d-show'));
    try {
        if ($zip->numFiles < 1 || $zip->numFiles > 1000) throw new RuntimeException(__('The ZIP entry count exceeds the limit.', 'live2d-show'));
        $files = []; $names = []; $total = 0; $actual_total = 0; $models = [];
        for ($i=0; $i<$zip->numFiles; $i++) {
            $s = $zip->statIndex($i);
            if (!$s || !empty($s['encryption_method'])) throw new RuntimeException(__('Encrypted ZIP files are not supported.', 'live2d-show'));
            $dir = str_ends_with($s['name'], '/');
            $name = wzf_mascot_path($dir ? substr($s['name'], 0, -1) : $s['name']);
            $key = strtolower($name);
            if (isset($names[$key])) throw new RuntimeException(__('The ZIP contains duplicate paths.', 'live2d-show'));
            $names[$key] = true;
            $zip->getExternalAttributesIndex($i, $opsys, $attr);
            $mode = ($attr >> 16) & 0170000;
            if ($opsys === 3 && $mode !== 0 && $mode !== ($dir ? 0040000 : 0100000)) throw new RuntimeException(__('The ZIP must not contain symbolic links or special files.', 'live2d-show'));
            if ($dir) continue;
            if (!preg_match('~\.(moc3|png|model3\.json|motion3\.json|exp3\.json|physics3\.json|pose3\.json|userdata3\.json|cdi3\.json)$~i', $name) && !str_ends_with($name, '/catalog.json') && $name !== 'catalog.json') throw new RuntimeException(__('The ZIP contains non-runtime resources. Upload only the exported runtime files of one model.', 'live2d-show'));
            if ($s['size'] > 64 * 1024 * 1024 || ($s['size'] > 1024 * 1024 && $s['size'] > max(1, $s['comp_size']) * 1000)) throw new RuntimeException(__('A ZIP file is too large or has an abnormal compression ratio.', 'live2d-show'));
            $total += $s['size'];
            if ($total > 64 * 1024 * 1024) throw new RuntimeException(__('The total expanded ZIP size exceeds 64 MiB.', 'live2d-show'));
            $raw = $zip->getFromIndex($i, min($s['size'] + 1, 64 * 1024 * 1024 + 1));
            if ($raw === false || strlen($raw) !== $s['size']) throw new RuntimeException(__('Cannot read a ZIP entry.', 'live2d-show'));
            $actual_total += strlen($raw);
            if ($actual_total > 64 * 1024 * 1024) throw new RuntimeException(__('The actual expanded size exceeds the limit.', 'live2d-show'));
            if (str_ends_with($name, '.json')) wzf_mascot_json($raw);
            $files[$name] = $raw;
            if (str_ends_with($name, '.model3.json')) $models[] = $name;
        }
        if (count($models) !== 1) throw new RuntimeException(__('The ZIP must contain exactly one model3.json.', 'live2d-show'));
        $model_name = $models[0]; $prefix = dirname($model_name); $prefix = $prefix === '.' ? '' : $prefix . '/';
        $model = wzf_mascot_json($files[$model_name]);
        if (($model['Version'] ?? null) !== 3 || !isset($model['FileReferences']) || !is_array($model['FileReferences'])) throw new RuntimeException(__('A Version 3 Cubism runtime model is required.', 'live2d-show'));
        $refs = $model['FileReferences'];
        if (array_diff(array_keys($refs), ['Moc','Textures','Physics','Pose','UserData','DisplayInfo','Motions','Expressions'])) throw new RuntimeException(__('The model contains unsupported reference types.', 'live2d-show'));
        $selected = [basename($model_name)=>$files[$model_name]];
        $take = function($relative, $suffix) use ($prefix, $files, &$selected) {
            $relative = wzf_mascot_path($relative);
            if (!str_ends_with($relative, $suffix) || !array_key_exists($prefix . $relative, $files)) throw new RuntimeException(__('A model reference is missing or has an invalid format.', 'live2d-show'));
            $selected[$relative] = $files[$prefix . $relative];
            return $selected[$relative];
        };
        $moc = $take($refs['Moc'] ?? null, '.moc3');
        if (substr($moc, 0, 4) !== 'MOC3') throw new RuntimeException(__('The MOC3 header is invalid.', 'live2d-show'));
        $textures = wzf_mascot_list($refs['Textures'] ?? null, 'Textures');
        if (!$textures || count($textures) > 16) throw new RuntimeException(__('Between 1 and 16 textures are required.', 'live2d-show'));
        foreach ($textures as $name) {
            $raw = $take($name, '.png');
            $image = @getimagesizefromstring($raw);
            if (strlen($raw) > 32 * 1024 * 1024 || !$image || $image[2] !== IMAGETYPE_PNG || $image[0] > 8192 || $image[1] > 8192) throw new RuntimeException(__('A PNG texture is invalid or too large.', 'live2d-show'));
        }
        foreach (['Physics','Pose','UserData','DisplayInfo'] as $field) if (isset($refs[$field])) $take($refs[$field], '.json');
        $motions = []; $expressions = []; $idle = null;
        $groups = $refs['Motions'] ?? [];
        if (!is_array($groups)) throw new RuntimeException(__('Motions is invalid.', 'live2d-show'));
        foreach ($groups as $group=>$items) foreach (wzf_mascot_list($items, 'Motion group') as $item) {
            if (!is_array($item) || isset($item['Sound'])) throw new RuntimeException(__('Sound references are not supported.', 'live2d-show'));
            $take($item['File'] ?? null, '.motion3.json');
            $id = 'motion-' . (count($motions) + 1);
            $motions[] = ['id'=>$id,'file'=>$item['File'],'label'=>(string)$group . ' ' . (count($motions) + 1)];
            if ($idle === null) $idle = $id;
        }
        if (!$motions) throw new RuntimeException(__('The model requires at least one valid motion for idle playback.', 'live2d-show'));
        // Deterministically prefer the first Idle entry, never the last one.
        $index = 0;
        foreach ($groups as $group=>$items) {
            if (strtolower((string)$group) === 'idle' && count($items)) { $idle = 'motion-' . ($index + 1); break; }
            $index += count($items);
        }
        foreach (wzf_mascot_list($refs['Expressions'] ?? [], 'Expressions') as $item) {
            if (!is_array($item) || !is_string($item['Name'] ?? null) || strlen($item['Name']) > 200) throw new RuntimeException(__('Expression is invalid.', 'live2d-show'));
            $take($item['File'] ?? null, '.exp3.json');
            $expressions[] = ['id'=>'expression-' . (count($expressions) + 1),'file'=>$item['File'],'label'=>$item['Name']];
        }
        $selected['catalog.json'] = json_encode(['motions'=>$motions,'expressions'=>$expressions], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        return ['files'=>$selected, 'file'=>basename($model_name), 'idle'=>$idle];
    } finally { $zip->close(); }
}
function wzf_mascot_cleanup($path) {
    if (!is_dir($path) || is_link($path)) return;
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $item) {
        if ($item->isDir() && !$item->isLink()) rmdir($item->getPathname()); else unlink($item->getPathname());
    }
    rmdir($path);
}
function wzf_mascot_save_resource($kind, $file, $fields = []) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    if ($kind !== 'core' && $kind !== 'model') throw new RuntimeException(__('Import type is invalid.', 'live2d-show'));
    $id = $fields['id'] ?? ''; $name = $fields['name'] ?? ''; $credit = $fields['credit'] ?? '';
    if ($kind === 'model' && (!is_string($id) || !preg_match('/\A[a-z][a-z0-9-]{0,63}\z/D', $id) || in_array($id,['constructor','prototype'],true) || !is_string($name) || trim($name) === '' || strlen($name)>200 || strip_tags($name)!==$name || !is_string($credit) || strlen($credit)>300 || strip_tags($credit)!==$credit || preg_match('/[\x00-\x1f\x7f]/', $name . $credit))) throw new RuntimeException(__('Character ID, name or credit is invalid.', 'live2d-show'));
    if (!is_file($file) || is_link($file)) throw new RuntimeException(__('The uploaded file is invalid.', 'live2d-show'));
    if ($kind === 'core') {
        $core_bytes = filesize($file) <= 8 * 1024 * 1024 ? file_get_contents($file) : false;
        if ($core_bytes === false || !hash_equals(WZF_MASCOT_CORE_SHA, hash('sha256',$core_bytes))) throw new RuntimeException(__('Only the verified Web 5 R5 live2dcubismcore.min.js is accepted; SHA256 does not match.', 'live2d-show'));
        $payload = ['core.js'=>$core_bytes];
    } else { $model = wzf_mascot_model_zip($file); $payload = $model['files']; }
    $task = wzf_mascot_task_begin('import-' . $kind);
    $token = $task['token'];
    $stage = null; $final = null; $saved = false; $owned_final = false;
    try {
        $u = wzf_mascot_uploads(true);
        $dirname = $kind . '-' . $token;
        $stage = $u['path'] . '/stage-' . $token; $final = $u['path'] . '/' . $dirname;
        if (file_exists($stage) || file_exists($final) || !mkdir($stage,0755)) throw new RuntimeException(__('Cannot create an isolated staging directory.', 'live2d-show'));
        foreach ($payload as $relative=>$raw) {
            $path = $stage . '/' . wzf_mascot_path($relative);
            if (!is_dir(dirname($path)) && !wp_mkdir_p(dirname($path))) throw new RuntimeException(__('Cannot create a resource directory.', 'live2d-show'));
            if (file_put_contents($path,$raw,LOCK_EX)!==strlen($raw) || !hash_equals(hash('sha256',$raw),hash_file('sha256',$path))) throw new RuntimeException(__('Resource write verification failed.', 'live2d-show'));
        }
        if (!rename($stage,$final)) throw new RuntimeException(__('Resource commit failed.', 'live2d-show'));
        $stage = null; $owned_final = true;
        $config = $task['config'];
        if (!is_array($config) || !is_array($config['characters'] ?? null)) throw new RuntimeException(__('Existing resource configuration is invalid.', 'live2d-show'));
        if ($kind === 'core') $config['core'] = ['path'=>$dirname . '/core.js','sha256'=>WZF_MASCOT_CORE_SHA];
        else {
            if (isset($config['characters'][$id])) throw new RuntimeException(__('This character ID already exists. Use a new ID; the existing character will not be overwritten.', 'live2d-show'));
            $config['characters'][$id] = ['name'=>trim($name),'root'=>$dirname . '/', 'file'=>$model['file'],'idle'=>$model['idle'],'greetings'=>[], 'welcome'=>null,'size'=>180,'offset'=>0,'credit'=>$credit ?: ''];
        }
        if (!wzf_mascot_resources_update($config)) throw new RuntimeException(__('Cannot save configuration.', 'live2d-show'));
        $saved = true;
    } finally {
        try {
            if ($stage) wzf_mascot_cleanup($stage);
            if (!$saved && $owned_final) wzf_mascot_cleanup($final);
        } finally { wzf_mascot_task_end($task); }
    }
}
function wzf_mascot_import_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    wzf_mascot_upload_referer('wzf_mascot_import');
    $kind = isset($_POST['kind']) && is_string($_POST['kind']) ? wp_unslash($_POST['kind']) : '';
    try {
        if (($_POST['rights'] ?? '') !== '1') throw new RuntimeException(__('Confirm your right to use the uploaded resources.', 'live2d-show'));
        $upload = wzf_mascot_resource_upload();
        $fields = [];
        foreach (['id','name','credit'] as $key) $fields[$key] = isset($_POST[$key]) && is_string($_POST[$key]) ? wp_unslash($_POST[$key]) : '';
        wzf_mascot_save_resource($kind,$upload['tmp_name'],$fields);
        $notice = __('Resources imported.', 'live2d-show');
    } catch (Throwable $e) { $notice = wzf_mascot_error_message($e) . ' ' . wzf_mascot_import_guidance($kind); }
    wp_safe_redirect(add_query_arg('mascot_notice', rawurlencode($notice), admin_url('options-general.php?page=wzf-mascot')));
    exit;
}
require_once __DIR__ . '/admin-settings.php';
add_action('admin_menu', function() { add_options_page('WordPress Live2D Mascot','Live2D Mascot','manage_options','wzf-mascot','wzf_mascot_admin_page'); });
add_action('admin_post_wzf_mascot_import','wzf_mascot_import_post');
