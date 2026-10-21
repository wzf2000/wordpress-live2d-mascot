<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;

function wzf_mascot_inventory_gate() {
    if (($_GET['page'] ?? null) !== 'wzf-mascot' || !isset($_POST['mascot_inventory'])) return;
    if (!current_user_can('manage_options') || ($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_inventory');
}

add_action('admin_init', 'wzf_mascot_inventory_gate');

// Metadata only. Protect complete model directories, including separately
// maintained catalog motions. Unknown references invalidate orphan conclusions.
// Direct read bypasses persistent/in-request option caches during concurrent imports.
// No SQL writes or new lock are performed. Unavailable state is conservative.
function wzf_mascot_inventory_state() {
    global $wpdb;
    if (!isset($wpdb)) return null;
    $rows = $wpdb->get_results($wpdb->prepare("SELECT option_name, option_value FROM {$wpdb->options} WHERE option_name IN (%s, %s)", WZF_MASCOT_OPTION, WZF_MASCOT_LOCK), ARRAY_A);
    if (!is_array($rows) || $wpdb->last_error !== '') return null;
    $state = ['config'=>['characters'=>[]], 'locked'=>false];
    foreach ($rows as $row) {
        if ($row['option_name'] === WZF_MASCOT_LOCK) $state['locked'] = true;
        elseif ($row['option_name'] === WZF_MASCOT_OPTION) $state['config'] = maybe_unserialize($row['option_value']);
    }
    return $state;
}
// A review is explicit and scoped to this scan; no setting is persisted.
function wzf_mascot_inventory_retention_days($value) {
    if ((!is_int($value) && !is_string($value)) || !preg_match('/\A[0-9]{1,4}\z/D', (string)$value) || (int)$value < 1 || (int)$value > 3650)
        throw new RuntimeException(__('Enter a review waiting period from 1 to 3650 whole days.', 'live2d-show'));
    return (int)$value;
}
function wzf_mascot_inventory_requested_review() {
    if (!isset($_POST['cleanup_review'])) return null;
    if ($_POST['cleanup_review'] !== '1') throw new RuntimeException(__('Select the read-only cleanup review option before continuing.', 'live2d-show'));
    return wzf_mascot_inventory_retention_days(!array_key_exists('retention_days', $_POST) ? 30 : (is_string($_POST['retention_days']) ? wp_unslash($_POST['retention_days']) : null));
}
function wzf_mascot_inventory_text($value) {
    // WordPress preserves entities in esc_html; pre-encode ampersands so a
    // filename such as literal &amp; stays identical to its filesystem name.
    return esc_html(str_replace('&', '&amp;', (string)$value));
}
function wzf_mascot_inventory_review_reason($code) {
    $labels = [
        'due'=>__('Minimum waiting period reached; review references and recovery needs before any cleanup.', 'live2d-show'),
        'waiting'=>__('The newest item in this subtree is still within the minimum waiting period.', 'live2d-show'),
        'protected-descendant'=>__('This subtree contains protected storage; preserve it as a whole.', 'live2d-show'),
        'protected'=>__('Referenced resources or protected storage; preserve this subtree.', 'live2d-show'),
        'incomplete'=>__('The scan, references or task state are incomplete or changed; no due review is available.', 'live2d-show'),
        'hardlink'=>__('Multiple hard links; ownership and physical storage are unknown.', 'live2d-show'),
        'symlink'=>__('Symbolic link; its target was not scanned.', 'live2d-show'),
        'special-or-unreadable'=>__('Special or inaccessible metadata; preserve for manual inspection.', 'live2d-show'),
        'invalid-mtime'=>__('A modification time is invalid or unavailable.', 'live2d-show'),
        'future-mtime'=>__('A modification time is in the future.', 'live2d-show'),
    ];
    return $labels[$code] ?? $code;
}
function wzf_mascot_inventory_finish_review($report, $version, $metadata, $retention_days, $scan_time, $max_rows) {
    $report = wzf_mascot_inventory_finish($report, $version);
    if ($retention_days === null) return $report;
    $complete = $report['complete'] && $report['referencesComplete'] && wzf_mascot_task_status()['status'] === 'idle';
    $review = ['schema'=>1, 'readOnly'=>true, 'retentionDays'=>$retention_days, 'scanTime'=>$scan_time,
        'complete'=>$complete, 'rowsTruncated'=>false, 'rows'=>[], 'reasons'=>$complete ? [] : ['incomplete']];
    // Deepest paths first: every observed descendant contributes once, even
    // when the ordinary path display or the review display is truncated.
    uksort($metadata, function($a, $b) { return substr_count($b, '/') <=> substr_count($a, '/') ?: strcmp($a, $b); });
    foreach (array_keys($metadata) as $path) {
        $parent = dirname($path);
        if ($parent === '.' || !isset($metadata[$parent])) continue;
        $metadata[$parent]['bytes'] += $metadata[$path]['bytes'];
        $metadata[$parent]['files'] += $metadata[$path]['files'];
        $metadata[$parent]['latestMtime'] = max($metadata[$parent]['latestMtime'] ?? 0, $metadata[$path]['latestMtime'] ?? 0);
        if (!in_array($metadata[$path]['kind'], ['unreferenced','unknown'], true)) $metadata[$parent]['reasons'][] = 'protected-descendant';
        $metadata[$parent]['reasons'] = array_values(array_unique(array_merge($metadata[$parent]['reasons'], $metadata[$path]['reasons'])));
    }
    ksort($metadata, SORT_STRING);
    foreach ($metadata as $path=>$item) {
        $parent = dirname($path);
        // Maximal unreferenced subtrees never repeat a descendant's capacity.
        // Protected ancestors can contain unreferenced siblings worth reviewing.
        if (isset($metadata[$parent]) && ($metadata[$parent]['kind'] === 'unreferenced' || $metadata[$parent]['kind'] === 'unknown' || ($item['kind'] !== 'unreferenced' && $item['kind'] !== 'unknown'))) continue;
        $reasons = $item['reasons'];
        if (!in_array($item['kind'], ['unreferenced','unknown'], true) || in_array('protected-descendant', $reasons, true)) { $status = 'protected'; array_unshift($reasons, 'protected'); }
        elseif (!$complete || $reasons) { $status = 'unknown'; if (!$complete) array_unshift($reasons, 'incomplete'); }
        else { $status = $item['latestMtime'] <= $scan_time - $retention_days * 86400 ? 'due' : 'waiting'; $reasons[] = $status; }
        if (count($review['rows']) >= $max_rows) { $review['rowsTruncated'] = true; continue; }
        $display_reasons = array_unique($reasons);
        if (in_array('protected-descendant', $display_reasons, true)) $display_reasons = array_diff($display_reasons, ['protected']);
        $review['rows'][] = ['path'=>(string)$path, 'status'=>$status, 'reason'=>implode(' ', array_map('wzf_mascot_inventory_review_reason', $display_reasons)),
            'reasons'=>array_values(array_unique($reasons)), 'bytes'=>$item['bytes'], 'files'=>$item['files'], 'latestMtime'=>$item['latestMtime']];
    }
    $report['cleanupReview'] = $review;
    return $report;
}
// Every metric distinguishes observed metadata from a complete capacity value.
function wzf_mascot_inventory_metric() { return ['bytes'=>null, 'observedBytes'=>0]; }
function wzf_mascot_inventory_character_summary($id) {
    $version = ['model'=>wzf_mascot_inventory_metric(), 'thumbnail'=>wzf_mascot_inventory_metric(), 'total'=>wzf_mascot_inventory_metric()];
    return ['id'=>(string)$id, 'current'=>$version, 'previous'=>$version, 'total'=>wzf_mascot_inventory_metric(), 'overlap'=>wzf_mascot_inventory_metric(), 'shared'=>wzf_mascot_inventory_metric(), 'sharedPaths'=>false];
}
function wzf_mascot_inventory_finish($report, $version) {
    $final_state = wzf_mascot_inventory_state();
    if ($final_state === null || $final_state['locked'] || !hash_equals($version, wzf_mascot_config_version($final_state['config']))) {
        $report['complete'] = false; $report['referencesComplete'] = false;
        if (count($report['issues']) < 20) $report['issues'][] = __('A resource task is in progress or configuration changed during inventory; classification is unknown.', 'live2d-show');
    }
    $complete = $report['complete'] && $report['referencesComplete'];
    $report['bytes'] = $complete ? $report['observedBytes'] : null;
    $report['characterSummary']['complete'] = $complete;
    foreach (['total','shared'] as $key) $report['characterSummary'][$key]['bytes'] = $complete ? $report['characterSummary'][$key]['observedBytes'] : null;
    foreach ($report['characterSummary']['characters'] as &$row) {
        foreach (['current','previous'] as $kind) foreach (['model','thumbnail','total'] as $key) $row[$kind][$key]['bytes'] = $complete ? $row[$kind][$key]['observedBytes'] : null;
        foreach (['total','overlap','shared'] as $key) $row[$key]['bytes'] = $complete ? $row[$key]['observedBytes'] : null;
    }
    unset($row);
    $report['characterSummary']['characters'] = array_values($report['characterSummary']['characters']);
    if (!$complete) {
        foreach ($report['paths'] as &$path) if ($path['kind'] === 'unreferenced') $path['kind'] = 'unknown';
        unset($path);
    }
    return $report;
}
// Called exactly once per observed regular file path, independently of the
// displayed path limit. A membership set prevents model/thumbnail/history or
// nested/shared references from adding the same path twice to any union.
function wzf_mascot_inventory_add_file(&$report, $relative, $bytes) {
    $owners = []; $matched = 0;
    foreach ($report['references'] as $reference) {
        if ($relative !== $reference['path'] && !($reference['directory'] && str_starts_with($relative, $reference['path'] . '/'))) continue;
        $matched++;
        if (!in_array($reference['kind'], ['current-model','previous-model','current-thumbnail','previous-thumbnail'], true)) continue;
        [$kind, $type] = explode('-', $reference['kind']);
        $owners[$reference['characterId']][$kind][$type] = true;
    }
    if (!$owners) return;
    $summary = &$report['characterSummary'];
    $summary['total']['observedBytes'] += $bytes;
    if ($matched > 1) $summary['shared']['observedBytes'] += $bytes;
    foreach ($owners as $id=>$versions) {
        $row = &$summary['characters'][$id];
        foreach ($versions as $kind=>$types) {
            foreach ($types as $type=>$_) $row[$kind][$type]['observedBytes'] += $bytes;
            $row[$kind]['total']['observedBytes'] += $bytes;
        }
        $row['total']['observedBytes'] += $bytes;
        if (count($versions) > 1) $row['overlap']['observedBytes'] += $bytes;
        if ($matched > 1) { $row['shared']['observedBytes'] += $bytes; $row['sharedPaths'] = true; }
        unset($row);
    }
}
function wzf_mascot_disk_inventory($config, $limits = [], $retention_days = null) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    $report = ['schema'=>2, 'complete'=>true, 'referencesComplete'=>true, 'bytes'=>null, 'observedBytes'=>0, 'files'=>0, 'hardlinkedFiles'=>0, 'entries'=>0, 'references'=>[], 'displayTruncated'=>false, 'paths'=>[], 'issues'=>[]];
    $max_entries = max(1, min(20000, (int)($limits['entries'] ?? 20000)));
    $max_rows = max(1, min(500, (int)($limits['rows'] ?? 500)));
    $seconds = max(0.001, min(3.0, (float)($limits['seconds'] ?? 3.0)));
    $report['limits'] = ['entries'=>$max_entries, 'seconds'=>$seconds, 'displayedPaths'=>$max_rows, 'references'=>1000];
    $report['characterSummary'] = ['complete'=>false, 'total'=>wzf_mascot_inventory_metric(), 'shared'=>wzf_mascot_inventory_metric(), 'characters'=>[]];
    $started = microtime(true);
    $scan_time = time(); $metadata = [];
    if ($retention_days !== null) $retention_days = wzf_mascot_inventory_retention_days($retention_days);
    $max_review_rows = max(1, min(500, (int)($limits['reviewRows'] ?? 500)));
    $version = wzf_mascot_config_version($config);
    $references_seen = 0;
    $initial_state = wzf_mascot_inventory_state();
    if ($initial_state === null || $initial_state['locked'] || !hash_equals($version, wzf_mascot_config_version($initial_state['config']))) { $report['complete'] = false; $report['referencesComplete'] = false; }
    if ($retention_days !== null && wzf_mascot_task_status()['status'] !== 'idle') $report['complete'] = false;
    $unknown = function($message) use (&$report) { $report['referencesComplete'] = false; if (count($report['issues']) < 20) $report['issues'][] = $message; };
    try { $root = wzf_mascot_uploads()['path']; }
    catch (Throwable $e) { $report['complete'] = false; $unknown(__('The resource root is unavailable or unsafe.', 'live2d-show')); return wzf_mascot_inventory_finish_review($report, $version, $metadata, $retention_days, $scan_time, $max_review_rows); }
    $protect = function($path, $kind, $directory = false, $character_id = '') use (&$report, $root, $unknown) {
        try {
            $relative = wzf_mascot_path($directory && is_string($path) ? rtrim($path, '/') : $path);
            $absolute = wzf_mascot_no_links($root . '/' . $relative);
            if (($directory ? !is_dir($absolute) : !is_file($absolute)) || !is_readable($absolute)) throw new RuntimeException('unknown');
            if (count($report['references']) >= 1000) throw new RuntimeException('bounded');
            $shared = false;
            foreach ($report['references'] as &$reference) {
                if ($relative === $reference['path'] || ($directory && str_starts_with($reference['path'], $relative . '/')) || ($reference['directory'] && str_starts_with($relative, $reference['path'] . '/'))) { $shared = true; $reference['shared'] = true; }
            }
            unset($reference);
            $report['references'][] = ['path'=>$relative, 'kind'=>$kind, 'directory'=>$directory, 'characterId'=>(string)$character_id, 'shared'=>$shared];
        } catch (Throwable $e) { $unknown(__('A configured reference is invalid, missing, inaccessible or exceeds the report limit; classification is unknown.', 'live2d-show')); }
    };
    if (!is_array($config) || !is_array($config['characters'] ?? null)) $unknown(__('Resource configuration is invalid; classification is unknown.', 'live2d-show'));
    else {
        if (array_key_exists('core', $config)) $protect(is_array($config['core']) ? ($config['core']['path'] ?? null) : null, 'shared-core');
        if (array_key_exists('presentation', $config)) $protect(is_array($config['presentation']) ? ($config['presentation']['terms'] ?? null) : null, 'shared-terms');
        foreach (['characters'=>'current', 'history'=>'previous'] as $key=>$kind) {
            if (array_key_exists($key, $config) && !is_array($config[$key])) { $unknown(__('Character references are invalid; classification is unknown.', 'live2d-show')); continue; }
            foreach ($config[$key] ?? [] as $character_id=>$character) {
                if (++$references_seen > 1000 || microtime(true) - $started >= $seconds) { $unknown(__('Reference inspection reached its bound; classification is unknown.', 'live2d-show')); break 2; }
                if (!preg_match('/\A[A-Za-z0-9_-]{1,200}\z/D', (string)$character_id)) { $unknown(__('Character references are invalid; classification is unknown.', 'live2d-show')); continue; }
                if (!isset($report['characterSummary']['characters'][$character_id])) $report['characterSummary']['characters'][$character_id] = wzf_mascot_inventory_character_summary($character_id);
                if (!is_array($character)) { $unknown(__('Character references are invalid; classification is unknown.', 'live2d-show')); continue; }
                $protect($character['root'] ?? null, $kind . '-model', true, $character_id);
                if (array_key_exists('thumbnail', $character)) $protect($character['thumbnail'], $kind . '-thumbnail', false, $character_id);
            }
        }
    }
    foreach ($report['references'] as $reference) if ($reference['shared'] && isset($report['characterSummary']['characters'][$reference['characterId']])) $report['characterSummary']['characters'][$reference['characterId']]['sharedPaths'] = true;
    // Ancestors and descendants both intersect a protected directory. This also
    // handles migrated/nested roots instead of assuming importer directory names.
    $classify = function($relative) use (&$report) {
        $kinds = [];
        foreach ($report['references'] as $reference) {
            $path = $reference['path'];
            if ($relative === $path || str_starts_with($path, $relative . '/') || ($reference['directory'] && str_starts_with($relative, $path . '/'))) $kinds[] = $reference['kind'];
        }
        if (in_array($relative, ['index.html', '.htaccess', 'web.config', WZF_MASCOT_GUARD_FILE, WZF_MASCOT_RESOURCE_GUARD_FILE], true)) $kinds[] = 'directory-guard';
        if ($relative === WZF_MASCOT_ACCOUNT_GUARD_DIR || str_starts_with($relative, WZF_MASCOT_ACCOUNT_GUARD_DIR . '/')) $kinds[] = 'directory-guard';
        if (preg_match('~(?:^|/)core-[^/]+(?:/|$)~', $relative)) $kinds[] = 'retained-core';
        if (preg_match('~(?:^|/)stage-[^/]+(?:/|$)~', $relative)) $kinds[] = 'staging';
        if ($kinds) return implode(', ', array_unique($kinds));
        return 'unreferenced';
    };
    if (!is_dir($root)) {
        if (file_exists($root)) { $report['complete'] = false; $unknown(__('The resource root exists but is not a directory.', 'live2d-show')); }
        return wzf_mascot_inventory_finish_review($report, $version, $metadata, $retention_days, $scan_time, $max_review_rows);
    }
    $pending = [''];
    while ($pending) {
        $dir = array_pop($pending);
        $absolute = $root . ($dir === '' ? '' : '/' . $dir);
        try {
            wzf_mascot_no_links($absolute);
            if (!is_readable($absolute)) throw new RuntimeException('unreadable');
            $iterator = new FilesystemIterator($absolute, FilesystemIterator::SKIP_DOTS);
            foreach ($iterator as $item) {
                if ($report['entries'] >= $max_entries || microtime(true) - $started >= $seconds) { $report['complete'] = false; break 2; }
                $report['entries']++;
                $relative = ($dir === '' ? '' : $dir . '/') . $item->getFilename();
                // lstat never follows the final symlink. Recheck every ancestor.
                wzf_mascot_no_links(dirname($item->getPathname()));
                $stat = @lstat($item->getPathname());
                $type = $stat === false ? 0 : ($stat['mode'] & 0170000);
                $state = $classify($relative);
                if ($type === 0040000) $pending[] = $relative;
                elseif ($type === 0100000) {
                    $report['files']++; $report['observedBytes'] += $stat['size'];
                    wzf_mascot_inventory_add_file($report, $relative, $stat['size']);
                    if ($stat['nlink'] > 1) $report['hardlinkedFiles']++;
                    if (!is_readable($item->getPathname())) { $report['complete'] = false; $state = 'unknown'; }
                } else { $report['complete'] = false; $state = 'unknown'; }
                if ($retention_days !== null) {
                    $reasons = [];
                    if ($type !== 0040000 && $type !== 0100000) $reasons[] = $type === 0120000 ? 'symlink' : 'special-or-unreadable';
                    if ($type === 0100000 && $stat['nlink'] > 1) $reasons[] = 'hardlink';
                    if ($state === 'unknown') $reasons[] = 'special-or-unreadable';
                    $mtime = $stat['mtime'] ?? null;
                    if (!is_int($mtime) || $mtime <= 0) $reasons[] = 'invalid-mtime';
                    elseif ($mtime > $scan_time) $reasons[] = 'future-mtime';
                    $metadata[$relative] = ['kind'=>$state, 'bytes'=>$type === 0100000 ? $stat['size'] : 0,
                        'files'=>$type === 0100000 ? 1 : 0, 'latestMtime'=>is_int($mtime) ? $mtime : null, 'reasons'=>$reasons];
                }
                if (count($report['paths']) < $max_rows) $report['paths'][] = ['path'=>$relative, 'kind'=>$state, 'bytes'=>$type === 0100000 ? $stat['size'] : null];
                else $report['displayTruncated'] = true;
            }
        } catch (Throwable $e) { $report['complete'] = false; }
    }
    return wzf_mascot_inventory_finish_review($report, $version, $metadata, $retention_days, $scan_time, $max_review_rows);
}

// A separate explicit POST starts a fresh bounded read-only scan. No report
// is saved in options, files, transients or frontend configuration.
function wzf_mascot_inventory_export_json($retention_days = null) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    $state = wzf_mascot_inventory_state();
    return wp_json_encode(wzf_mascot_disk_inventory($state === null ? null : $state['config'], [], $retention_days), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}
function wzf_mascot_inventory_export_gate() {
    if (($_GET['page'] ?? null) !== 'wzf-mascot' || !isset($_POST['mascot_inventory_export'])) return;
    if (!current_user_can('manage_options') || ($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_inventory_export');
    try { $retention_days = wzf_mascot_inventory_requested_review(); }
    catch (Throwable $e) { wp_die(esc_html($e->getMessage()), '', ['response'=>400]); return; }
    $json = wzf_mascot_inventory_export_json($retention_days);
    if (!is_string($json)) wp_die(__('The inventory report could not be encoded. No report was saved.', 'live2d-show'), '', ['response'=>500]);
    nocache_headers();
    header('Content-Type: application/json; charset=UTF-8');
    header('Content-Disposition: attachment; filename="mascot-resource-inventory.json"');
    echo $json;
    exit;
}
add_action('admin_init', 'wzf_mascot_inventory_export_gate');
function wzf_mascot_inventory_capacity_label($metric) {
    return $metric['bytes'] === null
        ? sprintf(__('Partial: %s observed bytes', 'live2d-show'), number_format_i18n($metric['observedBytes']))
        : sprintf(__('%s bytes', 'live2d-show'), number_format_i18n($metric['bytes']));
}
function wzf_mascot_inventory_capacity_panel($summary) {
    echo '<h3>' . esc_html__('Character capacity summary', 'live2d-show') . '</h3><p>' . esc_html__('Each total counts a relative file path once. Current, previous, thumbnail and character rows may share paths: do not add these values together. Hard links still count once per path; these are logical sizes, not physical disk usage.', 'live2d-show') . '</p>';
    if (!$summary['complete']) echo '<p role="status">' . esc_html__('Capacity is partial or references are unknown. Observed bytes are not a complete size; complete values are unavailable.', 'live2d-show') . '</p>';
    echo '<p>' . esc_html(sprintf(__('Unique paths referenced by characters: %1$s. Shared reference paths: %2$s.', 'live2d-show'), wzf_mascot_inventory_capacity_label($summary['total']), wzf_mascot_inventory_capacity_label($summary['shared']))) . '</p>';
    if (!$summary['characters']) { echo '<p>' . esc_html__('No character capacity rows were available within the inspection limits.', 'live2d-show') . '</p>'; return; }
    echo '<div class="wzf-mascot-table"><table class="widefat striped wzf-mascot-capacity-table"><thead><tr><th scope="col">' . esc_html__('Character ID', 'live2d-show') . '</th><th scope="col">' . esc_html__('Current references', 'live2d-show') . '</th><th scope="col">' . esc_html__('Previous references', 'live2d-show') . '</th><th scope="col">' . esc_html__('Unique character total', 'live2d-show') . '</th><th scope="col">' . esc_html__('Current / previous overlap', 'live2d-show') . '</th><th scope="col">' . esc_html__('Shared paths', 'live2d-show') . '</th></tr></thead><tbody>';
    foreach ($summary['characters'] as $row) {
        echo '<tr><th scope="row"><code>' . wzf_mascot_inventory_text($row['id']) . '</code></th>';
        foreach (['current','previous'] as $kind) echo '<td><div>' . esc_html(sprintf(__('Model: %s', 'live2d-show'), wzf_mascot_inventory_capacity_label($row[$kind]['model']))) . '</div><div>' . esc_html(sprintf(__('Thumbnail: %s', 'live2d-show'), wzf_mascot_inventory_capacity_label($row[$kind]['thumbnail']))) . '</div><div>' . esc_html(sprintf(__('Unique subtotal: %s', 'live2d-show'), wzf_mascot_inventory_capacity_label($row[$kind]['total']))) . '</div></td>';
        echo '<td>' . esc_html(wzf_mascot_inventory_capacity_label($row['total'])) . '</td><td>' . esc_html(wzf_mascot_inventory_capacity_label($row['overlap'])) . '</td><td>' . esc_html(wzf_mascot_inventory_capacity_label($row['shared'])) . ($row['sharedPaths'] ? '<br>' . esc_html__('Shared reference paths; preserve', 'live2d-show') : '') . '</td></tr>';
    }
    echo '</tbody></table></div>';
}
function wzf_mascot_inventory_review_fields($id) {
    $checked = ($_POST['cleanup_review'] ?? '') === '1';
    $days = 30;
    try { if ($checked) $days = wzf_mascot_inventory_requested_review(); } catch (Throwable $e) { /* Show the rejected request as a notice, never as a saved setting. */ }
    echo '<p><label><input type="checkbox" name="cleanup_review" value="1"' . ($checked ? ' checked' : '') . '> ' . esc_html__('Include read-only cleanup review', 'live2d-show') . '</label></p><p><label for="' . esc_attr($id) . '">' . esc_html__('Minimum review waiting period (days)', 'live2d-show') . '</label> <input id="' . esc_attr($id) . '" type="number" name="retention_days" min="1" max="3650" step="1" value="' . (int)$days . '" class="small-text"></p>';
}
function wzf_mascot_inventory_review_panel($review) {
    $labels = ['due'=>__('Due for review', 'live2d-show'), 'waiting'=>__('Waiting period', 'live2d-show'), 'protected'=>__('Protected / preserve', 'live2d-show'), 'unknown'=>__('Unknown / preserve', 'live2d-show')];
    echo '<div class="wzf-mascot-cleanup-review"><h3 id="wzf-mascot-cleanup-review-title">' . esc_html__('Read-only cleanup review', 'live2d-show') . '</h3><p>' . esc_html(sprintf(__('The %s-day period is a minimum wait before manual review, not permission to delete. External references, cached URLs, licensing and recovery needs remain unknown. This report changes no files or settings.', 'live2d-show'), number_format_i18n($review['retentionDays']))) . '</p>';
    if (!$review['complete']) echo '<p role="status">' . esc_html(wzf_mascot_inventory_review_reason('incomplete')) . '</p>';
    if ($review['rowsTruncated']) echo '<p>' . esc_html__('The cleanup review display is truncated at 500 rows; subtree totals still use all metadata observed within the scan limit.', 'live2d-show') . '</p>';
    if (!$review['rows']) { echo '<p>' . esc_html__('No cleanup review rows were available within the inspection limits.', 'live2d-show') . '</p></div>'; return; }
    echo '<div class="wzf-mascot-table" role="region" tabindex="0" aria-labelledby="wzf-mascot-cleanup-review-title"><table class="widefat striped wzf-mascot-cleanup-table"><thead><tr><th scope="col">' . esc_html__('Relative path', 'live2d-show') . '</th><th scope="col">' . esc_html__('Review status', 'live2d-show') . '</th><th scope="col">' . esc_html__('Reason', 'live2d-show') . '</th><th scope="col">' . esc_html__('Logical bytes / files', 'live2d-show') . '</th><th scope="col">' . esc_html__('Newest modification (UTC)', 'live2d-show') . '</th></tr></thead><tbody>';
    foreach ($review['rows'] as $row) echo '<tr><th scope="row"><code>' . wzf_mascot_inventory_text($row['path']) . '</code></th><td>' . esc_html($labels[$row['status']]) . '</td><td>' . esc_html($row['reason']) . '</td><td>' . esc_html(number_format_i18n($row['bytes']) . ' / ' . number_format_i18n($row['files'])) . '</td><td>' . esc_html($row['latestMtime'] === null ? '—' : gmdate('Y-m-d H:i:s', $row['latestMtime'])) . '</td></tr>';
    echo '</tbody></table></div></div>';
}
function wzf_mascot_inventory_panel($config) {
    echo '<section class="wzf-mascot-card"><h2>' . esc_html__('Disk inventory', 'live2d-show') . '</h2><p>' . esc_html__('Run a bounded, read-only metadata inventory of uploads/wzf-mascot. Unreferenced files are not safe to delete. No cleanup, hashing, texture reads or configuration changes occur.', 'live2d-show') . '</p><form method="post" action="' . esc_url(admin_url('options-general.php?page=wzf-mascot')) . '">';
    wp_nonce_field('wzf_mascot_inventory');
    echo '<input type="hidden" name="mascot_inventory" value="1">'; wzf_mascot_inventory_review_fields('mascot-review-days'); submit_button(__('Inspect disk usage', 'live2d-show')); echo '</form>';
    echo '<form method="post" action="' . esc_url(admin_url('options-general.php?page=wzf-mascot')) . '">';
    wp_nonce_field('wzf_mascot_inventory_export');
    echo '<input type="hidden" name="mascot_inventory_export" value="1"><p class="description">' . esc_html__('Download starts a new bounded metadata scan and saves the JSON only to your device. It may differ from an earlier inventory. Nothing is saved on the server or sent to another service.', 'live2d-show') . '</p>';
    wzf_mascot_inventory_review_fields('mascot-export-review-days');
    submit_button(__('Download fresh inventory JSON', 'live2d-show'), 'secondary'); echo '</form>';
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && ($_POST['mascot_inventory'] ?? '') === '1') {
        check_admin_referer('wzf_mascot_inventory');
        try { $retention_days = wzf_mascot_inventory_requested_review(); }
        catch (Throwable $e) { echo '<p role="alert">' . esc_html($e->getMessage()) . '</p></section>'; return; }
        $report = wzf_mascot_disk_inventory($config, [], $retention_days);
        echo '<p role="status">' . esc_html($report['complete'] && $report['referencesComplete'] ? __('Inventory complete.', 'live2d-show') : __('Inventory incomplete or references unknown. Unreferenced classification is withheld.', 'live2d-show')) . '</p>';
        echo '<p>' . esc_html(sprintf(__('%1$s observed logical bytes across %2$s files; %3$s paths have multiple hard links. This is not physical disk usage; incomplete scans are partial.', 'live2d-show'), number_format_i18n($report['observedBytes']), number_format_i18n($report['files']), number_format_i18n($report['hardlinkedFiles']))) . '</p><p>' . esc_html__('Limits: 20,000 entries, 3 seconds, 500 displayed paths and 1,000 references. Counts may be partial. Source permissions are unknown; preserve every referenced directory, including disabled and trashed characters.', 'live2d-show') . '</p>';
        wzf_mascot_inventory_capacity_panel($report['characterSummary']);
        if (isset($report['cleanupReview'])) wzf_mascot_inventory_review_panel($report['cleanupReview']);
        if ($report['displayTruncated']) echo '<p>' . esc_html__('The path display is truncated; metadata counts cover the bounded scan.', 'live2d-show') . '</p>';
        foreach (array_unique($report['issues']) as $issue) echo '<p>' . esc_html($issue) . '</p>';
        echo '<details><summary>' . esc_html__('Current, previous and shared references', 'live2d-show') . '</summary>';
        foreach ($report['references'] as $reference) echo '<p><code>' . wzf_mascot_inventory_text($reference['path']) . '</code> ' . wzf_mascot_inventory_text($reference['characterId']) . ' — ' . esc_html(wzf_mascot_inventory_label($reference['kind'])) . ($reference['shared'] ? ' · ' . esc_html__('Shared reference paths; preserve', 'live2d-show') : '') . '</p>';
        echo '</details><details open><summary>' . esc_html__('Observed paths (admin only)', 'live2d-show') . '</summary><div class="wzf-mascot-table"><table class="widefat striped"><thead><tr><th>' . esc_html__('Relative path', 'live2d-show') . '</th><th>' . esc_html__('Reference classification', 'live2d-show') . '</th><th>' . esc_html__('Logical bytes', 'live2d-show') . '</th></tr></thead><tbody>';
        foreach ($report['paths'] as $path) echo '<tr><td><code>' . wzf_mascot_inventory_text($path['path']) . '</code></td><td>' . esc_html(wzf_mascot_inventory_label($path['kind'])) . '</td><td>' . esc_html($path['bytes'] === null ? '—' : number_format_i18n($path['bytes'])) . '</td></tr>';
        echo '</tbody></table></div></details>';
    }
    echo '</section>';
}
function wzf_mascot_inventory_label($kind) {
    $labels = ['directory-guard'=>__('Directory protection file', 'live2d-show'), 'retained-core'=>__('Retained Core directory / manual review', 'live2d-show'), 'staging'=>__('Staging / preserve', 'live2d-show'), 'shared-core'=>__('Shared Core', 'live2d-show'), 'shared-terms'=>__('Shared terms', 'live2d-show'), 'current-model'=>__('Current model directory', 'live2d-show'), 'previous-model'=>__('Previous model directory', 'live2d-show'), 'current-thumbnail'=>__('Current thumbnail', 'live2d-show'), 'previous-thumbnail'=>__('Previous thumbnail', 'live2d-show'), 'unknown'=>__('Unknown / protected', 'live2d-show'), 'unreferenced'=>__('Unreferenced / preserve', 'live2d-show')];
    return implode(', ', array_map(function($code) use ($labels) { return $labels[$code] ?? $code; }, explode(', ', $kind)));
}
