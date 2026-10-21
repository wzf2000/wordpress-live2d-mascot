<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
function wzf_mascot_preference_key() {
    global $wpdb;
    return $wpdb->get_blog_prefix(get_current_blog_id()) . 'wzf_mascot_preferences_v1';
}
function wzf_mascot_preference_id($id) {
    if (!is_string($id) || !preg_match('/\A[A-Za-z0-9_-]{1,200}\z/D', $id) || in_array($id, ['__proto__','constructor','prototype'], true)) throw new RuntimeException('invalid-preferences');
    return $id;
}
function wzf_mascot_preference_fields($value, $allowed, $required) {
    if (!is_array($value) || array_diff(array_keys($value), $allowed) || array_diff($required, array_keys($value))) throw new RuntimeException('invalid-preferences');
}
function wzf_mascot_preference_schema($value) {
    wzf_mascot_preference_fields($value, ['character','favorites','layouts'], ['character','favorites','layouts']);
    $character = wzf_mascot_preference_id($value['character']);
    if (!is_array($value['favorites']) || !array_is_list($value['favorites']) || count($value['favorites']) > 100 || !is_array($value['layouts']) || !array_is_list($value['layouts']) || count($value['layouts']) > 100) throw new RuntimeException('invalid-preferences');
    $favorites = []; foreach ($value['favorites'] as $id) { $id = wzf_mascot_preference_id($id); if (in_array($id, $favorites, true)) throw new RuntimeException('invalid-preferences'); $favorites[] = $id; }
    $layouts = []; $seen = [];
    foreach ($value['layouts'] as $row) {
        wzf_mascot_preference_fields($row, ['id','position','size','anchor'], ['id','position','size']);
        $id = wzf_mascot_preference_id($row['id']);
        if (in_array($id, $seen, true) || !in_array($row['position'], ['left','right'], true) || !is_int($row['size']) || $row['size'] < 140 || $row['size'] > 260 || $row['size'] % 10 !== 0) throw new RuntimeException('invalid-preferences');
        $seen[] = $id; $next = ['id'=>$id,'position'=>$row['position'],'size'=>$row['size']];
        if (array_key_exists('anchor', $row)) {
            wzf_mascot_preference_fields($row['anchor'], ['x','y'], ['x','y']);
            foreach (['x','y'] as $axis) { $number = $row['anchor'][$axis]; if ((!is_int($number) && !is_float($number)) || !is_finite((float)$number) || $number < 0 || $number > 1) throw new RuntimeException('invalid-preferences'); }
            $next['anchor'] = ['x'=>$row['anchor']['x'],'y'=>$row['anchor']['y']];
        }
        $layouts[] = $next;
    }
    // Only syntax is checked: temporarily disabled/missing character IDs are retained.
    return ['character'=>$character,'favorites'=>$favorites,'layouts'=>$layouts];
}
// One atomic metadata value, read directly under the short per-user guard when saving.
// Writes remain WordPress API writes, with user-meta caches invalidated first.
function wzf_mascot_preference_snapshot($uid) {
    global $wpdb;
    $rows = $wpdb->get_results($wpdb->prepare("SELECT meta_value FROM {$wpdb->usermeta} WHERE user_id = %d AND meta_key = %s ORDER BY umeta_id LIMIT 2", $uid, wzf_mascot_preference_key()), ARRAY_A);
    if (!is_array($rows) || $wpdb->last_error !== '' || count($rows) > 1) throw new RuntimeException('account-unavailable');
    if (!$rows) return ['revision'=>0,'preferences'=>null];
    $state = maybe_unserialize($rows[0]['meta_value']);
    if (!is_array($state) || count($state) !== 2 || !is_int($state['revision'] ?? null) || $state['revision'] < 1 || $state['revision'] > 2147483646) throw new RuntimeException('account-unavailable');
    return ['revision'=>$state['revision'],'preferences'=>wzf_mascot_preference_schema($state['preferences'] ?? null)];
}
function wzf_mascot_save_preferences($uid, $revision, $preferences) {
    if ($uid !== get_current_user_id() || $uid < 1) throw new RuntimeException('sign-in-required');
    if (!is_int($revision) || $revision < 0 || $revision > 2147483645) throw new RuntimeException('invalid-request');
    $preferences = wzf_mascot_preference_schema($preferences);
    $guard = wzf_mascot_task_guard(true); // Shared permanent physical guard only; no administrator task option.
    try {
        if (!flock($guard, LOCK_EX | LOCK_NB)) throw new RuntimeException('account-busy');
        $current = wzf_mascot_preference_snapshot($uid);
        if ($current['revision'] !== $revision) return ['ok'=>false,'code'=>'conflict','state'=>$current];
        $next = ['revision'=>$revision + 1,'preferences'=>$preferences];
        wp_cache_delete($uid, 'user_meta');
        if (!update_user_meta($uid, wzf_mascot_preference_key(), $next)) throw new RuntimeException('account-unavailable');
        $saved = wzf_mascot_preference_snapshot($uid);
        if ($saved !== $next) throw new RuntimeException('account-unavailable');
        return ['ok'=>true,'state'=>$saved];
    } finally { flock($guard, LOCK_UN); fclose($guard); }
}
function wzf_mascot_preferences_post() {
    nocache_headers(); header('Cache-Control: private, no-store, max-age=0', true); header('Vary: Cookie', false);
    $uid = get_current_user_id();
    if ($uid < 1) wp_send_json_error(['code'=>'sign-in-required'], 401);
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') wp_send_json_error(['code'=>'invalid-request'], 405);
    try {
        $operation = $_POST['operation'] ?? null;
        $action = 'wzf_mascot_preferences:' . get_current_blog_id();
        if ($operation === 'bootstrap') {
            if (array_diff(array_keys($_POST), ['action','operation'])) throw new RuntimeException('invalid-request');
            wp_send_json_success(['nonce'=>wp_create_nonce($action),'state'=>wzf_mascot_preference_snapshot($uid)]);
        }
        if ($operation !== 'save' || array_diff(array_keys($_POST), ['action','operation','nonce','revision','preferences']) || !is_string($_POST['nonce'] ?? null) || !wp_verify_nonce(wp_unslash($_POST['nonce']), $action)) wp_send_json_error(['code'=>'invalid-request'], 403);
        if (!is_string($_POST['revision'] ?? null) || !preg_match('/\A(?:0|[1-9][0-9]{0,9})\z/D', $_POST['revision']) || !is_string($_POST['preferences'] ?? null) || strlen($_POST['preferences']) > 65536) throw new RuntimeException('invalid-request');
        $preferences = json_decode(wp_unslash($_POST['preferences']), true, 16, JSON_THROW_ON_ERROR);
        $result = wzf_mascot_save_preferences($uid, (int)$_POST['revision'], $preferences);
        if (!$result['ok']) wp_send_json_error(['code'=>$result['code'],'state'=>$result['state']], 409);
        wp_send_json_success(['state'=>$result['state']]);
    } catch (Throwable $e) {
        $code = in_array($e->getMessage(), ['sign-in-required','invalid-request','invalid-preferences','account-busy','account-unavailable'], true) ? $e->getMessage() : 'invalid-request';
        wp_send_json_error(['code'=>$code], $code === 'account-busy' ? 503 : 400);
    }
}
add_action('wp_ajax_wzf_mascot_preferences', 'wzf_mascot_preferences_post');
add_action('wp_ajax_nopriv_wzf_mascot_preferences', 'wzf_mascot_preferences_post');
