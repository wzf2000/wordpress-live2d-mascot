<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;

function wzf_mascot_inventory_gate() {
    if (($_GET['page'] ?? null) !== 'wzf-mascot' || !isset($_POST['mascot_inventory'])) return;
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
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
function wzf_mascot_disk_inventory($config, $limits = []) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    $report = ['complete'=>true, 'referencesComplete'=>true, 'bytes'=>0, 'files'=>0, 'hardlinkedFiles'=>0, 'entries'=>0, 'references'=>[], 'displayTruncated'=>false, 'paths'=>[], 'issues'=>[]];
    $max_entries = max(1, min(20000, (int)($limits['entries'] ?? 20000)));
    $max_rows = max(1, min(500, (int)($limits['rows'] ?? 500)));
    $seconds = max(0.001, min(3.0, (float)($limits['seconds'] ?? 3.0)));
    $started = microtime(true);
    $version = wzf_mascot_config_version($config);
    $references_seen = 0;
    $initial_state = wzf_mascot_inventory_state();
    if ($initial_state === null || $initial_state['locked'] || !hash_equals($version, wzf_mascot_config_version($initial_state['config']))) { $report['complete'] = false; $report['referencesComplete'] = false; }
    $unknown = function($message) use (&$report) { $report['referencesComplete'] = false; if (count($report['issues']) < 20) $report['issues'][] = $message; };
    try { $root = wzf_mascot_uploads()['path']; }
    catch (Throwable $e) { $report['complete'] = false; $unknown(__('The resource root is unavailable or unsafe.', 'live2d-show')); return $report; }
    $protect = function($path, $kind, $directory = false, $character_id = '') use (&$report, $root, $unknown) {
        try {
            $relative = wzf_mascot_path($directory && is_string($path) ? rtrim($path, '/') : $path);
            $absolute = wzf_mascot_no_links($root . '/' . $relative);
            if (($directory ? !is_dir($absolute) : !is_file($absolute)) || !is_readable($absolute)) throw new RuntimeException('unknown');
            if (count($report['references']) >= 1000) throw new RuntimeException('bounded');
            $report['references'][] = ['path'=>$relative, 'kind'=>$kind, 'directory'=>$directory, 'characterId'=>(string)$character_id];
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
                if (!is_array($character)) { $unknown(__('Character references are invalid; classification is unknown.', 'live2d-show')); continue; }
                $protect($character['root'] ?? null, $kind . '-model', true, $character_id);
                if (array_key_exists('thumbnail', $character)) $protect($character['thumbnail'], $kind . '-thumbnail', false, $character_id);
            }
        }
    }
    // Ancestors and descendants both intersect a protected directory. This also
    // handles migrated/nested roots instead of assuming importer directory names.
    $classify = function($relative) use (&$report) {
        $kinds = [];
        foreach ($report['references'] as $reference) {
            $path = $reference['path'];
            if ($relative === $path || str_starts_with($path, $relative . '/') || ($reference['directory'] && str_starts_with($relative, $path . '/'))) $kinds[] = $reference['kind'];
        }
        if (in_array($relative, ['index.html', '.htaccess', 'web.config'], true)) $kinds[] = 'directory-guard';
        if (preg_match('~(?:^|/)stage-[^/]+(?:/|$)~', $relative)) $kinds[] = 'staging';
        if ($kinds) return implode(', ', array_unique($kinds));
        return 'unreferenced';
    };
    if (!is_dir($root)) {
        if (file_exists($root)) { $report['complete'] = false; $unknown(__('The resource root exists but is not a directory.', 'live2d-show')); }
        return $report;
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
                    $report['files']++; $report['bytes'] += $stat['size'];
                    if ($stat['nlink'] > 1) $report['hardlinkedFiles']++;
                    if (!is_readable($item->getPathname())) { $report['complete'] = false; $state = 'unknown'; }
                } else { $report['complete'] = false; $state = 'unknown'; }
                if (count($report['paths']) < $max_rows) $report['paths'][] = ['path'=>$relative, 'kind'=>$state, 'bytes'=>$type === 0100000 ? $stat['size'] : null];
                else $report['displayTruncated'] = true;
            }
        } catch (Throwable $e) { $report['complete'] = false; }
    }
    $final_state = wzf_mascot_inventory_state();
    if ($final_state === null || $final_state['locked'] || !hash_equals($version, wzf_mascot_config_version($final_state['config']))) {
        $report['complete'] = false;
        $unknown(__('A resource task is in progress or configuration changed during inventory; classification is unknown.', 'live2d-show'));
    }
    if (!$report['complete'] || !$report['referencesComplete']) {
        foreach ($report['paths'] as &$path) if ($path['kind'] === 'unreferenced') $path['kind'] = 'unknown';
        unset($path);
    }
    return $report;
}

