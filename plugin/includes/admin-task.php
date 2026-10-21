<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
const WZF_MASCOT_GUARD_VERSION = 2;
const WZF_MASCOT_GUARD_FILE = '.task-guard';
const WZF_MASCOT_RESOURCE_GUARD_FILE = '.resource-guard';
const WZF_MASCOT_ACCOUNT_GUARD_DIR = '.account-guards';
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
function wzf_mascot_task_identity_valid($identity) {
    return is_array($identity) && count($identity) === 2 && is_string($identity['dev'] ?? null) && is_string($identity['ino'] ?? null) && preg_match('/\A[0-9]+\z/D', $identity['dev']) && preg_match('/\A[0-9]+\z/D', $identity['ino']);
}
function wzf_mascot_task_record_valid($lock) {
    if (!is_array($lock) || !in_array($lock['guard'] ?? null, [1,2], true) || count($lock) !== ($lock['guard'] === 1 ? 5 : 6)) return false;
    if ($lock['guard'] === 2 && !wzf_mascot_task_identity_valid($lock['bridgeIdentity'] ?? null)) return false;
    return is_string($lock['token'] ?? null) && preg_match('/\A[0-9a-f]{32}\z/D', $lock['token']) && wzf_mascot_task_identity_valid($lock['identity'] ?? null) && is_int($lock['started'] ?? null) && $lock['started'] > 0 && in_array($lock['kind'] ?? null, ['import-core','import-model','settings','lifecycle','replace','thumbnail','mobile'], true);
}
function wzf_mascot_task_identity($handle) {
    $stat = fstat($handle);
    return ['dev'=>(string)$stat['dev'], 'ino'=>(string)$stat['ino']];
}
function wzf_mascot_task_matches_guard($lock, $handle, $bridge = null) {
    if (!wzf_mascot_task_record_valid($lock) || $lock['identity'] !== wzf_mascot_task_identity($handle) || ($lock['guard'] === 2 && (!$bridge || $lock['bridgeIdentity'] !== wzf_mascot_task_identity($bridge)))) throw new RuntimeException(__('The task guard changed. Ask an administrator to inspect resource storage before recovery.', 'live2d-show'));
}
function wzf_mascot_task_fingerprint($lock) { return hash_hmac('sha256', serialize($lock), wp_salt('nonce')); }
function wzf_mascot_guard_error() { return new RuntimeException(__('The task guard is unavailable or unsafe. Ask an administrator to inspect resource storage.', 'live2d-show')); }
// Permanent guard files are never truncated, replaced or unlinked. Probes do not
// create files. The bridge remains the same inode used by pre-v2 EX writers.
function wzf_mascot_guard_open($base, $relative, $create = false) {
    $path = wzf_mascot_no_links($base . '/' . $relative);
    if ($create && !is_dir(dirname($path)) && !wp_mkdir_p(dirname($path))) throw wzf_mascot_guard_error();
    clearstatcache(true, $path); $before = @lstat($path); $handle = false;
    if ($before === false && $create) {
        $handle = @fopen($path, 'x+b');
        clearstatcache(true, $path); $before = @lstat($path);
    }
    if ($before === false || ($before['mode'] & 0170000) !== 0100000 || $before['nlink'] !== 1 || $before['size'] > 64 || !is_readable($path)) {
        if (is_resource($handle)) fclose($handle);
        throw wzf_mascot_guard_error();
    }
    if (!$handle) $handle = @fopen($path, 'rb');
    if (!$handle) throw wzf_mascot_guard_error();
    try {
        wzf_mascot_guard_handle_check($path, $handle);
        $opened = fstat($handle);
        if ($before['dev'] !== $opened['dev'] || $before['ino'] !== $opened['ino']) throw wzf_mascot_guard_error();
        return $handle;
    } catch (Throwable $e) { fclose($handle); throw $e; }
}
function wzf_mascot_guard_handle_check($path, $handle) {
    wzf_mascot_no_links($path); clearstatcache(true, $path);
    $current = @lstat($path); $opened = is_resource($handle) ? fstat($handle) : false;
    if (!$opened) throw wzf_mascot_guard_error();
    foreach ([$current, $opened] as $stat) {
        if (!$stat || ($stat['mode'] & 0170000) !== 0100000 || $stat['nlink'] !== 1 || $stat['size'] > 64 || $stat['dev'] !== $opened['dev'] || $stat['ino'] !== $opened['ino'] || !is_readable($path)) throw wzf_mascot_guard_error();
    }
}
function wzf_mascot_guard_root_identity($base) {
    wzf_mascot_no_links($base); clearstatcache(true, $base); $stat = @lstat($base);
    if (!$stat || ($stat['mode'] & 0170000) !== 0040000) throw wzf_mascot_guard_error();
    return ['dev'=>(string)$stat['dev'], 'ino'=>(string)$stat['ino']];
}
// Every uploads() call verifies all scopes held by this request. A root move or
// changed upload filter requires stopped writers, never a second locking domain.
function wzf_mascot_guard_assert_root($base) {
    global $wzf_mascot_guard_scopes;
    foreach ($wzf_mascot_guard_scopes ?? [] as $scope) {
        if ($scope['base'] !== $base || wzf_mascot_guard_root_identity($base) !== $scope['rootIdentity']) throw wzf_mascot_guard_error();
        foreach ($scope['files'] as $file) wzf_mascot_guard_handle_check($file['path'], $file['handle']);
    }
}
function wzf_mascot_task_guard($create = false) {
    $base = wzf_mascot_uploads()['path'];
    return wzf_mascot_guard_open($base, WZF_MASCOT_GUARD_FILE, $create);
}
function wzf_mascot_guard_scope_begin($kind, $create = true, $account_file = null) {
    global $wzf_mascot_guard_scopes;
    if (!in_array($kind, ['resource','legacy','account'], true) || ($kind === 'account' && (!is_string($account_file) || !preg_match('/\A[0-9a-f]{64}\.guard\z/D', $account_file)))) throw wzf_mascot_guard_error();
    $base = wzf_mascot_uploads()['path'];
    if ($create && !is_dir($base) && !wp_mkdir_p($base)) throw wzf_mascot_guard_error();
    $identity = wzf_mascot_guard_root_identity($base);
    $bridge = wzf_mascot_guard_open($base, WZF_MASCOT_GUARD_FILE, $create);
    $token = bin2hex(random_bytes(16));
    $scope = ['token'=>$token,'kind'=>$kind,'base'=>$base,'rootIdentity'=>$identity,'files'=>[['path'=>$base . '/' . WZF_MASCOT_GUARD_FILE,'handle'=>$bridge]],'bridge'=>$bridge,'handle'=>$bridge];
    try {
        if (!flock($bridge, ($kind === 'legacy' ? LOCK_EX : LOCK_SH) | LOCK_NB)) throw new RuntimeException('guard-busy');
        $wzf_mascot_guard_scopes[$token] = $scope;
        wzf_mascot_uploads();
        if ($kind !== 'legacy') {
            $relative = $kind === 'resource' ? WZF_MASCOT_RESOURCE_GUARD_FILE : WZF_MASCOT_ACCOUNT_GUARD_DIR . '/' . $account_file;
            $handle = wzf_mascot_guard_open($base, $relative, $create);
            $scope['files'][] = ['path'=>$base . '/' . $relative,'handle'=>$handle]; $scope['handle'] = $handle;
            $wzf_mascot_guard_scopes[$token] = $scope;
            if (!flock($handle, LOCK_EX | LOCK_NB)) throw new RuntimeException('guard-busy');
            wzf_mascot_uploads();
        }
        return $scope;
    } catch (Throwable $e) { wzf_mascot_guard_scope_end($scope); throw $e; }
}
function wzf_mascot_guard_scope_end($scope) {
    global $wzf_mascot_guard_scopes;
    unset($wzf_mascot_guard_scopes[$scope['token']]);
    foreach (array_reverse($scope['files']) as $file) if (is_resource($file['handle'])) { flock($file['handle'], LOCK_UN); fclose($file['handle']); }
}
function wzf_mascot_resources_update($config) {
    global $wzf_mascot_guard_scopes;
    if (!array_filter($wzf_mascot_guard_scopes ?? [], function($scope) { return $scope['kind'] === 'resource'; })) throw wzf_mascot_guard_error();
    wzf_mascot_uploads(); // Reject a changed root/guard before any WP API write.
    return update_option(WZF_MASCOT_OPTION, $config, false);
}
function wzf_mascot_task_begin($kind) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    $state = wzf_mascot_task_snapshot();
    if ($state['exists']) throw new RuntimeException(__('A resource or settings task is in progress. Inspect task status before retrying.', 'live2d-show'));
    try { $scope = wzf_mascot_guard_scope_begin('resource'); }
    catch (Throwable $e) {
        if ($e->getMessage() === 'guard-busy') throw new RuntimeException(__('A resource or settings task is in progress. Inspect task status before retrying.', 'live2d-show'));
        throw $e;
    }
    try {
        $state = wzf_mascot_task_snapshot();
        if ($state['exists']) throw new RuntimeException(__('A resource or settings task is in progress. Inspect task status before retrying.', 'live2d-show'));
        $record = ['token'=>bin2hex(random_bytes(16)), 'started'=>time(), 'guard'=>WZF_MASCOT_GUARD_VERSION, 'kind'=>$kind, 'identity'=>wzf_mascot_task_identity($scope['handle']), 'bridgeIdentity'=>wzf_mascot_task_identity($scope['bridge'])];
        if (!wzf_mascot_task_record_valid($record)) throw new RuntimeException(__('Task request is invalid.', 'live2d-show'));
        wzf_mascot_task_uncache(); wzf_mascot_uploads();
        if (!add_option(WZF_MASCOT_LOCK, $record, '', false)) throw new RuntimeException(__('A resource or settings task is in progress. Inspect task status before retrying.', 'live2d-show'));
        return ['handle'=>$scope['handle'],'scope'=>$scope,'record'=>$record,'token'=>$record['token'],'config'=>$state['config']];
    } catch (Throwable $e) { wzf_mascot_guard_scope_end($scope); throw $e; }
}
function wzf_mascot_task_end($task) {
    try {
        wzf_mascot_uploads(); $state = wzf_mascot_task_snapshot();
        if ($state['exists'] && $state['lock'] === $task['record']) { wzf_mascot_task_uncache(); delete_option(WZF_MASCOT_LOCK); }
    } finally { wzf_mascot_guard_scope_end($task['scope']); }
}
function wzf_mascot_task_status() {
    $result = ['status'=>'unknown','started'=>null,'fingerprint'=>null,'version'=>null]; $scope = null;
    try {
        $state = wzf_mascot_task_snapshot();
        if ($state['exists'] && !wzf_mascot_task_record_valid($state['lock'])) return $result;
        $base = wzf_mascot_uploads()['path'];
        if (!$state['exists'] && @lstat($base . '/' . WZF_MASCOT_GUARD_FILE) === false) {
            if (@lstat($base . '/' . WZF_MASCOT_RESOURCE_GUARD_FILE) === false && @lstat($base . '/' . WZF_MASCOT_ACCOUNT_GUARD_DIR) === false) $result['status'] = 'idle';
            return $result;
        }
        if (!$state['exists'] && @lstat($base . '/' . WZF_MASCOT_RESOURCE_GUARD_FILE) === false) {
            // An account SH bridge alone is not an administrator resource task.
            $bridge = wzf_mascot_task_guard();
            try { if (flock($bridge, LOCK_SH | LOCK_NB) && wzf_mascot_task_snapshot() === $state) $result['status'] = 'idle'; }
            finally { flock($bridge, LOCK_UN); fclose($bridge); }
            return $result;
        }
        try { $scope = wzf_mascot_guard_scope_begin($state['exists'] && $state['lock']['guard'] === 1 ? 'legacy' : 'resource', false); }
        catch (Throwable $e) {
            if ($e->getMessage() !== 'guard-busy' || !$state['exists']) return $result;
            // Verify identities even when another writer holds the domain lock.
            $bridge = wzf_mascot_task_guard(); $handle = $bridge;
            try {
                $shared = flock($bridge, LOCK_SH | LOCK_NB);
                // v2 is inspectable only under the compatibility bridge SH.
                // A v1 record blocked only by SH writers is conservatively busy.
                if (($state['lock']['guard'] === 2 && !$shared) || ($state['lock']['guard'] === 1 && $shared)) return $result;
                if ($state['lock']['guard'] === 2) $handle = wzf_mascot_guard_open($base, WZF_MASCOT_RESOURCE_GUARD_FILE);
                wzf_mascot_task_matches_guard($state['lock'], $handle, $bridge); $result['status'] = 'running';
            } finally { if ($handle !== $bridge) fclose($handle); flock($bridge, LOCK_UN); fclose($bridge); }
            $result['started'] = $state['lock']['started']; return $result;
        }
        if ($state['exists']) wzf_mascot_task_matches_guard($state['lock'], $scope['handle'], $scope['bridge']);
        if (wzf_mascot_task_snapshot() === $state) {
            $result['status'] = $state['exists'] ? 'interrupted' : 'idle';
            if ($state['exists']) {
                $result['started'] = $state['lock']['started'];
                $result['fingerprint'] = wzf_mascot_task_fingerprint($state['lock']);
                $result['version'] = wzf_mascot_config_version($state['config']);
            }
        }
    } catch (Throwable $e) { /* Unknown is conservative and reveals no paths. */ }
    finally { if ($scope !== null) wzf_mascot_guard_scope_end($scope); }
    return $result;
}
function wzf_mascot_task_recover($fingerprint, $version, $confirmed) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    if ($confirmed !== '1' || !is_string($fingerprint) || !preg_match('/\A[0-9a-f]{64}\z/D', $fingerprint) || !is_string($version) || !preg_match('/\A[0-9a-f]{64}\z/D', $version)) throw new RuntimeException(__('Confirm recovery of the interrupted task record.', 'live2d-show'));
    $check = function($state) use ($fingerprint, $version) {
        if (!$state['exists'] || !wzf_mascot_task_record_valid($state['lock']) || !hash_equals(wzf_mascot_task_fingerprint($state['lock']), $fingerprint) || !hash_equals(wzf_mascot_config_version($state['config']), $version)) throw new RuntimeException(__('Task state or configuration changed. Refresh before retrying recovery.', 'live2d-show'));
    };
    $state = wzf_mascot_task_snapshot(); $check($state);
    try { $scope = wzf_mascot_guard_scope_begin($state['lock']['guard'] === 1 ? 'legacy' : 'resource', false); }
    catch (Throwable $e) {
        if ($e->getMessage() === 'guard-busy') throw new RuntimeException(__('The task is still running. Recovery is unavailable.', 'live2d-show'));
        throw $e;
    }
    try {
        wzf_mascot_task_matches_guard($state['lock'], $scope['handle'], $scope['bridge']);
        $check(wzf_mascot_task_snapshot()); wzf_mascot_task_uncache();
        $check(wzf_mascot_task_snapshot()); wzf_mascot_uploads();
        if (!delete_option(WZF_MASCOT_LOCK) || wzf_mascot_task_snapshot()['exists']) throw new RuntimeException(__('Cannot remove the interrupted task record. Existing configuration is retained.', 'live2d-show'));
    } finally { wzf_mascot_guard_scope_end($scope); }
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
