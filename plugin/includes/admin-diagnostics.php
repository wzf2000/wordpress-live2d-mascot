<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
// Lightweight display gate: types and entry-file metadata only. No model parsing,
// reference walk, texture read or hashing; full diagnostics remain explicit.
function wzf_mascot_character_display_check($id, $c, $uploads) {
    if ((!is_string($id) && !is_int($id)) || !preg_match('/\A[A-Za-z0-9_-]{1,200}\z/D', (string)$id) || !is_array($c)) throw new RuntimeException(__('Character ID or configuration structure is invalid.', 'live2d-show'));
    $status = wzf_mascot_character_status($c);
    if (!is_string($status) || !in_array($status, ['active','disabled','trash'], true)) throw new RuntimeException(__('Character status is invalid.', 'live2d-show'));
    wzf_mascot_plain_text($c['name'] ?? null, 200, true);
    wzf_mascot_plain_text($c['credit'] ?? '', 300);
    foreach (['idle','welcome'] as $key) {
        if ($key === 'welcome' && ($c[$key] ?? null) === null) continue;
        wzf_mascot_plain_text($c[$key] ?? null, 200, true);
    }
    foreach (wzf_mascot_list($c['greetings'] ?? [], 'Greetings') as $motion) wzf_mascot_plain_text($motion, 200, true);
    foreach (['size','offset','renderScale'] as $key) {
        if ($key === 'renderScale' && !array_key_exists($key, $c)) continue;
        $v = $c[$key] ?? null;
        if ((!is_int($v) && !is_float($v) && !is_string($v)) || !is_numeric($v) || !is_finite((float)$v)) throw new RuntimeException(__('Character layout configuration is invalid.', 'live2d-show'));
    }
    if ($c['size'] < 140 || $c['size'] > 260 || (float)$c['size'] != (int)$c['size'] || (int)$c['size'] % 10 !== 0 || abs((float)$c['offset']) > 100 || (isset($c['renderScale']) && $c['renderScale'] <= 0)) throw new RuntimeException(__('Character layout configuration is invalid.', 'live2d-show'));
    if (array_key_exists('termsAnchor', $c)) wzf_mascot_plain_text($c['termsAnchor'], 200);
    if (!is_string($c['root'] ?? null)) throw new RuntimeException(__('Character resource path is invalid.', 'live2d-show'));
    $root = wzf_mascot_path(rtrim($c['root'], '/'));
    $file = wzf_mascot_path($c['file'] ?? null);
    if (!str_ends_with($file, '.model3.json')) throw new RuntimeException(__('Character model entry is invalid.', 'live2d-show'));
    foreach ([$file, 'catalog.json'] as $relative) {
        $path = wzf_mascot_no_links($uploads['path'] . '/' . $root . '/' . $relative);
        if (!is_file($path) || !is_readable($path) || filesize($path) < 1 || filesize($path) > 8 * 1024 * 1024) throw new RuntimeException(__('The character model or catalog entry is missing, unreadable or has an invalid size.', 'live2d-show'));
    }
    return $root;
}
function wzf_mascot_display_report($config) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    $rows = [];
    foreach (is_array($config['characters'] ?? null) ? $config['characters'] : [] as $id=>$c) {
        try {
            wzf_mascot_character_display_check($id, $c, wzf_mascot_uploads());
            $state = wzf_mascot_character_status($c) === 'active' ? __('Display entry ready', 'live2d-show') : __('Disabled / trashed', 'live2d-show');
            $rows[] = ['id'=>(string)$id,'ok'=>true,'state'=>$state,'message'=>__('The lightweight entry check passed.', 'live2d-show')];
        } catch (Throwable $e) {
            $rows[] = ['id'=>(string)$id,'ok'=>false,'state'=>__('Isolated', 'live2d-show'),'message'=>wzf_mascot_error_message($e)];
        }
    }
    return $rows;
}
// Validate diagnostic POSTs before WordPress emits the admin header.
function wzf_mascot_diagnostics_gate() {
    if (($_GET['page'] ?? null) !== 'wzf-mascot' || !isset($_POST['mascot_diagnostics'])) return;
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_diagnostics');
}
add_action('admin_init', 'wzf_mascot_diagnostics_gate');
function wzf_mascot_diagnose_resources($config) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    $report = ['core'=>[], 'characters'=>[], 'presentation'=>[], 'activeCount'=>0];
    if (!is_array($config) || !is_array($config['characters'] ?? null)) return ['configuration'=>['ok'=>false,'message'=>__('Resource configuration structure is invalid.', 'live2d-show')]];
    try {
        $u = wzf_mascot_uploads();
        $core = $config['core'] ?? null;
        if (!is_array($core)) throw new RuntimeException(__('Core is not configured yet.', 'live2d-show'));
        $path = wzf_mascot_no_links($u['path'] . '/' . wzf_mascot_path($core['path'] ?? null));
        if (!is_file($path) || !is_readable($path) || filesize($path) < 1 || filesize($path) > 8 * 1024 * 1024) throw new RuntimeException(__('The Core file is missing or has an invalid size.', 'live2d-show'));
        $actual_hash = @hash_file('sha256', $path);
        if (!is_string($actual_hash) || ($core['sha256'] ?? null) !== WZF_MASCOT_CORE_SHA || !hash_equals(WZF_MASCOT_CORE_SHA, $actual_hash)) throw new RuntimeException(__('Core SHA256 does not match the required Web 5 R5 file.', 'live2d-show'));
        $report['core'] = ['ok'=>true,'message'=>__('The required Core file and SHA256 are valid.', 'live2d-show'),'bytes'=>filesize($path)];
    } catch (Throwable $e) { $report['core'] = ['ok'=>false,'message'=>wzf_mascot_error_message($e)]; }
    foreach ($config['characters'] as $id=>$c) {
        $row = ['id'=>(string)$id,'checks'=>[]];
        foreach (['runtime'=>__('Runtime references and file sizes', 'live2d-show'),'catalog'=>__('Catalog and motion configuration', 'live2d-show')] as $key=>$label) {
            try {
                if (!is_array($c)) throw new RuntimeException(__('Character configuration structure is invalid.', 'live2d-show'));
                if ($key === 'runtime') {
                    $files = wzf_mascot_character_runtime_files($c);
                    $row['fileCount'] = count($files); $row['bytes'] = array_sum($files);
                } else {
                    wzf_mascot_character_display_check($id, $c, wzf_mascot_uploads());
                    $catalog = wzf_mascot_character_catalog($c);
                    $row['motionCount'] = count($catalog);
                    $u = wzf_mascot_uploads();
                    $root = $u['path'] . '/' . wzf_mascot_path(rtrim($c['root'] ?? '', '/'));
                    $path = wzf_mascot_no_links($root . '/catalog.json');
                    $expressions = wzf_mascot_list(wzf_mascot_json(@file_get_contents($path))['expressions'] ?? null, 'Expressions');
                    $seen = [];
                    foreach ($expressions as $expression) {
                        $eid = wzf_mascot_plain_text($expression['id'] ?? null, 200, true);
                        $file = wzf_mascot_installed_reference($expression['file'] ?? null);
                        $epath = wzf_mascot_no_links($root . '/' . $file);
                        if (isset($seen[$eid]) || !str_ends_with($file, '.exp3.json') || !is_file($epath) || !is_readable($epath) || filesize($epath) > 8 * 1024 * 1024) throw new RuntimeException(__('The expression catalog contains duplicate, missing or invalid references.', 'live2d-show'));
                        wzf_mascot_json(@file_get_contents($epath)); $seen[$eid] = true;
                    }
                    $row['expressionCount'] = count($expressions);
                    wzf_mascot_plain_text($c['name'] ?? null, 200, true);
                    wzf_mascot_plain_text($c['credit'] ?? '', 300);
                    if (!in_array(wzf_mascot_character_status($c), ['active','disabled','trash'], true)) throw new RuntimeException(__('Character status is invalid.', 'live2d-show'));
                    if (!is_numeric($c['size'] ?? null) || !is_finite((float)$c['size']) || $c['size'] < 140 || $c['size'] > 260 || (float)$c['size'] != (int)$c['size'] || (int)$c['size'] % 10 !== 0 || !is_numeric($c['offset'] ?? null) || !is_finite((float)$c['offset']) || abs($c['offset']) > 100) throw new RuntimeException(__('Default layout configuration is invalid.', 'live2d-show'));
                    if (!is_string($c['idle'] ?? null) || !array_key_exists($c['idle'], $catalog)) throw new RuntimeException(__('The idle motion reference is invalid.', 'live2d-show'));
                    if (($c['welcome'] ?? null) !== null && (!is_string($c['welcome']) || !array_key_exists($c['welcome'], $catalog))) throw new RuntimeException(__('The welcome motion reference is invalid.', 'live2d-show'));
                    foreach (wzf_mascot_list($c['greetings'] ?? [], 'Greetings') as $motion) if (!is_string($motion) || !array_key_exists($motion, $catalog)) throw new RuntimeException(__('A greeting motion reference is invalid.', 'live2d-show'));
                }
                $row['checks'][$key] = ['ok'=>true,'message'=>sprintf(__('%s is valid.', 'live2d-show'), $label)];
            } catch (Throwable $e) { $row['checks'][$key] = ['ok'=>false,'message'=>wzf_mascot_error_message($e)]; }
        }
        $row['status'] = is_array($c) && is_string(wzf_mascot_character_status($c)) ? wzf_mascot_character_status($c) : 'invalid';
        if ($row['status'] === 'active') $report['activeCount']++;
        $report['characters'][] = $row;
    }
    try {
        wzf_mascot_presentation($config, wzf_mascot_uploads());
        $report['presentation'] = ['ok'=>true,'message'=>__('Terms configuration is valid.', 'live2d-show')];
    } catch (Throwable $e) { $report['presentation'] = ['ok'=>false,'message'=>wzf_mascot_error_message($e)]; }
    return $report;
}
function wzf_mascot_admin_diagnostics($config, $rows = null) {
    echo ('<section class="wzf-mascot-card"><h2>' . esc_html__('Frontend entry checks', 'live2d-show') . '</h2><p>' . esc_html__('Checks only character configuration types and model/catalog entry paths, readability and sizes. It does not read model references or textures, or hash Core. Display also requires valid shared Core and terms and reader opt-in; this is not visual or full resource validation.', 'live2d-show') . '</p>');
    $rows = $rows ?? wzf_mascot_display_report($config);
    $isolated = count(array_filter($rows, function($row) { return !$row['ok']; }));
    echo '<p>' . esc_html(sprintf(__('Checked %1$s characters; %2$s isolated.', 'live2d-show'), number_format_i18n(count($rows)), number_format_i18n($isolated))) . '</p><details' . ($isolated ? ' open' : '') . '><summary>' . esc_html__('View character entry status', 'live2d-show') . '</summary>';
    foreach ($rows as $row) echo '<p><strong>' . esc_html($row['id'] . ' · ' . $row['state']) . '</strong>: ' . esc_html($row['message']) . '</p>';
    echo '</details>';
    echo ('<p>' . esc_html__('Isolated characters retain their configuration, files and browser favorites/selection. Other valid characters remain available. Run the full diagnostics below and restore missing resources or a configuration backup; editable fields can be corrected in character settings. Invalid shared Core or terms prevents all frontend output.', 'live2d-show') . '</p></section>');
    echo ('<section class="wzf-mascot-card"><h2>' . esc_html__('Resource diagnostics', 'live2d-show') . '</h2><p class="description">' . esc_html__('Runs read-only checks of the Core hash, character runtime references, catalogs, layouts and terms. It does not save configuration or render models. Runtime byte totals exclude separately maintained catalog motions.', 'live2d-show') . '</p><form method="post" action="') . esc_url(admin_url('options-general.php?page=wzf-mascot')) . '">';
    wp_nonce_field('wzf_mascot_diagnostics');
    echo '<input type="hidden" name="mascot_diagnostics" value="1">'; submit_button(__('Check installed resources', 'live2d-show')); echo '</form>';
    if (($_POST['mascot_diagnostics'] ?? '') === '1') {
        check_admin_referer('wzf_mascot_diagnostics');
        $report = wzf_mascot_diagnose_resources($config);
        foreach (['configuration'=>__('Configuration', 'live2d-show'),'core'=>'Core','presentation'=>__('Terms', 'live2d-show')] as $key=>$label) if (isset($report[$key])) echo '<p><strong>' . esc_html($label . ' · ' . ($report[$key]['ok'] ? __('Valid', 'live2d-show') : __('Needs attention', 'live2d-show'))) . '</strong>: ' . esc_html($report[$key]['message']) . '</p>';
        if (isset($report['activeCount'])) echo '<p>' . esc_html(sprintf(__('Active frontend characters: %s. An invalid character entry isolates that character; invalid shared Core or terms prevents all output.', 'live2d-show'), number_format_i18n($report['activeCount']))) . '</p>';
        foreach ($report['characters'] ?? [] as $row) {
            $has_error = in_array(false, array_column($row['checks'], 'ok'), true);
            echo '<details class="wzf-mascot-diagnostic-row"><summary>' . esc_html($row['id'] . ' · ' . wzf_mascot_status_label($row['status']) . ' · ' . ($has_error ? __('Needs attention', 'live2d-show') : __('Valid', 'live2d-show'))) . '</summary>';
            foreach ($row['checks'] as $check) echo '<p>' . esc_html($check['ok'] ? __('Valid', 'live2d-show') : __('Needs attention', 'live2d-show')) . ': ' . esc_html($check['message']) . '</p>';
            if (isset($row['fileCount'])) echo '<p>' . esc_html(sprintf(__('Runtime references: %1$s files, %2$s KiB.', 'live2d-show'), number_format_i18n($row['fileCount']), number_format_i18n($row['bytes'] / 1024, 1))) . '</p>';
            echo '</details>';
        }
    }
    echo '</section>';
}
