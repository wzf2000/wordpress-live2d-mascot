<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;

function wzf_mascot_config_version($config) {
    return hash('sha256', serialize($config));
}
function wzf_mascot_plain_text($value, $limit, $required = false) {
    if (!is_string($value) || strlen($value) > $limit || ($required && trim($value) === '') || strip_tags($value) !== $value || preg_match('/[\x00-\x1f\x7f]/', $value)) throw new RuntimeException(__('Name and credit must be valid plain text.', 'live2d-show'));
    return $value;
}
// Read the installed catalog, including IDs maintained by older installations.
// Installed catalogs may include separately maintained motions outside model3.
function wzf_mascot_character_catalog($character) {
    if (!is_array($character)) throw new RuntimeException(__('Character configuration is invalid.', 'live2d-show'));
    $u = wzf_mascot_uploads();
    $root = wzf_mascot_no_links($u['path'] . '/' . wzf_mascot_path(rtrim($character['root'] ?? '', '/')));
    $read = function($relative) use ($root) {
        $path = wzf_mascot_no_links($root . '/' . wzf_mascot_installed_reference($relative));
        if (!is_file($path) || !is_readable($path) || filesize($path) > 8 * 1024 * 1024) throw new RuntimeException(__('The character catalog or model file is unavailable.', 'live2d-show'));
        $raw = @file_get_contents($path);
        if ($raw === false) throw new RuntimeException(__('Cannot read the character catalog.', 'live2d-show'));
        return wzf_mascot_json($raw);
    };
    $read($character['file'] ?? null);
    $catalog = $read('catalog.json');
    $motions = wzf_mascot_list($catalog['motions'] ?? null, 'Motions');
    if (!$motions || count($motions) > 1000) throw new RuntimeException(__('The character motion catalog is empty or too large.', 'live2d-show'));
    $result = [];
    foreach ($motions as $item) {
        if (!is_array($item)) throw new RuntimeException(__('A motion catalog entry is invalid.', 'live2d-show'));
        $id = wzf_mascot_plain_text($item['id'] ?? null, 200, true);
        $file = wzf_mascot_installed_reference($item['file'] ?? null);
        if (array_key_exists($id, $result) || !str_ends_with($file, '.motion3.json')) throw new RuntimeException(__('The motion catalog contains duplicate IDs or invalid file references.', 'live2d-show'));
        $motion = $read($file);
        if (($motion['Version'] ?? null) !== 3) throw new RuntimeException(__('Motion files must be Version 3 JSON.', 'live2d-show'));
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
        $name = wzf_mascot_installed_reference($name);
        $path = wzf_mascot_no_links($root . '/' . $name);
        if (!str_ends_with($name, $suffix) || !is_file($path) || !is_readable($path) || filesize($path) < 1 || filesize($path) > $limit) throw new RuntimeException(__('A model runtime reference is missing, outside the allowed directory or has an invalid size.', 'live2d-show'));
        $files[$name] = filesize($path);
        return $path;
    };
    $model = wzf_mascot_json(@file_get_contents($take($character['file'] ?? null, '.model3.json')));
    $refs = $model['FileReferences'] ?? null;
    if (($model['Version'] ?? null) !== 3 || !is_array($refs)) throw new RuntimeException(__('Model runtime configuration is invalid.', 'live2d-show'));
    $take($refs['Moc'] ?? null, '.moc3', 64 * 1024 * 1024);
    $textures = wzf_mascot_list($refs['Textures'] ?? null, 'Textures');
    if (!$textures || count($textures) > 16) throw new RuntimeException(__('Model texture references are invalid.', 'live2d-show'));
    foreach ($textures as $name) $take($name, '.png', 32 * 1024 * 1024);
    foreach (['Physics','Pose','UserData','DisplayInfo'] as $key) if (isset($refs[$key])) $take($refs[$key], '.json');
    $groups = $refs['Motions'] ?? [];
    if (!is_array($groups)) throw new RuntimeException(__('Model motion references are invalid.', 'live2d-show'));
    foreach ($groups as $items) foreach (wzf_mascot_list($items, 'Motion group') as $motion) $take($motion['File'] ?? null, '.motion3.json');
    foreach (wzf_mascot_list($refs['Expressions'] ?? [], 'Expressions') as $expression) $take($expression['File'] ?? null, '.exp3.json');
    return $files;
}
require_once __DIR__ . '/admin-lifecycle.php';
require_once __DIR__ . '/admin-diagnostics.php';
require_once __DIR__ . '/admin-thumbnail.php';
require_once __DIR__ . '/admin-mobile.php';
require_once __DIR__ . '/interaction-settings.php';
require_once __DIR__ . '/hit-settings.php';
require_once __DIR__ . '/account-preferences.php';
require_once __DIR__ . '/capture-settings.php';
require_once __DIR__ . '/interaction-transfer.php';
require_once __DIR__ . '/interaction-preview.php';
require_once __DIR__ . '/admin-inventory.php';
require_once __DIR__ . '/admin-recovery.php';
require_once __DIR__ . '/admin-listing.php';
require_once __DIR__ . '/admin-readiness.php';
function wzf_mascot_save_layout($version, $snap) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    if (!is_string($version) || !preg_match('/\A[0-9a-f]{64}\z/D', $version) || !is_bool($snap)) throw new RuntimeException(__('Layout settings request is invalid.', 'live2d-show'));
    $task = wzf_mascot_task_begin('settings');
    try {
        $config = $task['config'];
        if (!hash_equals(wzf_mascot_config_version($config), $version)) throw new RuntimeException(__('Another request changed the resource configuration. Refresh before retrying.', 'live2d-show'));
        if (!is_array($config) || !is_array($config['characters'] ?? null)) throw new RuntimeException(__('Resource configuration is invalid.', 'live2d-show'));
        if (($config['snapToEdge'] ?? true) === $snap) return;
        $config['snapToEdge'] = $snap;
        if (!wzf_mascot_resources_update($config)) throw new RuntimeException(__('Cannot save layout settings.', 'live2d-show'));
    } finally { wzf_mascot_task_end($task); }
}
function wzf_mascot_layout_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_layout');
    try {
        if (isset($_POST['snap_to_edge']) && $_POST['snap_to_edge'] !== '1') throw new RuntimeException(__('Layout settings request is invalid.', 'live2d-show'));
        wzf_mascot_save_layout(isset($_POST['version']) && is_string($_POST['version']) ? wp_unslash($_POST['version']) : '', isset($_POST['snap_to_edge']));
        $notice = __('Layout settings saved.', 'live2d-show');
    } catch (Throwable $e) { $notice = wzf_mascot_error_message($e); }
    wp_safe_redirect(add_query_arg('mascot_notice', rawurlencode($notice), admin_url('options-general.php?page=wzf-mascot')));
    exit;
}
function wzf_mascot_layout_panel($config) {
    echo '<section class="wzf-mascot-card"><h2>' . esc_html__('Position after dragging', 'live2d-show') . '</h2><p class="description">' . esc_html__('Choose the site default after readers release the character. Readers can override it for each character in Position and size.', 'live2d-show') . '</p><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    wp_nonce_field('wzf_mascot_layout');
    echo '<input type="hidden" name="action" value="wzf_mascot_layout"><input type="hidden" name="version" value="' . esc_attr(wzf_mascot_config_version($config)) . '"><p><label><input type="checkbox" name="snap_to_edge" value="1" ' . checked(($config['snapToEdge'] ?? true) !== false, true, false) . '> ' . esc_html__('Snap to the left or right edge after dragging', 'live2d-show') . '</label></p>';
    submit_button(__('Save layout settings', 'live2d-show')); echo '</form></section>';
}
add_action('admin_post_wzf_mascot_layout', 'wzf_mascot_layout_post');
function wzf_mascot_save_character($id, $version, $fields) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    if (!is_string($id) || !is_string($version) || !preg_match('/\A[0-9a-f]{64}\z/D', $version) || !is_array($fields) || array_diff(array_keys($fields), ['name','credit','size','offset','idle','welcome','greetings'])) throw new RuntimeException(__('Character settings request is invalid.', 'live2d-show'));
    $task = wzf_mascot_task_begin('settings');
    $token = $task['token'];
    try {
        $config = $task['config'];
        if (!hash_equals(wzf_mascot_config_version($config), $version)) throw new RuntimeException(__('Another request changed the resource configuration. Refresh before editing again.', 'live2d-show'));
        if (!is_array($config) || !is_array($config['characters'] ?? null) || !array_key_exists($id, $config['characters']) || !is_array($config['characters'][$id])) throw new RuntimeException(__('The character does not exist or its configuration is invalid.', 'live2d-show'));
        $character = $config['characters'][$id];
        $motions = wzf_mascot_character_motions($character);
        $patch = ['name'=>trim(wzf_mascot_plain_text($fields['name'] ?? null, 200, true)), 'credit'=>wzf_mascot_plain_text($fields['credit'] ?? null, 300)];
        foreach (['size'=>[140,260], 'offset'=>[-100,100]] as $key=>$range) {
            $value = $fields[$key] ?? null;
            if ((!is_string($value) && !is_int($value) && !is_float($value)) || !is_numeric($value)) throw new RuntimeException(__('Size and offset must be valid numbers.', 'live2d-show'));
            $number = (float)$value;
            if (!is_finite($number) || $number < $range[0] || $number > $range[1] || ($key === 'size' && ($number != (int)$number || (int)$number % 10 !== 0))) throw new RuntimeException(__('Size must be 140–260 pixels in steps of 10; offset must be -100–100%.', 'live2d-show'));
            $patch[$key] = $key === 'size' ? (int)$number : $number;
        }
        foreach (['idle','welcome'] as $key) {
            $value = $fields[$key] ?? null;
            if ($key === 'welcome' && ($value === '' || $value === null)) $patch[$key] = null;
            elseif (!is_string($value) || !array_key_exists($value, $motions)) throw new RuntimeException(__('The idle or welcome motion is not in the current character catalog.', 'live2d-show'));
            else $patch[$key] = $value;
        }
        $greetings = wzf_mascot_list($fields['greetings'] ?? null, 'Greetings');
        if (count($greetings) > count($motions)) throw new RuntimeException(__('The greeting motion count is invalid.', 'live2d-show'));
        foreach ($greetings as $motion) if (!is_string($motion) || !array_key_exists($motion, $motions)) throw new RuntimeException(__('A greeting motion is not in the current character catalog.', 'live2d-show'));
        if (count(array_unique($greetings)) !== count($greetings)) throw new RuntimeException(__('Greeting motions must not be duplicated.', 'live2d-show'));
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
        if (!wzf_mascot_resources_update($config)) throw new RuntimeException(__('Cannot save character settings.', 'live2d-show'));
    } finally {
        wzf_mascot_task_end($task);
    }
}
function wzf_mascot_settings_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_settings');
    $id = isset($_POST['character']) && is_string($_POST['character']) ? wp_unslash($_POST['character']) : '';
    try {
        $version = isset($_POST['version']) && is_string($_POST['version']) ? wp_unslash($_POST['version']) : '';
        $fields = [];
        foreach (['name','credit','size','offset','idle','welcome'] as $key) {
            if (!isset($_POST[$key]) || !is_string($_POST[$key])) throw new RuntimeException(__('Character settings request is invalid.', 'live2d-show'));
            $fields[$key] = wp_unslash($_POST[$key]);
        }
        $fields['greetings'] = isset($_POST['greetings']) && is_array($_POST['greetings']) ? wp_unslash($_POST['greetings']) : [];
        if (isset($_POST['greetings']) && !is_array($_POST['greetings'])) throw new RuntimeException(__('Greeting motion request is invalid.', 'live2d-show'));
        wzf_mascot_save_character($id, $version, $fields);
        $notice = __('Character settings saved.', 'live2d-show');
    } catch (Throwable $e) { $notice = wzf_mascot_error_message($e); }
    wp_safe_redirect(add_query_arg(['mascot_notice'=>rawurlencode($notice), 'character'=>$id], admin_url('options-general.php?page=wzf-mascot')));
    exit;
}
function wzf_mascot_admin_styles($hook) {
    if (!in_array($hook, ['settings_page_wzf-mascot','profile.php','user-edit.php'], true)) return;
    if ($hook === 'settings_page_wzf-mascot') wp_enqueue_script('wzf-mascot-admin', plugins_url('admin.js', dirname(__DIR__) . '/live2d-show.php'), [], '3.11.0', true);
    wp_enqueue_style('wzf-mascot-admin', plugins_url('admin.css', dirname(__DIR__) . '/live2d-show.php'), [], '3.11.0');
}
function wzf_mascot_motion_select($key, $label, $motions, $value, $optional = false) {
    echo '<div class="wzf-mascot-field"><label for="mascot-' . esc_attr($key) . '">' . esc_html($label) . '</label><select id="mascot-' . esc_attr($key) . '" name="' . esc_attr($key) . '">';
    if ($optional) echo ('<option value="">' . esc_html__('Do not automatically play a welcome motion', 'live2d-show') . '</option>');
    if ($value !== null && $value !== '' && !array_key_exists($value, $motions)) echo '<option value="' . esc_attr($value) . ('" selected>' . esc_html__('The current reference is invalid; choose again', 'live2d-show') . '</option>');
    foreach ($motions as $id=>$text) echo '<option value="' . esc_attr($id) . '" ' . selected((string)$value, (string)$id, false) . '>' . esc_html($text . ' · ' . $id) . '</option>';
    echo '</select></div>';
}
function wzf_mascot_character_editor($config, $id) {
    $character = $config['characters'][$id];
    // Safe form defaults are local only; opening the editor never repairs options.
    foreach (['name','credit','idle','welcome','size','offset'] as $key) if (isset($character[$key]) && !is_scalar($character[$key])) $character[$key] = '';
    if (!is_array($character['greetings'] ?? null)) $character['greetings'] = [];
    echo ('<section class="wzf-mascot-card" aria-labelledby="mascot-edit-title"><h2 id="mascot-edit-title">' . esc_html(sprintf(__('Character settings · %s', 'live2d-show'), $character['name'] ?? $id))) . ('</h2><p class="description">' . esc_html__('Edit display information and motion references; model files stay in place. Size is the browser layout default; the reader’s existing local size preference takes priority.', 'live2d-show') . '</p>');
    try { $motions = wzf_mascot_character_motions($character); }
    catch (Throwable $e) { echo '<div class="notice notice-error inline"><p>' . esc_html(wzf_mascot_error_message($e)) . (' ' . esc_html__('Check the installed resources before retrying.', 'live2d-show') . '</p></div></section>'); return; }
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    wp_nonce_field('wzf_mascot_settings');
    echo '<input type="hidden" name="action" value="wzf_mascot_settings"><input type="hidden" name="character" value="' . esc_attr($id) . '"><input type="hidden" name="version" value="' . esc_attr(wzf_mascot_config_version($config)) . '"><div class="wzf-mascot-fields">';
    foreach (['name'=>[__('Character name', 'live2d-show'), $character['name'] ?? '', 'text', 'required'], 'credit'=>[__('Credit / source', 'live2d-show'), $character['credit'] ?? '', 'text', ''], 'size'=>[__('Default size (pixels)', 'live2d-show'), $character['size'] ?? 180, 'number', 'min="140" max="260" step="10" required'], 'offset'=>[__('Vertical offset (%)', 'live2d-show'), $character['offset'] ?? 0, 'number', 'min="-100" max="100" step="any" required']] as $key=>$field) {
        echo '<div class="wzf-mascot-field"><label for="mascot-' . esc_attr($key) . '">' . esc_html($field[0]) . '</label><input id="mascot-' . esc_attr($key) . '" name="' . esc_attr($key) . '" type="' . $field[2] . '" value="' . esc_attr($field[1]) . '" ' . $field[3] . '></div>';
    }
    wzf_mascot_motion_select('idle', __('Idle motion (loop)', 'live2d-show'), $motions, $character['idle'] ?? '');
    wzf_mascot_motion_select('welcome', __('Welcome motion (first display)', 'live2d-show'), $motions, $character['welcome'] ?? null, true);
    echo ('</div><fieldset class="wzf-mascot-greetings"><legend>' . esc_html__('Greeting motions', 'live2d-show') . '</legend><p class="description">' . esc_html__('The frontend greeting cycles through selected motions. Existing order is retained and new selections are appended. Leave all unchecked to disable greetings. Welcome playback still follows first-display, reading suspension and manual interaction rules.', 'live2d-show') . '</p><div class="wzf-mascot-checks">');
    foreach ($motions as $motion=>$label) echo '<label><input type="checkbox" name="greetings[]" value="' . esc_attr($motion) . '" ' . checked(in_array((string)$motion, $character['greetings'] ?? [], true), true, false) . '> ' . esc_html($label . ' · ' . $motion) . '</label>';
    echo '</div></fieldset>';
    submit_button(__('Save character settings', 'live2d-show'));
    echo '</form></section>';
}
function wzf_mascot_admin_page() {
    if (!current_user_can('manage_options')) return;
    $raw = get_option(WZF_MASCOT_OPTION, ['characters'=>[]]);
    $config = is_array($raw) ? $raw : [];
    $characters = is_array($config['characters'] ?? null) ? $config['characters'] : [];
    $display_rows = wzf_mascot_display_report($config);
    $health = array_column($display_rows, null, 'id');
    $listing = wzf_mascot_character_listing($characters, $display_rows, $_GET);
    echo '<div class="wrap wzf-mascot-admin" data-unsaved-message="' . esc_attr__('You have unsaved changes. Leave this page?', 'live2d-show') . ('"><h1>WordPress Live2D Mascot</h1><p class="wzf-mascot-intro">' . esc_html__('Manage resources and characters so readers can use the mascot on their own terms.', 'live2d-show') . '</p>');
    if (isset($_GET['mascot_notice']) && is_string($_GET['mascot_notice'])) echo '<div class="notice notice-info"><p>' . esc_html(wp_unslash($_GET['mascot_notice'])) . '</p></div>';
    echo '<div class="wzf-mascot-status"><div><span>' . esc_html__('Core resources', 'live2d-show') . '</span><strong>' . esc_html(!empty($config['core']) ? __('Configured · Web 5 R5', 'live2d-show') : __('Not imported', 'live2d-show')) . '</strong></div><div><span>' . esc_html__('Configured characters', 'live2d-show') . '</span><strong>' . esc_html(sprintf(_n('%s character', '%s characters', count($characters), 'live2d-show'), number_format_i18n(count($characters)))) . '</strong></div><div><span>' . esc_html__('Frontend display', 'live2d-show') . '</span><strong>' . esc_html__('Readers opt in', 'live2d-show') . '</strong></div></div>';
    wzf_mascot_task_panel();
    echo ('<section class="wzf-mascot-card"><h2>' . esc_html__('Character management', 'live2d-show') . '</h2><p class="description">' . esc_html__('Select a character to edit its name, credit, default layout and motions. Plugin upgrades retain uploads resources and browser preferences.', 'live2d-show') . '</p>');
    wzf_mascot_readiness_panel($raw, $display_rows);
    wzf_mascot_character_search($listing);
    if (!$characters) echo ('<p>' . esc_html__('No characters yet. Import Core and one model, then configure the character.', 'live2d-show') . '</p>');
    elseif (!$listing['characters']) echo '<p role="status">' . esc_html__('No characters match. Change the search or status filter.', 'live2d-show') . '</p>';
    else {
        echo ('<div class="wzf-mascot-table"><table class="widefat striped"><thead><tr><th scope="col">' . esc_html__('Character', 'live2d-show') . '</th><th scope="col">' . esc_html__('Credit / source', 'live2d-show') . '</th><th scope="col">' . esc_html__('Manage', 'live2d-show') . '</th></tr></thead><tbody>');
        foreach ($listing['characters'] as $id=>$c) {
            if (!is_array($c)) { echo '<tr><th scope="row">' . esc_html($id) . ('</th><td>' . esc_html__('Invalid configuration structure · Isolated', 'live2d-show') . '</td><td>' . esc_html__('Restore a configuration backup before retrying.', 'live2d-show') . '</td></tr>'); continue; }
            $name = is_string($c['name'] ?? null) ? $c['name'] : (string)$id;
            $credit = is_string($c['credit'] ?? null) ? $c['credit'] : __('Invalid configuration', 'live2d-show');
            $status = wzf_mascot_character_status($c);
            $status_label = is_string($status) ? (['active'=>__('Active', 'live2d-show'),'disabled'=>__('Disabled', 'live2d-show'),'trash'=>__('Trash', 'live2d-show')][$status] ?? __('Invalid status', 'live2d-show')) : __('Invalid status', 'live2d-show');
            echo '<tr><th scope="row">';
            wzf_mascot_admin_thumbnail($c);
            echo '<strong>' . esc_html($name) . '</strong> · ' . esc_html($status_label . ((!($health[(string)$id]['ok'] ?? false)) ? ' · ' . __('Isolated', 'live2d-show') : '')) . '<br><code>' . esc_html($id) . '</code></th><td>' . esc_html($credit) . '</td><td><a class="button" aria-label="' . esc_attr(sprintf(__('Edit character %s', 'live2d-show'), $name)) . '" href="' . esc_url(add_query_arg('character', $id, admin_url('options-general.php?page=wzf-mascot'))) . ('#mascot-edit-title">' . esc_html__('Edit', 'live2d-show') . '</a></td></tr>');
        }
        echo '</tbody></table></div>';
    }
    echo '</section>';
    $selected = isset($_GET['character']) && is_string($_GET['character']) ? wp_unslash($_GET['character']) : '';
    if ($selected !== '' && isset($characters[$selected]) && is_array($characters[$selected])) {
        wzf_mascot_character_management($config, $selected);
        wzf_mascot_thumbnail_panel($config, $selected);
        if (wzf_mascot_character_status($characters[$selected]) !== 'trash') { wzf_mascot_character_editor($config, $selected); wzf_mascot_interaction_panel($config, $selected); wzf_mascot_presets_panel($config, $selected); wzf_mascot_hits_panel($config, $selected); wzf_mascot_capture_panel($config, $selected); wzf_mascot_template_panel($config, $selected); }
    }
    elseif ($selected !== '') echo ('<div class="notice notice-error inline"><p>' . esc_html__('The character does not exist. Select one from the list.', 'live2d-show') . '</p></div>');
    echo ('<section class="wzf-mascot-card"><h2>' . esc_html__('Resource preparation', 'live2d-show') . '</h2><p>' . esc_html__('The plugin includes no Core or models. Obtain resources you have the right to use on this site and read their source licenses and terms. Successful import does not grant redistribution rights.', 'live2d-show') . '</p><p><a href="https://www.live2d.com/en/sdk/download/web/" target="_blank" rel="noopener">' . esc_html__('Official Cubism SDK for Web download', 'live2d-show') . '</a> · <a href="https://www.live2d.com/en/learn/sample/" target="_blank" rel="noopener">' . esc_html__('Official samples', 'live2d-show') . '</a></p><p class="description">' . esc_html__('Core must match the required Web 5 R5 SHA256. Model ZIPs are limited to 64 MiB and 1,000 entries: one model3 runtime with no sound, scripts or editor projects. Keep at least one motion; the first Idle-group motion is preferred as default idle. Adjust it in character settings after import.', 'live2d-show') . '</p></section><div class="wzf-mascot-imports">');
    foreach (['core'=>__('Import Core JS', 'live2d-show'), 'model'=>__('Import model ZIP', 'live2d-show')] as $kind=>$label) {
        echo '<section class="wzf-mascot-card"><h2>' . esc_html($label) . '</h2><form method="post" enctype="multipart/form-data" action="' . esc_url(admin_url('admin-post.php?action=wzf_mascot_import')) . '">';
        wp_nonce_field('wzf_mascot_import');
        echo '<input type="hidden" name="action" value="wzf_mascot_import"><input type="hidden" name="kind" value="' . esc_attr($kind) . '"><div class="wzf-mascot-field"><label for="mascot-upload-' . $kind . ('">' . esc_html__('Resource file', 'live2d-show') . '</label><input id="mascot-upload-') . $kind . '" type="file" name="resource" required accept="' . ($kind === 'core' ? '.js' : '.zip') . '"></div>';
        if ($kind === 'model') echo ('<div class="wzf-mascot-field"><label for="mascot-new-id">' . esc_html__('Character ID', 'live2d-show') . '</label><input id="mascot-new-id" name="id" required pattern="[a-z][a-z0-9-]{0,63}" maxlength="64"><p class="description">' . esc_html__('Start with a lowercase letter; use letters, digits or hyphens. Existing IDs are never overwritten.', 'live2d-show') . '</p></div><div class="wzf-mascot-field"><label for="mascot-new-name">' . esc_html__('Character name', 'live2d-show') . '</label><input id="mascot-new-name" name="name" required></div><div class="wzf-mascot-field"><label for="mascot-new-credit">' . esc_html__('Credit / source', 'live2d-show') . '</label><input id="mascot-new-credit" name="credit"></div>');
        echo ('<p><label><input type="checkbox" name="rights" value="1" required> ' . esc_html__('I have the right to use these resources on this site and have read their source licenses and terms.', 'live2d-show') . '</label></p>');
        submit_button($label); echo '</form></section>';
    }
    echo '</div>';
    wzf_mascot_layout_panel($config);
    wzf_mascot_mobile_panel($config);
    wzf_mascot_admin_diagnostics($config, $display_rows);
    wzf_mascot_inventory_panel($raw);
    wzf_mascot_recovery_panel($raw);
    echo '</div>';
}
add_action('admin_post_wzf_mascot_settings', 'wzf_mascot_settings_post');
add_action('admin_enqueue_scripts', 'wzf_mascot_admin_styles');
