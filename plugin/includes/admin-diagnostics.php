<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
// Validate diagnostic POSTs before WordPress emits the admin header.
function wzf_mascot_diagnostics_gate() {
    if (($_GET['page'] ?? null) !== 'wzf-mascot' || !isset($_POST['mascot_diagnostics'])) return;
    if (!current_user_can('manage_options')) wp_die('需要管理员权限。', '', ['response'=>403]);
    check_admin_referer('wzf_mascot_diagnostics');
}
add_action('admin_init', 'wzf_mascot_diagnostics_gate');
function wzf_mascot_diagnose_resources($config) {
    if (!current_user_can('manage_options')) throw new RuntimeException('需要管理员权限。');
    $report = ['core'=>[], 'characters'=>[], 'presentation'=>[], 'activeCount'=>0];
    if (!is_array($config) || !is_array($config['characters'] ?? null)) return ['configuration'=>['ok'=>false,'message'=>'资源配置结构无效。']];
    try {
        $u = wzf_mascot_uploads();
        $core = $config['core'] ?? null;
        if (!is_array($core)) throw new RuntimeException('Core 尚未配置。');
        $path = wzf_mascot_no_links($u['path'] . '/' . wzf_mascot_path($core['path'] ?? null));
        if (!is_file($path) || !is_readable($path) || filesize($path) < 1 || filesize($path) > 8 * 1024 * 1024) throw new RuntimeException('Core 文件缺失或大小无效。');
        $actual_hash = @hash_file('sha256', $path);
        if (!is_string($actual_hash) || ($core['sha256'] ?? null) !== WZF_MASCOT_CORE_SHA || !hash_equals(WZF_MASCOT_CORE_SHA, $actual_hash)) throw new RuntimeException('Core SHA256 不匹配固定 Web 5 R5。');
        $report['core'] = ['ok'=>true,'message'=>'固定 Core 文件和 SHA256 正常。','bytes'=>filesize($path)];
    } catch (Throwable $e) { $report['core'] = ['ok'=>false,'message'=>$e->getMessage()]; }
    foreach ($config['characters'] as $id=>$c) {
        $row = ['id'=>(string)$id,'checks'=>[]];
        foreach (['runtime'=>'运行引用与文件大小','catalog'=>'目录与动作配置'] as $key=>$label) {
            try {
                if (!is_array($c)) throw new RuntimeException('角色配置结构无效。');
                if ($key === 'runtime') {
                    $files = wzf_mascot_character_runtime_files($c);
                    $row['fileCount'] = count($files); $row['bytes'] = array_sum($files);
                } else {
                    $catalog = wzf_mascot_character_catalog($c);
                    $row['motionCount'] = count($catalog);
                    $u = wzf_mascot_uploads();
                    $root = $u['path'] . '/' . wzf_mascot_path(rtrim($c['root'] ?? '', '/'));
                    $path = wzf_mascot_no_links($root . '/catalog.json');
                    $expressions = wzf_mascot_list(wzf_mascot_json(@file_get_contents($path))['expressions'] ?? null, 'Expressions');
                    $seen = [];
                    foreach ($expressions as $expression) {
                        $eid = wzf_mascot_plain_text($expression['id'] ?? null, 200, true);
                        $file = wzf_mascot_path($expression['file'] ?? null);
                        $epath = wzf_mascot_no_links($root . '/' . $file);
                        if (isset($seen[$eid]) || !str_ends_with($file, '.exp3.json') || !is_file($epath) || !is_readable($epath) || filesize($epath) > 8 * 1024 * 1024) throw new RuntimeException('表情目录含重复、缺失或无效引用。');
                        wzf_mascot_json(@file_get_contents($epath)); $seen[$eid] = true;
                    }
                    $row['expressionCount'] = count($expressions);
                    wzf_mascot_plain_text($c['name'] ?? null, 200, true);
                    wzf_mascot_plain_text($c['credit'] ?? '', 300);
                    if (!in_array(wzf_mascot_character_status($c), ['active','disabled','trash'], true)) throw new RuntimeException('角色状态无效。');
                    if (!is_numeric($c['size'] ?? null) || !is_finite((float)$c['size']) || $c['size'] < 140 || $c['size'] > 260 || (float)$c['size'] != (int)$c['size'] || (int)$c['size'] % 10 !== 0 || !is_numeric($c['offset'] ?? null) || !is_finite((float)$c['offset']) || abs($c['offset']) > 100) throw new RuntimeException('默认布局配置无效。');
                    if (!is_string($c['idle'] ?? null) || !array_key_exists($c['idle'], $catalog)) throw new RuntimeException('待机动作引用无效。');
                    if (($c['welcome'] ?? null) !== null && (!is_string($c['welcome']) || !array_key_exists($c['welcome'], $catalog))) throw new RuntimeException('欢迎动作引用无效。');
                    foreach (wzf_mascot_list($c['greetings'] ?? [], 'Greetings') as $motion) if (!is_string($motion) || !array_key_exists($motion, $catalog)) throw new RuntimeException('招呼动作引用无效。');
                }
                $row['checks'][$key] = ['ok'=>true,'message'=>$label . '正常。'];
            } catch (Throwable $e) { $row['checks'][$key] = ['ok'=>false,'message'=>$e->getMessage()]; }
        }
        $row['status'] = is_array($c) ? wzf_mascot_character_status($c) : 'invalid';
        if ($row['status'] === 'active') $report['activeCount']++;
        $report['characters'][] = $row;
    }
    try {
        wzf_mascot_presentation($config, wzf_mascot_uploads());
        $report['presentation'] = ['ok'=>true,'message'=>'条款配置正常。'];
    } catch (Throwable $e) { $report['presentation'] = ['ok'=>false,'message'=>$e->getMessage()]; }
    return $report;
}
function wzf_mascot_admin_diagnostics($config) {
    echo '<section class="wzf-mascot-card"><h2>资源诊断</h2><p class="description">点击后只读检查 Core 哈希、角色运行引用、目录、布局和条款配置。不会写入配置或加载模型画面；运行文件总大小不含目录中的额外维护动作。</p><form method="post" action="' . esc_url(admin_url('options-general.php?page=wzf-mascot')) . '">';
    wp_nonce_field('wzf_mascot_diagnostics');
    echo '<input type="hidden" name="mascot_diagnostics" value="1">'; submit_button('检查已安装资源'); echo '</form>';
    if (($_POST['mascot_diagnostics'] ?? '') === '1') {
        check_admin_referer('wzf_mascot_diagnostics');
        $report = wzf_mascot_diagnose_resources($config);
        foreach (['configuration'=>'配置','core'=>'Core','presentation'=>'条款'] as $key=>$label) if (isset($report[$key])) echo '<p><strong>' . esc_html($label) . ' · ' . ($report[$key]['ok'] ? '正常' : '需处理') . '</strong>：' . esc_html($report[$key]['message']) . '</p>';
        if (isset($report['activeCount'])) echo '<p>前台启用角色：' . (int)$report['activeCount'] . ' 位。任一启用角色的配置或文件失效可能导致前台停止输出。</p>';
        foreach ($report['characters'] ?? [] as $row) {
            $has_error = in_array(false, array_column($row['checks'], 'ok'), true);
            echo '<details class="wzf-mascot-diagnostic-row"><summary>' . esc_html($row['id'] . ' · ' . $row['status'] . ' · ' . ($has_error ? '需处理' : '正常')) . '</summary>';
            foreach ($row['checks'] as $check) echo '<p>' . ($check['ok'] ? '正常' : '需处理') . '：' . esc_html($check['message']) . '</p>';
            if (isset($row['fileCount'])) echo '<p>运行引用：' . (int)$row['fileCount'] . ' 个文件，' . esc_html(number_format($row['bytes'] / 1024, 1)) . ' KiB。</p>';
            echo '</details>';
        }
    }
    echo '</section>';
}