function wzf_mascot_inventory_panel($config) {
    echo '<section class="wzf-mascot-card"><h2>' . esc_html__('Disk inventory', 'live2d-show') . '</h2><p>' . esc_html__('Run a bounded, read-only metadata inventory of uploads/wzf-mascot. Unreferenced files are not safe to delete. No cleanup, hashing, texture reads or configuration changes occur.', 'live2d-show') . '</p><form method="post" action="' . esc_url(admin_url('options-general.php?page=wzf-mascot')) . '">';
    wp_nonce_field('wzf_mascot_inventory');
    echo '<input type="hidden" name="mascot_inventory" value="1">'; submit_button(__('Inspect disk usage', 'live2d-show')); echo '</form>';
    if (($_POST['mascot_inventory'] ?? '') === '1') {
        check_admin_referer('wzf_mascot_inventory');
        $report = wzf_mascot_disk_inventory($config);
        echo '<p role="status">' . esc_html($report['complete'] && $report['referencesComplete'] ? __('Inventory complete.', 'live2d-show') : __('Inventory incomplete or references unknown. Unreferenced classification is withheld.', 'live2d-show')) . '</p>';
        echo '<p>' . esc_html(sprintf(__('%1$s logical bytes across %2$s files; %3$s paths have multiple hard links. This is not physical disk usage.', 'live2d-show'), number_format_i18n($report['bytes']), number_format_i18n($report['files']), number_format_i18n($report['hardlinkedFiles']))) . '</p><p>' . esc_html__('Limits: 20,000 entries, 3 seconds, 500 displayed paths and 1,000 references. Counts may be partial. Source permissions are unknown; preserve every referenced directory, including disabled and trashed characters.', 'live2d-show') . '</p>';
        if ($report['displayTruncated']) echo '<p>' . esc_html__('The path display is truncated; metadata counts cover the bounded scan.', 'live2d-show') . '</p>';
        foreach (array_unique($report['issues']) as $issue) echo '<p>' . esc_html($issue) . '</p>';
        echo '<details><summary>' . esc_html__('Current, previous and shared references', 'live2d-show') . '</summary>';
        foreach ($report['references'] as $reference) echo '<p><code>' . esc_html($reference['path']) . '</code> ' . esc_html($reference['characterId']) . ' — ' . esc_html(wzf_mascot_inventory_label($reference['kind'])) . '</p>';
        echo '</details><details open><summary>' . esc_html__('Observed paths (admin only)', 'live2d-show') . '</summary><div class="wzf-mascot-table"><table class="widefat striped"><thead><tr><th>' . esc_html__('Relative path', 'live2d-show') . '</th><th>' . esc_html__('Reference classification', 'live2d-show') . '</th><th>' . esc_html__('Logical bytes', 'live2d-show') . '</th></tr></thead><tbody>';
        foreach ($report['paths'] as $path) echo '<tr><td><code>' . esc_html($path['path']) . '</code></td><td>' . esc_html(wzf_mascot_inventory_label($path['kind'])) . '</td><td>' . esc_html($path['bytes'] === null ? '—' : number_format_i18n($path['bytes'])) . '</td></tr>';
        echo '</tbody></table></div></details>';
    }
    echo '</section>';
}
function wzf_mascot_inventory_label($kind) {
    $labels = ['directory-guard'=>__('Directory protection file', 'live2d-show'), 'staging'=>__('Staging / preserve', 'live2d-show'), 'shared-core'=>__('Shared Core', 'live2d-show'), 'shared-terms'=>__('Shared terms', 'live2d-show'), 'current-model'=>__('Current model directory', 'live2d-show'), 'previous-model'=>__('Previous model directory', 'live2d-show'), 'current-thumbnail'=>__('Current thumbnail', 'live2d-show'), 'previous-thumbnail'=>__('Previous thumbnail', 'live2d-show'), 'unknown'=>__('Unknown / protected', 'live2d-show'), 'unreferenced'=>__('Unreferenced / preserve', 'live2d-show')];
    return implode(', ', array_map(function($code) use ($labels) { return $labels[$code] ?? $code; }, explode(', ', $kind)));
}
