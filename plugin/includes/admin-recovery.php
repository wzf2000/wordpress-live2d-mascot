<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;

function wzf_mascot_recovery_error() { return new RuntimeException(__('Resource recovery checks failed. Refresh the review; retain both storage locations for inspection.', 'live2d-show')); }
function wzf_mascot_recovery_name($name) {
    if (!is_string($name) || !preg_match('/\A(?:model|thumbnail)-[0-9a-f]{32}\z/D', $name)) throw wzf_mascot_recovery_error();
    return $name;
}
function wzf_mascot_recovery_inside($a, $b) { return $a === $b || str_starts_with($a, $b . '/'); }
function wzf_mascot_recovery_base() {
    if (!defined('WZF_MASCOT_RECOVERY_DIR') || !is_string(WZF_MASCOT_RECOVERY_DIR) || WZF_MASCOT_RECOVERY_DIR === '') throw new RuntimeException(__('Recovery is read-only until the server administrator configures WZF_MASCOT_RECOVERY_DIR as a persistent private directory outside the web root.', 'live2d-show'));
    $raw = rtrim(WZF_MASCOT_RECOVERY_DIR, '/');
    if ($raw === '' || $raw[0] !== '/') throw wzf_mascot_recovery_error();
    wzf_mascot_no_links($raw); $base = realpath($raw);
    if ($base === false || $base !== $raw || !is_dir($base) || !is_readable($base) || !is_writable($base)) throw wzf_mascot_recovery_error();
    $stat = lstat($base);
    foreach ([ABSPATH, wp_upload_dir()['basedir'], $_SERVER['DOCUMENT_ROOT'] ?? '', defined('WP_CONTENT_DIR') ? WP_CONTENT_DIR : ''] as $public) {
        if (!is_string($public) || $public === '') continue;
        $public = realpath($public) ?: rtrim($public, '/');
        if (wzf_mascot_recovery_inside($base, $public) || wzf_mascot_recovery_inside($public, $base)) throw wzf_mascot_recovery_error();
    }
    $uploads = wzf_mascot_uploads()['path'];
    if (wzf_mascot_guard_root_identity($uploads)['dev'] !== (string)$stat['dev']) throw new RuntimeException(__('Recovery storage must be on the same filesystem as the resource directory.', 'live2d-show'));
    if (($stat['mode'] & 0077) !== 0) throw new RuntimeException(__('The recovery directory must be private to its server owner (0700).', 'live2d-show'));
    return $base;
}
function wzf_mascot_recovery_blog($create = false) {
    $path = wzf_mascot_recovery_base() . '/blog-' . (int)get_current_blog_id();
    wzf_mascot_no_links($path);
    if (!file_exists($path) && $create && !mkdir($path, 0700)) throw wzf_mascot_recovery_error();
    if (file_exists($path) && (!is_dir($path) || (lstat($path)['mode'] & 0077) !== 0)) throw wzf_mascot_recovery_error();
    return $path;
}
function wzf_mascot_recovery_hmac($value) { return hash_hmac('sha256', serialize($value), wp_salt('auth')); }
function wzf_mascot_recovery_record_dir($id) {
    if (!is_string($id) || !preg_match('/\A[0-9a-f]{32}\z/D', $id)) throw wzf_mascot_recovery_error();
    return wzf_mascot_no_links(wzf_mascot_recovery_blog() . '/' . $id);
}
// The sorted manifest records logical bytes, not allocated blocks. No recursive
// cleanup is used here or in purge. A changed file invalidates the entire review.
function wzf_mascot_recovery_tree($root, $partial = false) {
    $start = microtime(true); $pending = ['']; $entries = []; $bytes = 0; $latest = 0;
    while ($pending) {
        $rel = array_pop($pending); $path = wzf_mascot_no_links($root . ($rel === '' ? '' : '/' . $rel));
        clearstatcache(true, $path); $s = @lstat($path);
        if (!$s || !is_readable($path) || !in_array($s['mode'] & 0170000, [0040000,0100000], true) || $s['mtime'] <= 0 || $s['mtime'] > time() || count($entries) >= 4000 || microtime(true) - $start > 3) throw wzf_mascot_recovery_error();
        $directory = ($s['mode'] & 0170000) === 0040000;
        if (!$directory && ($s['nlink'] !== 1 || $s['size'] > 64 * 1024 * 1024)) throw wzf_mascot_recovery_error();
        $row = ['directory'=>$directory,'dev'=>(string)$s['dev'],'ino'=>(string)$s['ino'],'mode'=>$s['mode'],'uid'=>$s['uid'],'gid'=>$s['gid'],'mtime'=>$s['mtime'],'bytes'=>$directory ? 0 : $s['size'],'sha256'=>null];
        if ($directory) {
            foreach (new FilesystemIterator($path, FilesystemIterator::SKIP_DOTS) as $item) {
                if (count($entries) + count($pending) >= 3999 || microtime(true) - $start > 3) throw wzf_mascot_recovery_error();
                $name = $item->getFilename(); wzf_mascot_installed_reference($name);
                $pending[] = ($rel === '' ? '' : $rel . '/') . $name;
            }
        } else {
            $row['sha256'] = hash_file('sha256', $path);
            clearstatcache(true, $path); $after = @lstat($path);
            if (!$after || array_intersect_key($after, array_flip(['dev','ino','mode','nlink','uid','gid','size','mtime','ctime'])) !== array_intersect_key($s, array_flip(['dev','ino','mode','nlink','uid','gid','size','mtime','ctime'])) || !is_string($row['sha256'])) throw wzf_mascot_recovery_error();
            $bytes += $s['size']; if ($bytes > 64 * 1024 * 1024) throw wzf_mascot_recovery_error();
        }
        $latest = max($latest, $s['mtime']); $entries[$rel] = $row;
    }
    ksort($entries, SORT_STRING);
    return ['entries'=>$entries,'bytes'=>$bytes,'latest'=>$latest,'hash'=>hash('sha256', serialize($entries))];
}
function wzf_mascot_recovery_model($name, $tree) {
    $base = wzf_mascot_uploads()['path'] . '/' . $name;
    $files = array_filter($tree['entries'], function($row) { return !$row['directory']; });
    if (str_starts_with($name, 'thumbnail-')) {
        if (array_keys($files) !== ['image.png'] || array_keys($tree['entries']) !== ['', 'image.png']) throw wzf_mascot_recovery_error();
        $image = @getimagesize($base . '/image.png');
        if (!$image || $image[2] !== IMAGETYPE_PNG) throw wzf_mascot_recovery_error();
        return;
    }
    $models = array_values(array_filter(array_keys($files), function($path) { return str_ends_with($path, '.model3.json'); }));
    if (count($models) !== 1 || strpos($models[0], '/') !== false) throw wzf_mascot_recovery_error();
    $character = ['root'=>$name . '/', 'file'=>$models[0]];
    $model = wzf_mascot_json(file_get_contents($base . '/' . $models[0]));
    if (array_diff(array_keys($model['FileReferences'] ?? []), ['Moc','Textures','Physics','Pose','UserData','DisplayInfo','Motions','Expressions'])) throw wzf_mascot_recovery_error();
    $allowed = array_keys(wzf_mascot_character_runtime_files($character));
    foreach (wzf_mascot_character_catalog($character) as $row) $allowed[] = $row['file'];
    foreach (wzf_mascot_character_expressions($character) as $row) $allowed[] = $row['file'];
    $allowed = array_merge($allowed, ['catalog.json','index.html','.htaccess','web.config']);
    if (array_diff(array_keys($files), $allowed)) throw new RuntimeException(__('This directory contains files outside the model runtime references. Preserve it for manual review.', 'live2d-show'));
    $dirs = [''=>true];
    foreach ($files as $path=>$row) {
        for ($dir = dirname($path); $dir !== '.'; $dir = dirname($dir)) $dirs[$dir] = true;
        if (in_array($path, ['index.html','.htaccess','web.config'], true) && file_get_contents($base . '/' . $path) !== file_get_contents(wzf_mascot_uploads()['path'] . '/' . $path)) throw wzf_mascot_recovery_error();
        if (str_ends_with($path, '.json')) wzf_mascot_json(file_get_contents($base . '/' . $path));
    }
    foreach ($tree['entries'] as $path=>$row) if ($row['directory'] && !isset($dirs[$path])) throw wzf_mascot_recovery_error();
}
function wzf_mascot_recovery_references($config, $name) {
    $refs = wzf_mascot_inventory_references($config, wzf_mascot_uploads()['path']);
    if (!$refs['referencesComplete'] || wzf_mascot_inventory_classify($name, $refs['references']) !== 'unreferenced') throw new RuntimeException(__('Current, previous, disabled or trashed resources and intersecting references are protected.', 'live2d-show'));
}
function wzf_mascot_recovery_write($dir, $record) {
    // Sign every state and progress checkpoint; never expose raw filesystem paths.
    $record['signature'] = wzf_mascot_recovery_hmac($record);
    $raw = json_encode($record, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    if (strlen($raw) > 2 * 1024 * 1024) throw wzf_mascot_recovery_error();
    $temp = wzf_mascot_no_links($dir . '/manifest-' . bin2hex(random_bytes(8)) . '.tmp');
    $handle = @fopen($temp, 'x+b'); if (!$handle) throw wzf_mascot_recovery_error();
    try {
        if (!chmod($temp, 0600) || fwrite($handle, $raw) !== strlen($raw) || !fflush($handle) || (function_exists('fsync') && !fsync($handle))) throw wzf_mascot_recovery_error();
    } finally { fclose($handle); }
    $path = wzf_mascot_no_links($dir . '/manifest.json');
    if (file_exists($path)) { $s = lstat($path); if (($s['mode'] & 0170000) !== 0100000 || $s['nlink'] !== 1) throw wzf_mascot_recovery_error(); }
    if (!rename($temp, $path)) throw wzf_mascot_recovery_error();
}
function wzf_mascot_recovery_record($id) {
    $dir = wzf_mascot_recovery_record_dir($id); $path = wzf_mascot_no_links($dir . '/manifest.json');
    $s = @lstat($path);
    if (!$s || ($s['mode'] & 0170000) !== 0100000 || $s['nlink'] !== 1 || $s['size'] > 2 * 1024 * 1024) throw wzf_mascot_recovery_error();
    $r = json_decode(file_get_contents($path), true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($r)) throw wzf_mascot_recovery_error();
    $signature = $r['signature'] ?? ''; unset($r['signature']);
    if (!is_string($signature) || !hash_equals(wzf_mascot_recovery_hmac($r), $signature) || ($r['schema'] ?? null) !== 1 || ($r['blog'] ?? null) !== (int)get_current_blog_id() || ($r['id'] ?? null) !== $id || !in_array($r['state'] ?? null, ['prepared','quarantined','restoring','restored','purging','purged'], true)) throw wzf_mascot_recovery_error();
    wzf_mascot_recovery_name($r['name']);
    return $r;
}
function wzf_mascot_recovery_payload($record) {
    $path = wzf_mascot_recovery_record_dir($record['id']) . '/payload';
    if ($record['state'] === 'purging' && @lstat($path) === false) return ['entries'=>[], 'bytes'=>0, 'latest'=>0, 'hash'=>hash('sha256', serialize([]))];
    $tree = wzf_mascot_recovery_tree($path);
    if ($record['state'] !== 'purging') {
        if ($tree['hash'] !== $record['tree']['hash']) throw wzf_mascot_recovery_error();
    } else {
        // A crash may happen after unlink but before its progress checkpoint.
        // Missing signed entries are acceptable only in explicit purging state.
        foreach ($tree['entries'] as $name=>$row) {
            if (isset($record['deleted'][$name])) throw wzf_mascot_recovery_error();
            $expected = $record['tree']['entries'][$name] ?? null;
            if (!$expected) throw wzf_mascot_recovery_error();
            if ($row['directory']) { unset($row['mtime'], $expected['mtime']); }
            if ($row !== $expected) throw wzf_mascot_recovery_error();
        }
    }
    return $tree;
}
function wzf_mascot_recovery_plan($operation, $path, $days, $config) {
    $base = wzf_mascot_recovery_base(); $uploads = wzf_mascot_uploads()['path'];
    $days = wzf_mascot_inventory_retention_days($days);
    if (!in_array($operation, ['quarantine','restore','purge'], true)) throw wzf_mascot_recovery_error();
    $record = null;
    if ($operation === 'quarantine') {
        $name = wzf_mascot_recovery_name($path); wzf_mascot_recovery_references($config, $name);
        $tree = wzf_mascot_recovery_tree($uploads . '/' . $name); wzf_mascot_recovery_model($name, $tree);
        if ($tree['latest'] > time() - $days * 86400) throw new RuntimeException(__('The newest item has not reached the selected waiting period.', 'live2d-show'));
    } else {
        $record = wzf_mascot_recovery_record($path); $name = $record['name'];
        wzf_mascot_recovery_references($config, $name);
        if (($record['originalRoot'] ?? null) !== wzf_mascot_guard_root_identity($uploads)) throw wzf_mascot_recovery_error();
        $restoredPending = $operation === 'restore' && $record['state'] === 'restoring' && @lstat(wzf_mascot_recovery_record_dir($record['id']) . '/payload') === false;
        if (!$restoredPending && @lstat($uploads . '/' . $name) !== false) throw new RuntimeException(__('The original resource path is occupied. Nothing will be overwritten.', 'live2d-show'));
        if ($operation === 'restore' && !in_array($record['state'], ['prepared','quarantined','restoring'], true)) throw wzf_mascot_recovery_error();
        if ($operation === 'purge' && (!defined('WZF_MASCOT_ALLOW_PERMANENT_DELETE') || WZF_MASCOT_ALLOW_PERMANENT_DELETE !== true || !in_array($record['state'], ['quarantined','purging'], true) || ($record['quarantined'] ?? PHP_INT_MAX) > time() - 30 * 86400)) throw new RuntimeException(__('Permanent deletion requires the server opt-in and at least 30 days in recovery storage.', 'live2d-show'));
        $tree = $restoredPending ? wzf_mascot_recovery_tree($uploads . '/' . $name) : wzf_mascot_recovery_payload($record);
        if ($restoredPending && $tree['hash'] !== $record['tree']['hash']) throw wzf_mascot_recovery_error();
    }
    return ['operation'=>$operation,'path'=>$path,'name'=>$name,'days'=>$days,'version'=>wzf_mascot_config_version($config), 'root'=>wzf_mascot_guard_root_identity($uploads), 'recoveryRoot'=>wzf_mascot_guard_root_identity($base), 'treeHash'=>$tree['hash'], 'bytes'=>$tree['bytes'],'recordHash'=>$record ? hash('sha256', serialize($record)) : null];
}
function wzf_mascot_recovery_preview($operation, $path, $days = 30) {
    if (!current_user_can('manage_options')) throw wzf_mascot_recovery_error();
    $state = wzf_mascot_task_snapshot(); if ($state['exists'] || wzf_mascot_task_status()['status'] !== 'idle') throw wzf_mascot_recovery_error();
    $plan = wzf_mascot_recovery_plan($operation, $path, $days, $state['config']);
    if (wzf_mascot_task_snapshot() !== $state) throw wzf_mascot_recovery_error();
    $plan['blog'] = (int)get_current_blog_id(); $plan['user'] = (int)get_current_user_id(); $plan['issued'] = time();
    return ['plan'=>$plan, 'signature'=>wzf_mascot_recovery_hmac($plan)];
}
function wzf_mascot_recovery_assert_task($task, $version, $recovery_root = null) {
    $state = wzf_mascot_task_snapshot(); wzf_mascot_uploads();
    if ($recovery_root !== null && wzf_mascot_guard_root_identity(wzf_mascot_recovery_base()) !== $recovery_root) throw wzf_mascot_recovery_error();
    if (!$state['exists'] || $state['lock'] !== $task['record'] || wzf_mascot_config_version($state['config']) !== $version) throw wzf_mascot_recovery_error();
    wzf_mascot_task_matches_guard($state['lock'], $task['handle'], $task['scope']['bridge']);
}
function wzf_mascot_recovery_apply($plan, $signature, $confirmed, $typed = '') {
    if (!current_user_can('manage_options') || $confirmed !== '1' || !is_array($plan) || !is_string($signature) || !hash_equals(wzf_mascot_recovery_hmac($plan), $signature) || ($plan['blog'] ?? null) !== (int)get_current_blog_id() || ($plan['user'] ?? null) !== (int)get_current_user_id() || !is_int($plan['issued'] ?? null) || $plan['issued'] > time() || $plan['issued'] < time() - 900) throw wzf_mascot_recovery_error();
    $task = wzf_mascot_task_begin('resource-' . ($plan['operation'] ?? ''));
    try {
        wzf_mascot_recovery_assert_task($task, $plan['version'], $plan['recoveryRoot']);
        $fresh = wzf_mascot_recovery_plan($plan['operation'], $plan['path'], $plan['days'], $task['config']);
        $compare = $plan; unset($compare['blog'], $compare['user'], $compare['issued']);
        if ($fresh !== $compare || ($plan['operation'] === 'purge' && $typed !== $plan['name'])) throw wzf_mascot_recovery_error();
        $uploads = wzf_mascot_uploads()['path'];
        if ($plan['operation'] === 'quarantine') {
            $id = bin2hex(random_bytes(16)); $dir = wzf_mascot_recovery_blog(true) . '/' . $id;
            if (!mkdir($dir, 0700)) throw wzf_mascot_recovery_error();
            $record = ['schema'=>1,'blog'=>(int)get_current_blog_id(),'id'=>$id,'name'=>$plan['name'],'state'=>'prepared','prepared'=>time(),'quarantined'=>null,'originalRoot'=>$plan['root'],'tree'=>wzf_mascot_recovery_tree($uploads . '/' . $plan['name']),'deleted'=>[]];
            if ($record['tree']['hash'] !== $plan['treeHash']) throw wzf_mascot_recovery_error();
            $maximum = $record;
            foreach ($record['tree']['entries'] as $relative=>$row) if (!$row['directory']) $maximum['deleted'][$relative] = true;
            $maximum['signature'] = str_repeat('0',64);
            if (strlen(json_encode($maximum, JSON_THROW_ON_ERROR)) > 2 * 1024 * 1024 - 256) throw wzf_mascot_recovery_error();
            wzf_mascot_recovery_write($dir, $record); wzf_mascot_recovery_assert_task($task, $plan['version'], $plan['recoveryRoot']);
            if (!@rename($uploads . '/' . $plan['name'], $dir . '/payload')) throw wzf_mascot_recovery_error();
            $record['state'] = 'quarantined'; $record['quarantined'] = time(); wzf_mascot_recovery_write($dir, $record);
            return $id;
        }
        $record = wzf_mascot_recovery_record($plan['path']); $dir = wzf_mascot_recovery_record_dir($record['id']);
        wzf_mascot_recovery_assert_task($task, $plan['version'], $plan['recoveryRoot']);
        if ($plan['operation'] === 'restore') {
            $record['state'] = 'restoring'; wzf_mascot_recovery_write($dir, $record);
            if (@lstat($dir . '/payload') !== false) {
                if (@lstat($uploads . '/' . $record['name']) !== false || !@rename($dir . '/payload', $uploads . '/' . $record['name'])) throw wzf_mascot_recovery_error();
            }
            $record['state'] = 'restored'; wzf_mascot_recovery_write($dir, $record); return $record['id'];
        }
        $record['state'] = 'purging'; wzf_mascot_recovery_write($dir, $record);
        $payload = $dir . '/payload';
        $started = microtime(true);
        foreach ($record['tree']['entries'] as $name=>$expected) {
            if ($expected['directory'] || isset($record['deleted'][$name])) continue;
            wzf_mascot_recovery_assert_task($task, $plan['version'], $plan['recoveryRoot']);
            if (microtime(true) - $started > 10) throw wzf_mascot_recovery_error();
            $file = wzf_mascot_no_links($payload . '/' . $name);
            if (@lstat($file) !== false) {
                $actual = wzf_mascot_recovery_tree($file)['entries'][''];
                if ($actual !== $expected || !@unlink($file)) throw wzf_mascot_recovery_error();
            }
            $record['deleted'][$name] = true; wzf_mascot_recovery_write($dir, $record);
        }
        $dirs = array_keys(array_filter($record['tree']['entries'], function($row) { return $row['directory']; }));
        usort($dirs, function($a,$b) { return substr_count($b,'/') <=> substr_count($a,'/') ?: strlen($b) <=> strlen($a); });
        foreach ($dirs as $name) {
            if (microtime(true) - $started > 10) throw wzf_mascot_recovery_error();
            wzf_mascot_recovery_assert_task($task, $plan['version'], $plan['recoveryRoot']);
            $path = wzf_mascot_no_links($payload . ($name === '' ? '' : '/' . $name));
            if (@lstat($path) !== false) {
                $stat = lstat($path); $expected = $record['tree']['entries'][$name];
                foreach (['dev','ino','mode','uid','gid'] as $field) if ((string)$stat[$field] !== (string)$expected[$field]) throw wzf_mascot_recovery_error();
                if (!@rmdir($path)) throw wzf_mascot_recovery_error();
            }
        }
        $record['state'] = 'purged'; wzf_mascot_recovery_write($dir, $record); return $record['id'];
    } finally { wzf_mascot_task_end($task); }
}
function wzf_mascot_recovery_review_gate() {
    if (($_GET['page'] ?? '') !== 'wzf-mascot' || !isset($_POST['recovery_review'])) return;
    if (!current_user_can('manage_options') || ($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_recovery_review');
    try {
        if (array_diff(array_keys($_POST), ['_wpnonce','_wp_http_referer','recovery_review','operation','path','days','version','submit'])) throw wzf_mascot_recovery_error();
        if (!is_string($_POST['version'] ?? null) || $_POST['version'] !== wzf_mascot_config_version(wzf_mascot_task_snapshot()['config'])) throw wzf_mascot_recovery_error();
        $GLOBALS['wzf_mascot_recovery_review'] = wzf_mascot_recovery_preview(is_string($_POST['operation'] ?? null) ? wp_unslash($_POST['operation']) : '', is_string($_POST['path'] ?? null) ? wp_unslash($_POST['path']) : '', $_POST['days'] ?? 30);
    } catch (Throwable $e) { $GLOBALS['wzf_mascot_recovery_review_error'] = wzf_mascot_error_message($e); }
}
function wzf_mascot_recovery_post() {
    if (!current_user_can('manage_options') || ($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    $operation = is_string($_POST['operation'] ?? null) ? $_POST['operation'] : '';
    if (!in_array($operation, ['quarantine','restore','purge'], true)) wp_die(__('Invalid recovery operation.', 'live2d-show'), '', ['response'=>400]);
    check_admin_referer('wzf_mascot_recovery_' . $operation);
    try {
        if (array_diff(array_keys($_POST), ['action','_wpnonce','_wp_http_referer','operation','plan','signature','confirm','typed']) || !is_string($_POST['plan'] ?? null) || strlen($_POST['plan']) > 8192) throw wzf_mascot_recovery_error();
        $plan = json_decode(wp_unslash($_POST['plan']), true, 16, JSON_THROW_ON_ERROR);
        if (($plan['operation'] ?? null) !== $operation) throw wzf_mascot_recovery_error();
        wzf_mascot_recovery_apply($plan, $_POST['signature'] ?? null, $_POST['confirm'] ?? null, is_string($_POST['typed'] ?? null) ? wp_unslash($_POST['typed']) : '');
        $notice = __('Resource recovery operation completed. Review the record below.', 'live2d-show');
    } catch (Throwable $e) { $notice = wzf_mascot_error_message($e); }
    wp_safe_redirect(add_query_arg('mascot_notice', rawurlencode($notice), admin_url('options-general.php?page=wzf-mascot'))); exit;
}
function wzf_mascot_recovery_review_form($operation, $path, $version) {
    echo '<form method="post">'; wp_nonce_field('wzf_mascot_recovery_review');
    foreach (['recovery_review'=>'1','operation'=>$operation,'path'=>$path,'version'=>$version] as $key=>$value) echo '<input type="hidden" name="' . esc_attr($key) . '" value="' . esc_attr($value) . '">';
    $labels = ['quarantine'=>__('Review move to recovery storage', 'live2d-show'),'restore'=>__('Review restore', 'live2d-show'),'purge'=>__('Review permanent deletion', 'live2d-show')];
    submit_button($labels[$operation], 'secondary', '', false); echo '</form>';
}
function wzf_mascot_recovery_label($value) {
    $labels = ['quarantine'=>__('Move to recovery storage', 'live2d-show'), 'restore'=>__('Restore', 'live2d-show'), 'purge'=>__('Permanently delete', 'live2d-show'),
        'prepared'=>__('Prepared; inspect original and recovery storage', 'live2d-show'), 'quarantined'=>__('In recovery storage', 'live2d-show'),
        'restoring'=>__('Restore interrupted; review to finish', 'live2d-show'), 'restored'=>__('Restored', 'live2d-show'),
        'purging'=>__('Partially deleted; new confirmation required', 'live2d-show'), 'purged'=>__('Permanently deleted', 'live2d-show')];
    return $labels[$value] ?? $value;
}
function wzf_mascot_recovery_panel($config) {
    echo '<section class="wzf-mascot-card wzf-mascot-recovery"><h2>' . esc_html__('Resource history and recovery', 'live2d-show') . '</h2><p>' . esc_html__('Review storage usage above first. Moving to recovery storage and restoring do not free space on this filesystem. Logical file size and current free space are separate measurements.', 'live2d-show') . '</p>';
    try { $base = wzf_mascot_recovery_base(); }
    catch (Throwable $e) { echo '<p>' . esc_html(wzf_mascot_error_message($e)) . '</p></section>'; return; }
    $free = @disk_free_space($base);
    echo '<p>' . esc_html__('Current free space:', 'live2d-show') . ' ' . esc_html($free === false ? '—' : size_format($free)) . '</p>';
    if (isset($GLOBALS['wzf_mascot_recovery_review_error'])) echo '<p role="alert">' . esc_html($GLOBALS['wzf_mascot_recovery_review_error']) . '</p>';
    $version = wzf_mascot_config_version($config);
    echo '<details><summary>' . esc_html__('Move one unreferenced resource root', 'live2d-show') . '</summary><p>' . esc_html__('Only complete model or thumbnail roots are eligible. Current, previous, disabled, trashed, Core and unknown resources are protected. All files must have reached the waiting period.', 'live2d-show') . '</p><form method="post">'; wp_nonce_field('wzf_mascot_recovery_review');
    echo '<input type="hidden" name="version" value="' . esc_attr($version) . '"><input type="hidden" name="operation" value="quarantine"><input type="hidden" name="recovery_review" value="1"><p><label>' . esc_html__('Exact resource directory name', 'live2d-show') . ' <input name="path" required pattern="(model|thumbnail)-[0-9a-f]{32}" size="44"></label></p><p><label>' . esc_html__('Minimum waiting period (days)', 'live2d-show') . ' <input type="number" name="days" min="1" max="3650" value="30" required></label></p>';
    submit_button(__('Review move to recovery storage', 'live2d-show'), 'secondary', ''); echo '</form></details>';
    $review = $GLOBALS['wzf_mascot_recovery_review'] ?? null;
    if ($review) {
        $plan = $review['plan'];
        echo '<div class="wzf-mascot-recovery-confirm"><h3>' . esc_html__('Confirm reviewed operation', 'live2d-show') . '</h3><p><code>' . esc_html($plan['name']) . '</code> · ' . esc_html(wzf_mascot_recovery_label($plan['operation'])) . ' · ' . esc_html__('Logical size:', 'live2d-show') . ' ' . esc_html(size_format($plan['bytes'])) . '</p><p>' . esc_html__('This review expires after 15 minutes. Changes to references, files or storage invalidate it.', 'live2d-show') . '</p><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('wzf_mascot_recovery_' . $plan['operation']);
        foreach (['action'=>'wzf_mascot_recovery','operation'=>$plan['operation'],'plan'=>wp_json_encode($plan),'signature'=>$review['signature']] as $key=>$value) echo '<input type="hidden" name="' . esc_attr($key) . '" value="' . esc_attr($value) . '">';
        if ($plan['operation'] === 'purge') echo '<p><label>' . esc_html__('Type the exact directory name to permanently delete it', 'live2d-show') . ' <input name="typed" required autocomplete="off"></label></p>';
        echo '<p><label><input type="checkbox" name="confirm" value="1" required> ' . esc_html($plan['operation'] === 'purge' ? __('I understand this deletion is irreversible.', 'live2d-show') : __('I confirm this reviewed move without changing configuration.', 'live2d-show')) . '</label></p>';
        submit_button(__('Apply reviewed operation', 'live2d-show'), 'secondary', ''); echo '</form></div>';
    }
    echo '<h3>' . esc_html__('Recovery records', 'live2d-show') . '</h3><p>' . esc_html__('Prepared records retain the original directory or a complete recovery payload. Interrupted deletion remains partial; it cannot be restored. Review again before continuing deletion. Keep recovery manifests with their payloads.', 'live2d-show') . '</p>';
    $blog = wzf_mascot_recovery_blog(); $count = 0;
    if (is_dir($blog)) foreach (new FilesystemIterator($blog, FilesystemIterator::SKIP_DOTS) as $item) {
        if (++$count > 100) { echo '<p>' . esc_html__('Only the first 100 records are shown. Ask the server administrator to inspect the remaining records.', 'live2d-show') . '</p>'; break; }
        try {
            $record = wzf_mascot_recovery_record($item->getFilename());
            echo '<div class="wzf-mascot-diagnostic-row"><p><code>' . esc_html($record['name']) . '</code> · ' . esc_html(wzf_mascot_recovery_label($record['state'])) . ' · ' . esc_html(size_format($record['tree']['bytes'])) . '</p>';
            if (in_array($record['state'], ['prepared','quarantined','restoring'], true)) wzf_mascot_recovery_review_form('restore', $record['id'], $version);
            if (in_array($record['state'], ['quarantined','purging'], true)) {
                echo '<details><summary>' . esc_html__('Permanent deletion', 'live2d-show') . '</summary><p>' . esc_html__('Requires WZF_MASCOT_ALLOW_PERMANENT_DELETE and at least 30 days in recovery storage. Actual space released may differ from logical size.', 'live2d-show') . '</p>';
                wzf_mascot_recovery_review_form('purge', $record['id'], $version); echo '</details>';
            }
            echo '</div>';
        } catch (Throwable $e) { echo '<p role="alert">' . esc_html__('A recovery record is unreadable or invalid. Preserve it for server inspection.', 'live2d-show') . '</p>'; }
    }
    echo '</section>';
}
add_action('admin_init', 'wzf_mascot_recovery_review_gate');
add_action('admin_post_wzf_mascot_recovery', 'wzf_mascot_recovery_post');
