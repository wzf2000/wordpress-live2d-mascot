<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;

function wzf_mascot_config_version($config) {
    return hash('sha256', serialize($config));
}
function wzf_mascot_plain_text($value, $limit, $required = false) {
    if (!is_string($value) || strlen($value) > $limit || ($required && trim($value) === '') || strip_tags($value) !== $value || preg_match('/[\x00-\x1f\x7f]/', $value)) throw new RuntimeException('名称或署名必须是有效纯文本。');
    return $value;
}
// Read the installed catalog, including IDs maintained by older installations.
// Installed catalogs may include separately maintained motions outside model3.
function wzf_mascot_character_catalog($character) {
    if (!is_array($character)) throw new RuntimeException('角色配置无效。');
    $u = wzf_mascot_uploads();
    $root = wzf_mascot_no_links($u['path'] . '/' . wzf_mascot_path(rtrim($character['root'] ?? '', '/')));
    $read = function($relative) use ($root) {
        $path = wzf_mascot_no_links($root . '/' . wzf_mascot_path($relative));
        if (!is_file($path) || !is_readable($path) || filesize($path) > 8 * 1024 * 1024) throw new RuntimeException('角色目录或模型文件不可用。');
        $raw = @file_get_contents($path);
        if ($raw === false) throw new RuntimeException('不能读取角色目录。');
        return wzf_mascot_json($raw);
    };
    $read($character['file'] ?? null);
    $catalog = $read('catalog.json');
    $motions = wzf_mascot_list($catalog['motions'] ?? null, 'Motions');
    if (!$motions || count($motions) > 1000) throw new RuntimeException('角色动作目录为空或过大。');
    $result = [];
    foreach ($motions as $item) {
        if (!is_array($item)) throw new RuntimeException('动作目录条目无效。');
        $id = wzf_mascot_plain_text($item['id'] ?? null, 200, true);
        $file = wzf_mascot_path($item['file'] ?? null);
        if (array_key_exists($id, $result) || !str_ends_with($file, '.motion3.json')) throw new RuntimeException('动作目录包含重复 ID 或无效文件引用。');
        $motion = $read($file);
        if (($motion['Version'] ?? null) !== 3) throw new RuntimeException('动作文件必须是 Version 3 JSON。');
        $result[$id] = ['file'=>$file, 'label'=>is_string($item['label'] ?? null) ? $item['label'] : (string)$id];
    }
    return $result;
}
function wzf_mascot_character_motions($character) {
    return array_map(function($motion) { return $motion['label']; }, wzf_mascot_character_catalog($character));
}
// Read-only runtime reference checks, also usable by administrator diagnostics.
function wzf_mascot_character_runtime_files($character) {
    $u = wzf_mascot_uploads();
    $root = wzf_mascot_no_links($u['path'] . '/' . wzf_mascot_path(rtrim($character['root'] ?? '', '/')));
    $files = [];
    $take = function($name, $suffix, $limit = 8 * 1024 * 1024) use ($root, &$files) {
        $name = wzf_mascot_path($name);
        $path = wzf_mascot_no_links($root . '/' . $name);
        if (!str_ends_with($name, $suffix) || !is_file($path) || !is_readable($path) || filesize($path) < 1 || filesize($path) > $limit) throw new RuntimeException('模型运行引用缺失、越界或大小无效。');
        $files[$name] = filesize($path);
        return $path;
    };
    $model = wzf_mascot_json(@file_get_contents($take($character['file'] ?? null, '.model3.json')));
    $refs = $model['FileReferences'] ?? null;
    if (($model['Version'] ?? null) !== 3 || !is_array($refs)) throw new RuntimeException('模型运行配置无效。');
    $take($refs['Moc'] ?? null, '.moc3', 64 * 1024 * 1024);
    $textures = wzf_mascot_list($refs['Textures'] ?? null, 'Textures');
    if (!$textures || count($textures) > 16) throw new RuntimeException('模型贴图引用无效。');
    foreach ($textures as $name) $take($name, '.png', 32 * 1024 * 1024);
    foreach (['Physics','Pose','UserData','DisplayInfo'] as $key) if (isset($refs[$key])) $take($refs[$key], '.json');
    $groups = $refs['Motions'] ?? [];
    if (!is_array($groups)) throw new RuntimeException('模型动作引用无效。');
    foreach ($groups as $items) foreach (wzf_mascot_list($items, 'Motion group') as $motion) $take($motion['File'] ?? null, '.motion3.json');
    foreach (wzf_mascot_list($refs['Expressions'] ?? [], 'Expressions') as $expression) $take($expression['File'] ?? null, '.exp3.json');
    return $files;
}
require_once __DIR__ . '/admin-lifecycle.php';
require_once __DIR__ . '/admin-diagnostics.php';
require_once __DIR__ . '/admin-thumbnail.php';
require_once __DIR__ . '/admin-mobile.php';
function wzf_mascot_save_character($id, $version, $fields) {
    if (!current_user_can('manage_options')) throw new RuntimeException('需要管理员权限。');
    if (!is_string($id) || !is_string($version) || !preg_match('/\A[0-9a-f]{64}\z/D', $version) || !is_array($fields) || array_diff(array_keys($fields), ['name','credit','size','offset','idle','welcome','greetings'])) throw new RuntimeException('角色设置请求无效。');
    $token = bin2hex(random_bytes(16));
    if (!add_option(WZF_MASCOT_LOCK, ['token'=>$token,'started'=>time()], '', false)) throw new RuntimeException('已有资源或设置任务正在进行，请稍后重试。');
    try {
        $config = get_option(WZF_MASCOT_OPTION, []);
        if (!hash_equals(wzf_mascot_config_version($config), $version)) throw new RuntimeException('资源配置已被其他请求修改，请刷新页面后重新编辑。');
        if (!is_array($config) || !is_array($config['characters'] ?? null) || !array_key_exists($id, $config['characters']) || !is_array($config['characters'][$id])) throw new RuntimeException('角色不存在或配置无效。');
        $character = $config['characters'][$id];
        $motions = wzf_mascot_character_motions($character);
        $patch = ['name'=>trim(wzf_mascot_plain_text($fields['name'] ?? null, 200, true)), 'credit'=>wzf_mascot_plain_text($fields['credit'] ?? null, 300)];
        foreach (['size'=>[140,260], 'offset'=>[-100,100]] as $key=>$range) {
            $value = $fields[$key] ?? null;
            if ((!is_string($value) && !is_int($value) && !is_float($value)) || !is_numeric($value)) throw new RuntimeException('大小或偏移必须是有效数字。');
            $number = (float)$value;
            if (!is_finite($number) || $number < $range[0] || $number > $range[1] || ($key === 'size' && ($number != (int)$number || (int)$number % 10 !== 0))) throw new RuntimeException('大小须为 140–260 像素（步长 10），偏移须为 -100–100%。');
            $patch[$key] = $key === 'size' ? (int)$number : $number;
        }
        foreach (['idle','welcome'] as $key) {
            $value = $fields[$key] ?? null;
            if ($key === 'welcome' && ($value === '' || $value === null)) $patch[$key] = null;
            elseif (!is_string($value) || !array_key_exists($value, $motions)) throw new RuntimeException('待机或欢迎动作不在当前角色目录中。');
            else $patch[$key] = $value;
        }
        $greetings = wzf_mascot_list($fields['greetings'] ?? null, 'Greetings');
        if (count($greetings) > count($motions)) throw new RuntimeException('招呼动作数量无效。');
        foreach ($greetings as $motion) if (!is_string($motion) || !array_key_exists($motion, $motions)) throw new RuntimeException('招呼动作不在当前角色目录中。');
        if (count(array_unique($greetings)) !== count($greetings)) throw new RuntimeException('招呼动作不能重复。');
        // Keep the existing rotation order; append newly selected motions.
        $ordered = [];
        foreach (is_array($character['greetings'] ?? null) ? $character['greetings'] : [] as $motion) {
            if (is_string($motion) && in_array($motion, $greetings, true) && !in_array($motion, $ordered, true)) $ordered[] = $motion;
        }
        foreach ($greetings as $motion) if (!in_array($motion, $ordered, true)) $ordered[] = $motion;
        $patch['greetings'] = $ordered;
        // Preserve every unexposed field, including paths, terms anchors and rendering options.
        $next = array_replace($character, $patch);
        if ($next == $character) return;
        $config['characters'][$id] = $next;
        if (!update_option(WZF_MASCOT_OPTION, $config, false)) throw new RuntimeException('角色设置保存失败。');
    } finally {
        $lock = get_option(WZF_MASCOT_LOCK);
        if (is_array($lock) && ($lock['token'] ?? null) === $token) delete_option(WZF_MASCOT_LOCK);
    }
}
function wzf_mascot_settings_post() {
    if (!current_user_can('manage_options')) wp_die('需要管理员权限。', '', ['response'=>403]);
    check_admin_referer('wzf_mascot_settings');
    $id = isset($_POST['character']) && is_string($_POST['character']) ? wp_unslash($_POST['character']) : '';
    try {
        $version = isset($_POST['version']) && is_string($_POST['version']) ? wp_unslash($_POST['version']) : '';
        $fields = [];
        foreach (['name','credit','size','offset','idle','welcome'] as $key) {
            if (!isset($_POST[$key]) || !is_string($_POST[$key])) throw new RuntimeException('角色设置请求无效。');
            $fields[$key] = wp_unslash($_POST[$key]);
        }
        $fields['greetings'] = isset($_POST['greetings']) && is_array($_POST['greetings']) ? wp_unslash($_POST['greetings']) : [];
        if (isset($_POST['greetings']) && !is_array($_POST['greetings'])) throw new RuntimeException('招呼动作请求无效。');
        wzf_mascot_save_character($id, $version, $fields);
        $notice = '角色设置已保存。';
    } catch (Throwable $e) { $notice = $e->getMessage(); }
    wp_safe_redirect(add_query_arg(['mascot_notice'=>rawurlencode($notice), 'character'=>$id], admin_url('options-general.php?page=wzf-mascot')));
    exit;
}
function wzf_mascot_admin_styles($hook) {
    if (!in_array($hook, ['settings_page_wzf-mascot','profile.php','user-edit.php'], true)) return;
    wp_enqueue_style('wzf-mascot-admin', plugins_url('admin.css', dirname(__DIR__) . '/live2d-show.php'), [], '3.6.0');
}
function wzf_mascot_motion_select($key, $label, $motions, $value, $optional = false) {
    echo '<div class="wzf-mascot-field"><label for="mascot-' . esc_attr($key) . '">' . esc_html($label) . '</label><select id="mascot-' . esc_attr($key) . '" name="' . esc_attr($key) . '">';
    if ($optional) echo '<option value="">不自动播放欢迎动作</option>';
    if ($value !== null && $value !== '' && !array_key_exists($value, $motions)) echo '<option value="' . esc_attr($value) . '" selected>当前引用无效，请重新选择</option>';
    foreach ($motions as $id=>$text) echo '<option value="' . esc_attr($id) . '" ' . selected((string)$value, (string)$id, false) . '>' . esc_html($text . ' · ' . $id) . '</option>';
    echo '</select></div>';
}
function wzf_mascot_character_editor($config, $id) {
    $character = $config['characters'][$id];
    echo '<section class="wzf-mascot-card" aria-labelledby="mascot-edit-title"><h2 id="mascot-edit-title">角色设置 · ' . esc_html($character['name'] ?? $id) . '</h2><p class="description">修改显示信息和动作引用；模型文件保持原位。大小为浏览器布局默认值，读者已有的本地大小偏好优先。</p>';
    try { $motions = wzf_mascot_character_motions($character); }
    catch (Throwable $e) { echo '<div class="notice notice-error inline"><p>' . esc_html($e->getMessage()) . ' 请检查已安装资源后重试。</p></div></section>'; return; }
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    wp_nonce_field('wzf_mascot_settings');
    echo '<input type="hidden" name="action" value="wzf_mascot_settings"><input type="hidden" name="character" value="' . esc_attr($id) . '"><input type="hidden" name="version" value="' . esc_attr(wzf_mascot_config_version($config)) . '"><div class="wzf-mascot-fields">';
    foreach (['name'=>['角色名称', $character['name'] ?? '', 'text', 'required'], 'credit'=>['署名／来源', $character['credit'] ?? '', 'text', ''], 'size'=>['默认大小（像素）', $character['size'] ?? 180, 'number', 'min="140" max="260" step="10" required'], 'offset'=>['垂直偏移（%）', $character['offset'] ?? 0, 'number', 'min="-100" max="100" step="any" required']] as $key=>$field) {
        echo '<div class="wzf-mascot-field"><label for="mascot-' . esc_attr($key) . '">' . esc_html($field[0]) . '</label><input id="mascot-' . esc_attr($key) . '" name="' . esc_attr($key) . '" type="' . $field[2] . '" value="' . esc_attr($field[1]) . '" ' . $field[3] . '></div>';
    }
    wzf_mascot_motion_select('idle', '待机动作（循环）', $motions, $character['idle'] ?? '');
    wzf_mascot_motion_select('welcome', '欢迎动作（首次显示时播放）', $motions, $character['welcome'] ?? null, true);
    echo '</div><fieldset class="wzf-mascot-greetings"><legend>招呼动作</legend><p class="description">点击前台“打招呼”时依次播放已选动作；原有动作顺序保留，新选动作追加；不勾选则关闭此入口。欢迎动作仍遵循首次显示、阅读暂停和手动操作规则。</p><div class="wzf-mascot-checks">';
    foreach ($motions as $motion=>$label) echo '<label><input type="checkbox" name="greetings[]" value="' . esc_attr($motion) . '" ' . checked(in_array((string)$motion, $character['greetings'] ?? [], true), true, false) . '> ' . esc_html($label . ' · ' . $motion) . '</label>';
    echo '</div></fieldset>';
    submit_button('保存角色设置');
    echo '</form></section>';
}
function wzf_mascot_admin_page() {
    if (!current_user_can('manage_options')) return;
    $raw = get_option(WZF_MASCOT_OPTION, ['characters'=>[]]);
    $config = is_array($raw) ? $raw : [];
    $characters = is_array($config['characters'] ?? null) ? $config['characters'] : [];
    echo '<div class="wrap wzf-mascot-admin"><h1>WordPress Live2D Mascot</h1><p class="wzf-mascot-intro">管理资源与角色，让读者按自己的习惯使用看板娘。</p>';
    if (isset($_GET['mascot_notice']) && is_string($_GET['mascot_notice'])) echo '<div class="notice notice-info"><p>' . esc_html(wp_unslash($_GET['mascot_notice'])) . '</p></div>';
    echo '<div class="wzf-mascot-status"><div><span>Core 资源</span><strong>' . (!empty($config['core']) ? '已配置 · Web 5 R5' : '尚未导入') . '</strong></div><div><span>已配置角色</span><strong>' . count($characters) . ' 位</strong></div><div><span>前台显示</span><strong>读者自行开启</strong></div></div>';
    echo '<section class="wzf-mascot-card"><h2>角色管理</h2><p class="description">选择角色编辑名称、署名、默认布局与动作。升级插件保留 uploads 中的资源和浏览器偏好。</p>';
    if (!$characters) echo '<p>暂无角色。请先导入 Core 和一个模型，再配置角色。</p>';
    else {
        echo '<div class="wzf-mascot-table"><table class="widefat striped"><thead><tr><th scope="col">角色</th><th scope="col">署名／来源</th><th scope="col">管理</th></tr></thead><tbody>';
        foreach ($characters as $id=>$c) {
            if (!is_array($c)) continue;
            echo '<tr><th scope="row">';
            wzf_mascot_admin_thumbnail($c);
            echo '<strong>' . esc_html($c['name'] ?? $id) . '</strong> · ' . esc_html(['active'=>'启用','disabled'=>'停用','trash'=>'回收站'][wzf_mascot_character_status($c)] ?? '状态无效') . '<br><code>' . esc_html($id) . '</code></th><td>' . esc_html($c['credit'] ?? '') . '</td><td><a class="button" aria-label="' . esc_attr('编辑角色 ' . ($c['name'] ?? $id)) . '" href="' . esc_url(add_query_arg('character', $id, admin_url('options-general.php?page=wzf-mascot'))) . '#mascot-edit-title">编辑</a></td></tr>';
        }
        echo '</tbody></table></div>';
    }
    echo '</section>';
    $selected = isset($_GET['character']) && is_string($_GET['character']) ? wp_unslash($_GET['character']) : '';
    if ($selected !== '' && isset($characters[$selected]) && is_array($characters[$selected])) {
        wzf_mascot_character_management($config, $selected);
        wzf_mascot_thumbnail_panel($config, $selected);
        if (wzf_mascot_character_status($characters[$selected]) !== 'trash') wzf_mascot_character_editor($config, $selected);
    }
    elseif ($selected !== '') echo '<div class="notice notice-error inline"><p>角色不存在，请从列表重新选择。</p></div>';
    echo '<section class="wzf-mascot-card"><h2>资源准备</h2><p>插件不附带 Core 或模型。请自行取得有权在本站使用的资源，阅读来源许可与使用条件；导入成功不代表取得再分发许可。</p><p><a href="https://www.live2d.com/en/sdk/download/web/" target="_blank" rel="noopener">Cubism SDK for Web 官方下载</a> · <a href="https://www.live2d.com/en/learn/sample/" target="_blank" rel="noopener">官方样例</a></p><p class="description">Core 仅接受固定 Web 5 R5 SHA256。模型 ZIP 限 64 MiB、1000 项；仅含单个 model3 的运行文件，不含声音、脚本或编辑工程。至少保留一个动作，默认待机优先取 Idle 组第一个动作；导入后可在角色设置中调整。</p></section><div class="wzf-mascot-imports">';
    foreach (['core'=>'导入 Core JS', 'model'=>'导入模型 ZIP'] as $kind=>$label) {
        echo '<section class="wzf-mascot-card"><h2>' . esc_html($label) . '</h2><form method="post" enctype="multipart/form-data" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('wzf_mascot_import');
        echo '<input type="hidden" name="action" value="wzf_mascot_import"><input type="hidden" name="kind" value="' . esc_attr($kind) . '"><div class="wzf-mascot-field"><label for="mascot-upload-' . $kind . '">资源文件</label><input id="mascot-upload-' . $kind . '" type="file" name="resource" required accept="' . ($kind === 'core' ? '.js' : '.zip') . '"></div>';
        if ($kind === 'model') echo '<div class="wzf-mascot-field"><label for="mascot-new-id">角色 ID</label><input id="mascot-new-id" name="id" required pattern="[a-z][a-z0-9-]{0,63}" maxlength="64"><p class="description">小写字母开头，使用字母、数字或短横线；已有 ID 不覆盖。</p></div><div class="wzf-mascot-field"><label for="mascot-new-name">角色名称</label><input id="mascot-new-name" name="name" required></div><div class="wzf-mascot-field"><label for="mascot-new-credit">署名／来源</label><input id="mascot-new-credit" name="credit"></div>';
        echo '<p><label><input type="checkbox" name="rights" value="1" required> 我有权在本站使用资源，并已阅读其来源许可与使用条件。</label></p>';
        submit_button($label); echo '</form></section>';
    }
    echo '</div>';
    wzf_mascot_mobile_panel($config);
    wzf_mascot_admin_diagnostics($config);
    echo '</div>';
}
add_action('admin_post_wzf_mascot_settings', 'wzf_mascot_settings_post');
add_action('admin_enqueue_scripts', 'wzf_mascot_admin_styles');
