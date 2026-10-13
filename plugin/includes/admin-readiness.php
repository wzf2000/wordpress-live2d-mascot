<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
function wzf_mascot_readiness_panel($config, $rows) {
    $core_ready = false; $terms_ready = false;
    try {
        if (!is_array($config) || !is_array($config['characters'] ?? null)) throw new RuntimeException('invalid');
        $uploads = wzf_mascot_uploads();
        $core = $config['core'] ?? [];
        $path = wzf_mascot_no_links($uploads['path'] . '/' . wzf_mascot_path($core['path'] ?? null));
        $core_ready = ($core['sha256'] ?? null) === WZF_MASCOT_CORE_SHA && is_file($path) && is_readable($path) && filesize($path) > 0 && filesize($path) <= 8 * 1024 * 1024;
    } catch (Throwable $e) {}
    try { if (is_array($config)) { wzf_mascot_presentation($config, wzf_mascot_uploads()); $terms_ready = true; } } catch (Throwable $e) {}
    $ready = count(array_filter($rows, function($row) use ($config) { return $row['ok'] && wzf_mascot_character_status($config['characters'][$row['id']]) === 'active'; }));
    echo '<div class="wzf-mascot-readiness"><h3>' . esc_html__('First-use readiness', 'live2d-show') . '</h3><ol><li>' . esc_html($core_ready ? __('Core entry is present. Run resource diagnostics to verify its hash.', 'live2d-show') : __('Import the exact Web 5 R5 Core file, or restore its missing file. Other versions cannot be substituted.', 'live2d-show')) . '</li><li>' . esc_html($ready ? sprintf(_n('%s active character entry passed.', '%s active character entries passed.', $ready, 'live2d-show'), number_format_i18n($ready)) : __('Import one model, enable a character, or repair isolated entries using resource diagnostics. Existing files and preferences are retained.', 'live2d-show')) . '</li><li>' . esc_html($terms_ready ? __('Check resource credits and terms, then use the frontend “Show mascot” button and accept the terms in each browser.', 'live2d-show') : __('Restore the configured site terms file or its configuration backup. Shared terms failures prevent all frontend output.', 'live2d-show')) . '</li></ol><p>' . esc_html__('This entry check does not render models. Mobile remains off by default; reduced motion and account display preferences still apply.', 'live2d-show') . '</p></div>';
    if (!is_array($config) || !is_array($config['characters'] ?? null)) echo '<p>' . esc_html__('Resource configuration is damaged. Restore a configuration backup before importing; opening this page does not repair or overwrite data.', 'live2d-show') . '</p>';
}
