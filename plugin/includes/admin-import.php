<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
const WZF_MASCOT_CORE_SHA = '8741f739779b5d5210872bd3d7d99f0f1e56e6c87409e7d26d6bb4b80aa1ef47';
const WZF_MASCOT_OPTION = 'wzf_mascot_resources_v1';
const WZF_MASCOT_LOCK = 'wzf_mascot_import_lock_v1';
function wzf_mascot_path($name) {
    if (!is_string($name) || !preg_match('~\A[A-Za-z0-9_.\-/]+\z~D', $name) || $name[0] === '/' || strpos($name, '//') !== false) throw new RuntimeException('资源路径无效。');
    foreach (explode('/', $name) as $part) if ($part === '' || $part === '.' || $part === '..' || preg_match('/(?:^|\.)(?:php[0-9]*|phtml|phar|cgi|pl|py|sh|asp|aspx)(?:\.|$)/i', $part)) throw new RuntimeException('资源路径越界。');
    return $name;
}
function wzf_mascot_no_links($path) {
    $cursor = $path;
    while ($cursor !== dirname($cursor)) {
        if (is_link($cursor)) throw new RuntimeException('资源路径不能使用软链接。');
        $cursor = dirname($cursor);
    }
    return $path;
}
function wzf_mascot_uploads($create = false) {
    $u = wp_upload_dir(null, $create);
    if (!empty($u['error'])) throw new RuntimeException('上传目录不可用。');
    $base = wzf_mascot_no_links(rtrim($u['basedir'], '/') . '/wzf-mascot');
    if ($create) {
        if (!is_dir($base) && !wp_mkdir_p($base)) throw new RuntimeException('不能建立资源目录。');
        $guards = ['index.html'=>'', '.htaccess'=>"Options -Indexes\n<FilesMatch \"\\.(php[0-9]*|phtml|phar|cgi|pl|py|sh|asp|aspx)(\\.|$)\">\nRequire all denied\n</FilesMatch>\n", 'web.config'=>'<configuration><system.webServer><directoryBrowse enabled="false"/><security><requestFiltering><fileExtensions><add fileExtension=".php" allowed="false"/><add fileExtension=".phtml" allowed="false"/><add fileExtension=".phar" allowed="false"/></fileExtensions></requestFiltering></security></system.webServer></configuration>'];
        foreach ($guards as $name=>$bytes) {
            $path = wzf_mascot_no_links($base . '/' . $name);
            if (!file_exists($path) && file_put_contents($path, $bytes, LOCK_EX) !== strlen($bytes)) throw new RuntimeException('不能写入目录保护文件。');
        }
    }
    return ['path'=>$base, 'url'=>rtrim($u['baseurl'], '/') . '/wzf-mascot/'];
}
function wzf_mascot_json($raw) {
    if (strlen($raw) > 8 * 1024 * 1024) throw new RuntimeException('JSON 文件过大。');
    $v = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($v) || !str_starts_with(ltrim($raw), '{')) throw new RuntimeException('JSON 必须是对象。');
    return $v;
}
function wzf_mascot_list($value, $label) {
    if (!is_array($value) || !array_is_list($value)) throw new RuntimeException($label . ' 必须是数组。');
    return $value;
}
function wzf_mascot_model_zip($path) {
    if (!class_exists('ZipArchive')) throw new RuntimeException('服务器需要 PHP ZipArchive。');
    if (filesize($path) > 64 * 1024 * 1024) throw new RuntimeException('ZIP 不能超过 64 MiB。');
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::RDONLY) !== true) throw new RuntimeException('ZIP 无效。');
    try {
        if ($zip->numFiles < 1 || $zip->numFiles > 1000) throw new RuntimeException('ZIP 文件数量超限。');
        $files = []; $names = []; $total = 0; $actual_total = 0; $models = [];
        for ($i=0; $i<$zip->numFiles; $i++) {
            $s = $zip->statIndex($i);
            if (!$s || !empty($s['encryption_method'])) throw new RuntimeException('不支持加密 ZIP。');
            $dir = str_ends_with($s['name'], '/');
            $name = wzf_mascot_path($dir ? substr($s['name'], 0, -1) : $s['name']);
            $key = strtolower($name);
            if (isset($names[$key])) throw new RuntimeException('ZIP 有重复路径。');
            $names[$key] = true;
            $zip->getExternalAttributesIndex($i, $opsys, $attr);
            $mode = ($attr >> 16) & 0170000;
            if ($opsys === 3 && $mode !== 0 && $mode !== ($dir ? 0040000 : 0100000)) throw new RuntimeException('ZIP 不能包含软链接或特殊文件。');
            if ($dir) continue;
            if (!preg_match('~\.(moc3|png|model3\.json|motion3\.json|exp3\.json|physics3\.json|pose3\.json|userdata3\.json|cdi3\.json)$~i', $name) && !str_ends_with($name, '/catalog.json') && $name !== 'catalog.json') throw new RuntimeException('ZIP 含非运行资源，请只上传单个模型导出的运行文件。');
            if ($s['size'] > 64 * 1024 * 1024 || ($s['size'] > 1024 * 1024 && $s['size'] > max(1, $s['comp_size']) * 1000)) throw new RuntimeException('ZIP 文件过大或压缩比异常。');
            $total += $s['size'];
            if ($total > 64 * 1024 * 1024) throw new RuntimeException('ZIP 解压总大小超过 64 MiB。');
            $raw = $zip->getFromIndex($i, min($s['size'] + 1, 64 * 1024 * 1024 + 1));
            if ($raw === false || strlen($raw) !== $s['size']) throw new RuntimeException('ZIP 文件读取失败。');
            $actual_total += strlen($raw);
            if ($actual_total > 64 * 1024 * 1024) throw new RuntimeException('实际解压大小超限。');
            if (str_ends_with($name, '.json')) wzf_mascot_json($raw);
            $files[$name] = $raw;
            if (str_ends_with($name, '.model3.json')) $models[] = $name;
        }
        if (count($models) !== 1) throw new RuntimeException('ZIP 必须且只能包含一个 model3.json。');
        $model_name = $models[0]; $prefix = dirname($model_name); $prefix = $prefix === '.' ? '' : $prefix . '/';
        $model = wzf_mascot_json($files[$model_name]);
        if (($model['Version'] ?? null) !== 3 || !isset($model['FileReferences']) || !is_array($model['FileReferences'])) throw new RuntimeException('需要 Version 3 的 Cubism 运行模型。');
        $refs = $model['FileReferences'];
        if (array_diff(array_keys($refs), ['Moc','Textures','Physics','Pose','UserData','DisplayInfo','Motions','Expressions'])) throw new RuntimeException('存在不支持的模型引用类型。');
        $selected = [basename($model_name)=>$files[$model_name]];
        $take = function($relative, $suffix) use ($prefix, $files, &$selected) {
            $relative = wzf_mascot_path($relative);
            if (!str_ends_with($relative, $suffix) || !array_key_exists($prefix . $relative, $files)) throw new RuntimeException('模型引用缺失或格式错误。');
            $selected[$relative] = $files[$prefix . $relative];
            return $selected[$relative];
        };
        $moc = $take($refs['Moc'] ?? null, '.moc3');
        if (substr($moc, 0, 4) !== 'MOC3') throw new RuntimeException('MOC3 头无效。');
        $textures = wzf_mascot_list($refs['Textures'] ?? null, 'Textures');
        if (!$textures || count($textures) > 16) throw new RuntimeException('需要 1–16 张贴图。');
        foreach ($textures as $name) {
            $raw = $take($name, '.png');
            $image = @getimagesizefromstring($raw);
            if (strlen($raw) > 32 * 1024 * 1024 || !$image || $image[2] !== IMAGETYPE_PNG || $image[0] > 8192 || $image[1] > 8192) throw new RuntimeException('PNG 贴图无效或过大。');
        }
        foreach (['Physics','Pose','UserData','DisplayInfo'] as $field) if (isset($refs[$field])) $take($refs[$field], '.json');
        $motions = []; $expressions = []; $idle = null;
        $groups = $refs['Motions'] ?? [];
        if (!is_array($groups)) throw new RuntimeException('Motions 无效。');
        foreach ($groups as $group=>$items) foreach (wzf_mascot_list($items, 'Motion group') as $item) {
            if (!is_array($item) || isset($item['Sound'])) throw new RuntimeException('不支持声音引用。');
            $take($item['File'] ?? null, '.motion3.json');
            $id = 'motion-' . (count($motions) + 1);
            $motions[] = ['id'=>$id,'file'=>$item['File'],'label'=>(string)$group . ' ' . (count($motions) + 1)];
            if ($idle === null) $idle = $id;
        }
        if (!$motions) throw new RuntimeException('模型至少需要一个合法动作，供待机使用。');
        // Deterministically prefer the first Idle entry, never the last one.
        $index = 0;
        foreach ($groups as $group=>$items) {
            if (strtolower((string)$group) === 'idle' && count($items)) { $idle = 'motion-' . ($index + 1); break; }
            $index += count($items);
        }
        foreach (wzf_mascot_list($refs['Expressions'] ?? [], 'Expressions') as $item) {
            if (!is_array($item) || !is_string($item['Name'] ?? null) || strlen($item['Name']) > 200) throw new RuntimeException('Expression 无效。');
            $take($item['File'] ?? null, '.exp3.json');
            $expressions[] = ['id'=>'expression-' . (count($expressions) + 1),'file'=>$item['File'],'label'=>$item['Name']];
        }
        $selected['catalog.json'] = json_encode(['motions'=>$motions,'expressions'=>$expressions], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        return ['files'=>$selected, 'file'=>basename($model_name), 'idle'=>$idle];
    } finally { $zip->close(); }
}
function wzf_mascot_cleanup($path) {
    if (!is_dir($path) || is_link($path)) return;
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $item) {
        if ($item->isDir() && !$item->isLink()) rmdir($item->getPathname()); else unlink($item->getPathname());
    }
    rmdir($path);
}
function wzf_mascot_save_resource($kind, $file, $fields = []) {
    if (!current_user_can('manage_options')) throw new RuntimeException('需要管理员权限。');
    if ($kind !== 'core' && $kind !== 'model') throw new RuntimeException('导入类型无效。');
    $id = $fields['id'] ?? ''; $name = $fields['name'] ?? ''; $credit = $fields['credit'] ?? '';
    if ($kind === 'model' && (!is_string($id) || !preg_match('/\A[a-z][a-z0-9-]{0,63}\z/D', $id) || in_array($id,['constructor','prototype'],true) || !is_string($name) || trim($name) === '' || strlen($name)>200 || strip_tags($name)!==$name || !is_string($credit) || strlen($credit)>300 || strip_tags($credit)!==$credit || preg_match('/[\x00-\x1f\x7f]/', $name . $credit))) throw new RuntimeException('角色 ID、名称或署名无效。');
    if (!is_file($file) || is_link($file)) throw new RuntimeException('上传文件无效。');
    if ($kind === 'core') {
        $core_bytes = filesize($file) <= 8 * 1024 * 1024 ? file_get_contents($file) : false;
        if ($core_bytes === false || !hash_equals(WZF_MASCOT_CORE_SHA, hash('sha256',$core_bytes))) throw new RuntimeException('只接受已核验的 Web 5 R5 live2dcubismcore.min.js；SHA256 不匹配。');
        $payload = ['core.js'=>$core_bytes];
    } else { $model = wzf_mascot_model_zip($file); $payload = $model['files']; }
    $token = bin2hex(random_bytes(16));
    if (!add_option(WZF_MASCOT_LOCK, ['token'=>$token,'started'=>time()], '', false)) throw new RuntimeException('已有导入正在进行，配置未改变。若异常中断，请管理员检查导入锁后重试。');
    $stage = null; $final = null; $saved = false; $owned_final = false;
    try {
        $u = wzf_mascot_uploads(true);
        $dirname = $kind . '-' . $token;
        $stage = $u['path'] . '/stage-' . $token; $final = $u['path'] . '/' . $dirname;
        if (file_exists($stage) || file_exists($final) || !mkdir($stage,0755)) throw new RuntimeException('不能建立独立候选目录。');
        foreach ($payload as $relative=>$raw) {
            $path = $stage . '/' . wzf_mascot_path($relative);
            if (!is_dir(dirname($path)) && !wp_mkdir_p(dirname($path))) throw new RuntimeException('资源目录建立失败。');
            if (file_put_contents($path,$raw,LOCK_EX)!==strlen($raw) || !hash_equals(hash('sha256',$raw),hash_file('sha256',$path))) throw new RuntimeException('资源写入校验失败。');
        }
        if (!rename($stage,$final)) throw new RuntimeException('资源提交失败。');
        $stage = null; $owned_final = true;
        $config = get_option(WZF_MASCOT_OPTION, ['characters'=>[]]);
        if (!is_array($config) || !is_array($config['characters'] ?? null)) throw new RuntimeException('现有资源配置无效。');
        if ($kind === 'core') $config['core'] = ['path'=>$dirname . '/core.js','sha256'=>WZF_MASCOT_CORE_SHA];
        else {
            if (isset($config['characters'][$id])) throw new RuntimeException('角色 ID 已存在，请使用新的 ID；现有角色不会被覆盖。');
            $config['characters'][$id] = ['name'=>trim($name),'root'=>$dirname . '/', 'file'=>$model['file'],'idle'=>$model['idle'],'greetings'=>[], 'welcome'=>null,'size'=>180,'offset'=>0,'credit'=>$credit ?: '管理员导入资源'];
        }
        if (!update_option(WZF_MASCOT_OPTION,$config,false)) throw new RuntimeException('配置保存失败。');
        $saved = true;
    } finally {
        if ($stage) wzf_mascot_cleanup($stage);
        if (!$saved && $owned_final) wzf_mascot_cleanup($final);
        $lock = get_option(WZF_MASCOT_LOCK);
        if (is_array($lock) && ($lock['token'] ?? null) === $token) delete_option(WZF_MASCOT_LOCK);
    }
}
function wzf_mascot_import_post() {
    if (!current_user_can('manage_options')) wp_die('需要管理员权限。', '', ['response'=>403]);
    check_admin_referer('wzf_mascot_import');
    try {
        if (($_POST['rights'] ?? '') !== '1') throw new RuntimeException('请确认有权使用上传资源。');
        $upload = $_FILES['resource'] ?? null;
        if (!is_array($upload) || ($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_string($upload['tmp_name'] ?? null) || !is_uploaded_file($upload['tmp_name'])) throw new RuntimeException('上传失败。');
        $kind = isset($_POST['kind']) && is_string($_POST['kind']) ? wp_unslash($_POST['kind']) : '';
        $fields = [];
        foreach (['id','name','credit'] as $key) $fields[$key] = isset($_POST[$key]) && is_string($_POST[$key]) ? wp_unslash($_POST[$key]) : '';
        wzf_mascot_save_resource($kind,$upload['tmp_name'],$fields);
        $notice = '资源已导入。';
    } catch (Throwable $e) { $notice = $e->getMessage(); }
    wp_safe_redirect(add_query_arg('mascot_notice', $notice, admin_url('options-general.php?page=wzf-mascot')));
    exit;
}
function wzf_mascot_admin_page() {
    if (!current_user_can('manage_options')) return;
    $config = get_option(WZF_MASCOT_OPTION, ['characters'=>[]]);
    echo '<div class="wrap"><h1>WordPress Live2D Mascot</h1><p>插件不附带 Core 或模型。请自行访问官方页面，接受适用条款并下载；插件不会从远程下载。只上传您有权使用的资源，导入成功不代表取得再分发许可。</p>';
    echo '<p><a href="https://www.live2d.com/en/sdk/download/web/" target="_blank" rel="noopener">Cubism SDK for Web 官方下载</a> · <a href="https://www.live2d.com/en/learn/sample/" target="_blank" rel="noopener">官方样例</a></p>';
    echo '<p>Core：' . (!empty($config['core']) ? '已配置（Web 5 R5 固定版本）' : '未配置') . '；角色：' . count($config['characters'] ?? []) . '</p>';
    if (isset($_GET['mascot_notice']) && is_string($_GET['mascot_notice'])) echo '<div class="notice"><p>' . esc_html(wp_unslash($_GET['mascot_notice'])) . '</p></div>';
    echo '<ul>';
    foreach (($config['characters'] ?? []) as $id=>$c) echo '<li>' . esc_html($id . ' — ' . $c['name'] . ' — ' . $c['credit']) . '</li>';
    echo '</ul><p>模型 ZIP 限 64 MiB、1000 项、解压总大小 64 MiB；只接受单个 model3 的运行文件（moc3、PNG、JSON），不能带编辑工程、声音、脚本、HTML 或其他模型。导出后至少保留一个动作，待机优先使用 Idle 组第一个动作。上传现成 catalog 时仍按 model3 重新生成目录。</p>';
    foreach (['core'=>'导入 Core JS（固定 SHA256）','model'=>'导入单模型运行 ZIP'] as $kind=>$label) {
        echo '<h2>' . esc_html($label) . '</h2><form method="post" enctype="multipart/form-data" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('wzf_mascot_import');
        echo '<input type="hidden" name="action" value="wzf_mascot_import"><input type="hidden" name="kind" value="' . esc_attr($kind) . '"><input type="file" name="resource" required accept="' . ($kind==='core'?'.js':'.zip') . '">';
        if ($kind==='model') echo '<p><label>角色 ID <input name="id" required pattern="[a-z][a-z0-9-]{0,63}"></label> <label>名称 <input name="name" required maxlength="100"></label> <label>署名／来源 <input name="credit" maxlength="150"></label></p>';
        echo '<p><label><input type="checkbox" name="rights" value="1" required> 我有权在本站使用资源，并已阅读其来源许可与使用条件。</label></p>';
        submit_button('导入'); echo '</form>';
    }
    echo '</div>';
}
add_action('admin_menu', function() { add_options_page('WordPress Live2D Mascot','Live2D Mascot','manage_options','wzf-mascot','wzf_mascot_admin_page'); });
add_action('admin_post_wzf_mascot_import','wzf_mascot_import_post');
