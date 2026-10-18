<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
const WZF_MASCOT_GUARD_VERSION = 1;
const WZF_MASCOT_GUARD_FILE = '.task-guard';
// Always read both records from the database, bypassing request and persistent
// option caches. All writes still use WordPress option APIs.
function wzf_mascot_task_snapshot() {
    global $wpdb;
    if (!isset($wpdb)) throw new RuntimeException(__('Task state is unavailable. Ask an administrator to inspect server storage and the database.', 'live2d-show'));
    $rows = $wpdb->get_results($wpdb->prepare("SELECT option_name, option_value FROM {$wpdb->options} WHERE option_name IN (%s, %s)", WZF_MASCOT_OPTION, WZF_MASCOT_LOCK), ARRAY_A);
    if (!is_array($rows) || $wpdb->last_error !== '') throw new RuntimeException(__('Task state is unavailable. Ask an administrator to inspect server storage and the database.', 'live2d-show'));
    $state = ['exists'=>false, 'lock'=>null, 'config'=>['characters'=>[]]];
    foreach ($rows as $row) {
        if ($row['option_name'] === WZF_MASCOT_LOCK) { $state['exists'] = true; $state['lock'] = maybe_unserialize($row['option_value']); }
        elseif ($row['option_name'] === WZF_MASCOT_OPTION) $state['config'] = maybe_unserialize($row['option_value']);
    }
    return $state;
}
function wzf_mascot_task_uncache() {
    foreach ([WZF_MASCOT_LOCK, WZF_MASCOT_OPTION, 'alloptions', 'notoptions'] as $key) wp_cache_delete($key, 'options');
}
function wzf_mascot_task_record_valid($lock) {
    return is_array($lock) && count($lock) === 5 && ($lock['guard'] ?? null) === WZF_MASCOT_GUARD_VERSION && is_string($lock['token'] ?? null) && preg_match('/\A[0-9a-f]{32}\z/D', $lock['token']) && wzf_mascot_task_identity_valid($lock['identity'] ?? null) && is_int($lock['started'] ?? null) && $lock['started'] > 0 && in_array($lock['kind'] ?? null, ['import-core','import-model','settings','lifecycle','replace','thumbnail','mobile'], true);
}
function wzf_mascot_task_identity_valid($identity) {
    return is_array($identity) && count($identity) === 2 && is_string($identity['dev'] ?? null) && is_string($identity['ino'] ?? null) && preg_match('/\A[0-9]+\z/D', $identity['dev']) && preg_match('/\A[0-9]+\z/D', $identity['ino']);
}
function wzf_mascot_task_identity($handle) {
    $stat = fstat($handle);
    return ['dev'=>(string)$stat['dev'], 'ino'=>(string)$stat['ino']];
}
function wzf_mascot_task_matches_guard($lock, $handle) {
    if (!wzf_mascot_task_record_valid($lock) || $lock['identity'] !== wzf_mascot_task_identity($handle)) throw new RuntimeException(__('The task guard changed. Ask an administrator to inspect resource storage before recovery.', 'live2d-show'));
}
function wzf_mascot_task_fingerprint($lock) {
    return hash_hmac('sha256', serialize($lock), wp_salt('nonce'));
}
// The inode is permanent: never truncate, replace or unlink this file. Check
// before and after opening; reject links, hardlinks, directories and special files.
// Read-only probes/recovery MUST NOT create directories or the guard.
function wzf_mascot_task_guard($create = false) {
    $base = wzf_mascot_uploads()['path'];
    if ($create && !is_dir($base) && !wp_mkdir_p($base)) throw new RuntimeException(__('The task guard is unavailable or unsafe. Ask an administrator to inspect resource storage.', 'live2d-show'));
    $path = wzf_mascot_no_links($base . '/' . WZF_MASCOT_GUARD_FILE);
    clearstatcache(true, $path);
    $before = @lstat($path);
    $handle = false;
    if ($before === false && $create) {
        $handle = @fopen($path, 'x+b');
        clearstatcache(true, $path);
        $before = @lstat($path);
    }
    if ($before === false || ($before['mode'] & 0170000) !== 0100000 || $before['nlink'] !== 1 || $before['size'] > 64 || !is_readable($path)) {
        if (is_resource($handle)) fclose($handle);
        throw new RuntimeException(__('The task guard is unavailable or unsafe. Ask an administrator to inspect resource storage.', 'live2d-show'));
    }
    if (!$handle) $handle = @fopen($path, 'rb');
    if (!$handle) throw new RuntimeException(__('The task guard is unavailable or unsafe. Ask an administrator to inspect resource storage.', 'live2d-show'));
    try {
        wzf_mascot_no_links($path);
        clearstatcache(true, $path);
        $after = @lstat($path); $opened = fstat($handle);
        foreach ([$before, $after, $opened] as $stat) {
            if (!$stat || ($stat['mode'] & 0170000) !== 0100000 || $stat['nlink'] !== 1 || $stat['size'] > 64 || $stat['dev'] !== $opened['dev'] || $stat['ino'] !== $opened['ino']) throw new RuntimeException(__('The task guard is unavailable or unsafe. Ask an administrator to inspect resource storage.', 'live2d-show'));
        }
        return $handle;
    } catch (Throwable $e) { fclose($handle); throw $e; }
}
function wzf_mascot_task_begin($kind) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    $state = wzf_mascot_task_snapshot();
    if ($state['exists']) throw new RuntimeException(__('A resource or settings task is in progress. Inspect task status before retrying.', 'live2d-show'));
    $handle = wzf_mascot_task_guard(true);
    try {
        if (!flock($handle, LOCK_EX | LOCK_NB)) throw new RuntimeException(__('A resource or settings task is in progress. Inspect task status before retrying.', 'live2d-show'));
        $state = wzf_mascot_task_snapshot();
        if ($state['exists']) throw new RuntimeException(__('A resource or settings task is in progress. Inspect task status before retrying.', 'live2d-show'));
        $record = ['token'=>bin2hex(random_bytes(16)), 'started'=>time(), 'guard'=>WZF_MASCOT_GUARD_VERSION, 'kind'=>$kind, 'identity'=>wzf_mascot_task_identity($handle)];
        if (!wzf_mascot_task_record_valid($record)) throw new RuntimeException(__('Task request is invalid.', 'live2d-show'));
        wzf_mascot_task_uncache();
        if (!add_option(WZF_MASCOT_LOCK, $record, '', false)) throw new RuntimeException(__('A resource or settings task is in progress. Inspect task status before retrying.', 'live2d-show'));
        return ['handle'=>$handle, 'record'=>$record, 'token'=>$record['token'], 'config'=>$state['config']];
    } catch (Throwable $e) { flock($handle, LOCK_UN); fclose($handle); throw $e; }
}
function wzf_mascot_task_end($task) {
    try {
        $state = wzf_mascot_task_snapshot();
        if ($state['exists'] && $state['lock'] === $task['record']) { wzf_mascot_task_uncache(); delete_option(WZF_MASCOT_LOCK); }
    } finally { flock($task['handle'], LOCK_UN); fclose($task['handle']); }
}
function wzf_mascot_task_status() {
    $result = ['status'=>'unknown', 'started'=>null, 'fingerprint'=>null, 'version'=>null];
    try {
        $state = wzf_mascot_task_snapshot();
        if (!$state['exists']) {
            // A missing guard on an unused installation is normal; never create it.
            $path = wzf_mascot_uploads()['path'] . '/' . WZF_MASCOT_GUARD_FILE;
            clearstatcache(true, $path);
            if (@lstat($path) === false) { $result['status'] = 'idle'; return $result; }
        } elseif (!wzf_mascot_task_record_valid($state['lock'])) return $result;
        $handle = wzf_mascot_task_guard();
        try {
            if ($state['exists']) wzf_mascot_task_matches_guard($state['lock'], $handle);
            if (!flock($handle, LOCK_EX | LOCK_NB)) $result['status'] = 'running';
            else {
                $fresh = wzf_mascot_task_snapshot();
                if ($fresh === $state) {
                    $result['status'] = $state['exists'] ? 'interrupted' : 'idle';
                    if ($state['exists']) {
                        $result['fingerprint'] = wzf_mascot_task_fingerprint($state['lock']);
                        $result['version'] = wzf_mascot_config_version($state['config']);
                    }
                }
                flock($handle, LOCK_UN);
            }
        } finally { fclose($handle); }
        if ($state['exists']) $result['started'] = $state['lock']['started'];
    } catch (Throwable $e) { /* Unknown is conservative and reveals no server paths. */ }
    return $result;
}
function wzf_mascot_task_recover($fingerprint, $version, $confirmed) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    if ($confirmed !== '1' || !is_string($fingerprint) || !preg_match('/\A[0-9a-f]{64}\z/D', $fingerprint) || !is_string($version) || !preg_match('/\A[0-9a-f]{64}\z/D', $version)) throw new RuntimeException(__('Confirm recovery of the interrupted task record.', 'live2d-show'));
    $check = function($state) use ($fingerprint, $version) {
        if (!$state['exists'] || !wzf_mascot_task_record_valid($state['lock']) || !hash_equals(wzf_mascot_task_fingerprint($state['lock']), $fingerprint) || !hash_equals(wzf_mascot_config_version($state['config']), $version)) throw new RuntimeException(__('Task state or configuration changed. Refresh before retrying recovery.', 'live2d-show'));
    };
    $state = wzf_mascot_task_snapshot();
    $check($state);
    $handle = wzf_mascot_task_guard();
    try {
        wzf_mascot_task_matches_guard($state['lock'], $handle);
        if (!flock($handle, LOCK_EX | LOCK_NB)) throw new RuntimeException(__('The task is still running. Recovery is unavailable.', 'live2d-show'));
        $check(wzf_mascot_task_snapshot());
        wzf_mascot_task_uncache();
        $check(wzf_mascot_task_snapshot());
        if (!delete_option(WZF_MASCOT_LOCK) || wzf_mascot_task_snapshot()['exists']) throw new RuntimeException(__('Cannot remove the interrupted task record. Existing configuration is retained.', 'live2d-show'));
    } finally { flock($handle, LOCK_UN); fclose($handle); }
}
function wzf_mascot_task_recover_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_task_recover');
    try {
        wzf_mascot_task_recover(isset($_POST['fingerprint']) && is_string($_POST['fingerprint']) ? wp_unslash($_POST['fingerprint']) : '', isset($_POST['version']) && is_string($_POST['version']) ? wp_unslash($_POST['version']) : '', $_POST['confirm'] ?? '');
        $notice = __('Interrupted task record removed. Resources and configuration were retained. Inspect installed resources before retrying the original task.', 'live2d-show');
    } catch (Throwable $e) { $notice = wzf_mascot_error_message($e); }
    wp_safe_redirect(add_query_arg('mascot_notice', rawurlencode($notice), admin_url('options-general.php?page=wzf-mascot')));
    exit;
}
function wzf_mascot_task_panel() {
    $state = wzf_mascot_task_status();
    $labels = ['idle'=>__('Idle', 'live2d-show'), 'running'=>__('Running', 'live2d-show'), 'interrupted'=>__('Interrupted · Review required', 'live2d-show'), 'unknown'=>__('Legacy or unknown task state', 'live2d-show')];
    echo '<section class="wzf-mascot-card"><h2>' . esc_html__('Resource and settings tasks', 'live2d-show') . '</h2><p role="status"><strong>' . esc_html($labels[$state['status']]) . '</strong></p>';
    if ($state['started'] !== null) echo '<p>' . esc_html(sprintf(__('Task age: %s seconds. Age alone does not permit recovery.', 'live2d-show'), number_format_i18n(max(0, time() - $state['started'])))) . '</p>';
    if ($state['status'] === 'unknown') echo '<p>' . esc_html__('Automatic recovery cannot prove that this task ended. Ask an administrator to inspect active PHP tasks, resource storage and the legacy lock. Do not delete a lock based on its age.', 'live2d-show') . '</p>';
    elseif ($state['status'] === 'running') echo '<p>' . esc_html__('A resource or settings task is in progress. Wait for it to finish, then refresh.', 'live2d-show') . '</p>';
    elseif ($state['status'] === 'interrupted') {
        echo '<p>' . esc_html__('No resource or settings task is currently detected. Recovery removes only this interrupted task record; it does not repair, remove or roll back resources, staging directories or configuration. Inspect installed resources afterward.', 'live2d-show') . '</p><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('wzf_mascot_task_recover');
        echo '<input type="hidden" name="action" value="wzf_mascot_task_recover"><input type="hidden" name="fingerprint" value="' . esc_attr($state['fingerprint']) . '"><input type="hidden" name="version" value="' . esc_attr($state['version']) . '"><p><label><input type="checkbox" name="confirm" value="1" required> ' . esc_html__('I understand that recovery only removes the interrupted task record.', 'live2d-show') . '</label></p>';
        submit_button(__('Recover interrupted task', 'live2d-show')); echo '</form>';
    }
    echo '</section>';
}
add_action('admin_post_wzf_mascot_task_recover', 'wzf_mascot_task_recover_post');
