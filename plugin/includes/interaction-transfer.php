<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;

function wzf_mascot_template_fields($object, $keys) {
    if (!($object instanceof stdClass) || array_diff(array_keys(get_object_vars($object)), $keys) || array_diff($keys, array_keys(get_object_vars($object)))) throw new RuntimeException(__('Interaction template fields are invalid.', 'live2d-show'));
    return get_object_vars($object);
}
function wzf_mascot_template_path($value, $suffix) {
    if ($value === '') return '';
    $path = wzf_mascot_path($value);
    if (strlen($path) > 1024 || !str_ends_with($path, $suffix)) throw new RuntimeException(__('Template resource paths must be relative motion or expression files.', 'live2d-show'));
    return $path;
}
function wzf_mascot_template_decode($raw) {
    if (!is_string($raw) || strlen($raw) < 1 || strlen($raw) > 65536) throw new RuntimeException(__('Choose a valid interaction JSON file no larger than 64 KiB.', 'live2d-show'));
    try { $object = json_decode($raw, false, 12, JSON_THROW_ON_ERROR); }
    catch (Throwable $e) { throw new RuntimeException(__('The template is not valid UTF-8 JSON or is nested too deeply.', 'live2d-show')); }
    // json_decode accepts duplicate object keys. Reject them, including escaped aliases.
    preg_match_all('/"(?:\\\\.|[^"\\\\])*"|[{}\[\]:,]|true|false|null|-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/s', $raw, $tokens);
    $stack = [];
    foreach ($tokens[0] as $token) {
        $last = count($stack) - 1;
        if ($token === '{' || $token === '[') $stack[] = ['object'=>$token === '{','key'=>true,'seen'=>[]];
        elseif ($token === '}' || $token === ']') array_pop($stack);
        elseif ($last >= 0 && $stack[$last]['object']) {
            if ($token === ',') $stack[$last]['key'] = true;
            elseif ($token === ':') $stack[$last]['key'] = false;
            elseif ($stack[$last]['key'] && $token[0] === '"') {
                $key = json_decode($token, true, 2, JSON_THROW_ON_ERROR);
                if (isset($stack[$last]['seen'][$key])) throw new RuntimeException(__('Interaction template fields are invalid.', 'live2d-show'));
                $stack[$last]['seen'][$key] = true;
            }
        }
    }
    $value = wzf_mascot_template_fields($object, ['type','schema','dialogue','presets']);
    if ($value['type'] !== 'wzf-mascot-interactions' || $value['schema'] !== 1) throw new RuntimeException(__('This interaction template type or version is not supported.', 'live2d-show'));
    $rules = wzf_mascot_template_fields($value['dialogue'], array_keys(wzf_mascot_line_events()));
    foreach ($rules as $event=>$object_rule) {
        $rule = wzf_mascot_template_fields($object_rule, ['enabled','cooldown','lines']);
        if (!is_bool($rule['enabled']) || !is_int($rule['cooldown'])) throw new RuntimeException(__('Dialogue settings are invalid.', 'live2d-show'));
        if (!is_array($rule['lines']) || count($rule['lines']) > 8) throw new RuntimeException(__('Use up to 8 plain-text lines per event, each at most 300 bytes.', 'live2d-show'));
        $rules[$event] = $rule;
    }
    $dialogue = wzf_mascot_dialogue($rules, true);
    if (!is_array($value['presets']) || count($value['presets']) > 8) throw new RuntimeException(__('Use up to 8 interaction presets.', 'live2d-show'));
    $presets = []; $seen = [];
    foreach ($value['presets'] as $object_preset) {
        $row = wzf_mascot_template_fields($object_preset, ['id','name','motionFile','expressionFile','line']);
        foreach (['id'=>64,'name'=>80,'line'=>300] as $key=>$limit) $row[$key] = trim(wzf_mascot_plain_text($row[$key], $limit, $key !== 'line'));
        if (!preg_match('/\A[a-z][a-z0-9-]{0,63}\z/D', $row['id']) || isset($seen[$row['id']])) throw new RuntimeException(__('Interaction preset is invalid.', 'live2d-show'));
        $seen[$row['id']] = true;
        $row['motionFile'] = wzf_mascot_template_path($row['motionFile'], '.motion3.json');
        $row['expressionFile'] = wzf_mascot_template_path($row['expressionFile'], '.exp3.json');
        if ($row['motionFile'] === '' && $row['expressionFile'] === '' && $row['line'] === '') throw new RuntimeException(__('A preset needs a name and at least one motion, expression or line.', 'live2d-show'));
        $presets[] = $row;
    }
    return ['type'=>'wzf-mascot-interactions','schema'=>1,'dialogue'=>$dialogue,'presets'=>$presets];
}
function wzf_mascot_template_json($template, $pretty = true) {
    $json = json_encode($template, ($pretty ? JSON_PRETTY_PRINT : 0) | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    wzf_mascot_template_decode($json); // Also bound exported files to the import limit.
    return $json;
}
function wzf_mascot_template_character($config, $id, $version) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    if (!is_string($id) || !is_string($version) || !preg_match('/\A[0-9a-f]{64}\z/D', $version) || !hash_equals(wzf_mascot_config_version($config), $version)) throw new RuntimeException(__('Another request changed the resource configuration. Refresh before editing again.', 'live2d-show'));
    if (!is_array($config) || !is_array($config['characters'][$id] ?? null)) throw new RuntimeException(__('The character does not exist or its configuration is invalid.', 'live2d-show'));
    return $config['characters'][$id];
}
function wzf_mascot_template_export($config, $id, $version) {
    $c = wzf_mascot_template_character($config, $id, $version);
    $rows = wzf_mascot_presets($c['presets'] ?? [], null, null, true);
    $motions = $expressions = null; $presets = [];
    foreach ($rows as $row) {
        $next = ['id'=>$row['id'],'name'=>$row['name'],'motionFile'=>'','expressionFile'=>'','line'=>$row['line']];
        foreach (['motion'=>'motionFile','expression'=>'expressionFile'] as $channel=>$key) {
            if ($row[$channel] === '') continue;
            if ($channel === 'motion' && $motions === null) $motions = wzf_mascot_character_catalog($c);
            if ($channel === 'expression' && $expressions === null) $expressions = wzf_mascot_character_expressions($c);
            $catalog = $channel === 'motion' ? $motions : $expressions;
            $file = $catalog[$row[$channel]]['file'] ?? null;
            if ($file === null || count(array_filter($catalog, function($item) use ($file) { return $item['file'] === $file; })) !== 1) throw new RuntimeException(__('A preset resource cannot be mapped. Repair the preset before exporting.', 'live2d-show'));
            $next[$key] = $file;
        }
        $presets[] = $next;
    }
    return wzf_mascot_template_json(['type'=>'wzf-mascot-interactions','schema'=>1,'dialogue'=>wzf_mascot_dialogue($c['dialogue'] ?? [], true),'presets'=>$presets]);
}
function wzf_mascot_template_plan($config, $id, $version, $raw, $scope) {
    $c = wzf_mascot_template_character($config, $id, $version);
    if (!in_array($scope, ['dialogue','dialogue-presets'], true)) throw new RuntimeException(__('Interaction template fields are invalid.', 'live2d-show'));
    $template = wzf_mascot_template_decode($raw);
    $before = wzf_mascot_dialogue($c['dialogue'] ?? []);
    $dialogue = $template['dialogue'];
    // Import never turns chatter on. Empty imported lines still turn it off.
    $dialogue['idle']['enabled'] = ($before['idle']['enabled'] ?? false) && !!$dialogue['idle']['lines'];
    $next = $c; $next['dialogue'] = $dialogue; $mapping = [];
    if ($scope === 'dialogue-presets') {
        if (!empty($c['hitBindings'])) throw new RuntimeException(__('This character has hit-area bindings. Import dialogue only, or remove the bindings in their existing panel before importing presets.', 'live2d-show'));
        $motions = $expressions = null; $presets = [];
        foreach ($template['presets'] as $row) {
            $preset = ['id'=>$row['id'],'name'=>$row['name'],'motion'=>'','expression'=>'','line'=>$row['line']];
            foreach (['motion'=>'motionFile','expression'=>'expressionFile'] as $channel=>$key) {
                if ($row[$key] === '') continue;
                if ($channel === 'motion' && $motions === null) $motions = wzf_mascot_character_catalog($c);
                if ($channel === 'expression' && $expressions === null) $expressions = wzf_mascot_character_expressions($c);
                $catalog = $channel === 'motion' ? $motions : $expressions; $matches = [];
                foreach ($catalog as $resource_id=>$item) if ($item['file'] === $row[$key]) $matches[] = (string)$resource_id;
                if (count($matches) !== 1) throw new RuntimeException(__('A template resource is missing or ambiguous in this character. Import dialogue only, or fix the matching catalog.', 'live2d-show'));
                $preset[$channel] = $matches[0];
                $mapping[] = ['preset'=>$row['id'],'channel'=>$channel,'file'=>$row[$key],'id'=>$matches[0]];
            }
            $presets[] = $preset;
        }
        $next['presets'] = $presets;
    }
    return ['before'=>$c,'after'=>$next,'dialogueBefore'=>$before,'mapping'=>$mapping];
}
function wzf_mascot_template_signature($id, $version, $raw, $scope, $issued) {
    return hash_hmac('sha256', serialize([get_current_blog_id(), get_current_user_id(), $id, $version, $raw, $scope, $issued]), wp_salt('nonce'));
}
function wzf_mascot_template_preview($id, $version, $raw, $scope) {
    $config = wzf_mascot_task_snapshot()['config'];
    // Native form submission normalizes literal newlines to CRLF. Sign a single
    // line so the hidden value crosses that transport without changing bytes.
    $raw = wzf_mascot_template_json(wzf_mascot_template_decode($raw), false);
    $plan = wzf_mascot_template_plan($config, $id, $version, $raw, $scope);
    $issued = (string)time();
    return ['plan'=>$plan,'character'=>$id,'version'=>$version,'payload'=>$raw,'scope'=>$scope,'issued'=>$issued,'signature'=>wzf_mascot_template_signature($id, $version, $raw, $scope, $issued)];
}
function wzf_mascot_template_apply($id, $version, $raw, $scope, $issued, $signature, $confirmed) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    if ($confirmed !== '1') throw new RuntimeException(__('Confirm the displayed interaction changes before applying.', 'live2d-show'));
    if (!is_string($issued) || !preg_match('/\A[0-9]{1,12}\z/D', $issued) || (int)$issued > time() || time() - (int)$issued > 900 || !is_string($signature) || !preg_match('/\A[0-9a-f]{64}\z/D', $signature) || !hash_equals(wzf_mascot_template_signature($id, $version, $raw, $scope, $issued), $signature)) throw new RuntimeException(__('This template preview expired or changed. Upload it again to review a fresh preview.', 'live2d-show'));
    // Validate before creating the guard, then repeat under the existing fresh-state lock.
    wzf_mascot_template_plan(wzf_mascot_task_snapshot()['config'], $id, $version, $raw, $scope);
    wzf_mascot_locked_character($id, $version, function($config) use ($id, $version, $raw, $scope) {
        $plan = wzf_mascot_template_plan($config, $id, $version, $raw, $scope);
        if ($plan['before'] === $plan['after']) return;
        $config['characters'][$id] = $plan['after'];
        if (!update_option(WZF_MASCOT_OPTION, $config, false)) throw new RuntimeException(__('Cannot save character settings.', 'live2d-show'));
    }, 'settings');
}
function wzf_mascot_template_post_fields($keys) {
    $values = [];
    foreach ($keys as $key) {
        if (!is_string($_POST[$key] ?? null)) throw new RuntimeException(__('Interaction template fields are invalid.', 'live2d-show'));
        $values[$key] = wp_unslash($_POST[$key]);
    }
    return $values;
}
function wzf_mascot_template_preview_gate() {
    if (($_GET['page'] ?? null) !== 'wzf-mascot' || !isset($_GET['mascot_template_preview'])) return;
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    wzf_mascot_upload_referer('wzf_mascot_template_preview');
    global $wzf_mascot_template_review;
    try {
        $fields = wzf_mascot_template_post_fields(['character','version']);
        $scope = ($_POST['include_presets'] ?? '') === '1' ? 'dialogue-presets' : 'dialogue';
        if (isset($_POST['include_presets']) && $_POST['include_presets'] !== '1') throw new RuntimeException(__('Interaction template fields are invalid.', 'live2d-show'));
        $upload = $_FILES['template'] ?? null;
        if (!is_array($upload) || ($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_string($upload['tmp_name'] ?? null) || !is_uploaded_file($upload['tmp_name'])) throw new RuntimeException(__('Choose a valid interaction JSON file no larger than 64 KiB.', 'live2d-show'));
        $raw = @file_get_contents($upload['tmp_name'], false, null, 0, 65537);
        $wzf_mascot_template_review = wzf_mascot_template_preview($fields['character'], $fields['version'], $raw, $scope);
    } catch (Throwable $e) { $wzf_mascot_template_review = ['error'=>wzf_mascot_error_message($e)]; }
}
function wzf_mascot_template_export_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_template_export');
    try {
        $fields = wzf_mascot_template_post_fields(['character','version']);
        $json = wzf_mascot_template_export(wzf_mascot_task_snapshot()['config'], $fields['character'], $fields['version']);
    } catch (Throwable $e) { wp_die(esc_html(wzf_mascot_error_message($e)), '', ['response'=>400]); }
    nocache_headers(); header('Content-Type: application/json; charset=UTF-8');
    header('Content-Disposition: attachment; filename="mascot-interactions.json"');
    header('X-Content-Type-Options: nosniff'); echo $json; exit;
}
function wzf_mascot_template_apply_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_template_apply');
    $id = is_string($_POST['character'] ?? null) ? wp_unslash($_POST['character']) : '';
    try {
        $fields = wzf_mascot_template_post_fields(['character','version','payload','scope','issued','signature','confirm']);
        wzf_mascot_template_apply($id, $fields['version'], $fields['payload'], $fields['scope'], $fields['issued'], $fields['signature'], $fields['confirm']);
        $notice = __('Interaction template applied to this character.', 'live2d-show');
    } catch (Throwable $e) { $notice = wzf_mascot_error_message($e); }
    wp_safe_redirect(add_query_arg(['mascot_notice'=>rawurlencode($notice),'character'=>$id], admin_url('options-general.php?page=wzf-mascot'))); exit;
}
function wzf_mascot_template_hidden($values) {
    foreach ($values as $key=>$value) echo '<input type="hidden" name="' . esc_attr($key) . '" value="' . esc_attr($value) . '">';
}
function wzf_mascot_template_rule_summary($rule) {
    $label = !empty($rule['enabled']) ? __('Enabled', 'live2d-show') : __('Disabled', 'live2d-show');
    echo '<p><strong>' . esc_html($label) . '</strong> · ' . esc_html(sprintf(__('Cooldown: %s seconds', 'live2d-show'), (string)($rule['cooldown'] ?? 60))) . '</p>';
    echo '<pre>' . esc_html($rule['lines'] ? implode("\n", $rule['lines']) : __('None', 'live2d-show')) . '</pre>';
}
function wzf_mascot_template_preset_summary($row) {
    if ($row === null) { echo '<p>' . esc_html__('None', 'live2d-show') . '</p>'; return; }
    echo '<dl class="wzf-mascot-template-preset">';
    foreach (['name'=>__('Preset name', 'live2d-show'),'motion'=>__('Motion', 'live2d-show'),'expression'=>__('Expression', 'live2d-show'),'line'=>__('Preset line', 'live2d-show')] as $field=>$label) {
        echo '<dt>' . esc_html($label) . '</dt><dd>' . esc_html($row[$field] !== '' ? $row[$field] : __('None', 'live2d-show')) . '</dd>';
    }
    echo '</dl>';
}
function wzf_mascot_template_diff($review) {
    $plan = $review['plan'];
    echo '<h3>' . esc_html__('Review interaction changes', 'live2d-show') . '</h3><p>' . esc_html__('Nothing has been saved. Applying replaces the selected sections, including removal of existing lines or presets missing from the template. Occasional chatter keeps this character’s current enable setting; empty imported lines turn it off.', 'live2d-show') . '</p>';
    foreach (wzf_mascot_line_events() as $event=>$label) {
        $before = $plan['dialogueBefore'][$event] ?? ['enabled'=>false,'cooldown'=>$event === 'idle' ? 120 : 60,'lines'=>[]];
        $after = $plan['after']['dialogue'][$event];
        $same = $before === $after;
        $change = $same ? __('Unchanged', 'live2d-show') : (!$before['lines'] && $after['lines'] ? __('Added', 'live2d-show') : ($before['lines'] && !$after['lines'] ? __('Removed', 'live2d-show') : __('Replaced', 'live2d-show')));
        echo '<details class="wzf-mascot-replace wzf-mascot-template-change"' . ($same ? '' : ' open') . '><summary>' . esc_html($label . ' · ' . $change) . '</summary><div class="wzf-mascot-template-columns"><div><h5>' . esc_html__('Before', 'live2d-show') . '</h5>';
        wzf_mascot_template_rule_summary($before); echo '</div><div><h5>' . esc_html__('After', 'live2d-show') . '</h5>'; wzf_mascot_template_rule_summary($after); echo '</div></div></details>';
    }
    if ($review['scope'] === 'dialogue-presets') {
        echo '<h4>' . esc_html__('Quick interactions', 'live2d-show') . '</h4>';
        $old = wzf_mascot_presets($plan['before']['presets'] ?? [], null, null); $new = $plan['after']['presets'];
        $old = array_column($old, null, 'id'); $new = array_column($new, null, 'id');
        $ids = array_unique(array_merge(array_keys($old), array_keys($new)));
        if (!$ids) echo '<p>' . esc_html__('None', 'live2d-show') . '</p>';
        foreach ($ids as $preset_id) {
            $same = isset($old[$preset_id], $new[$preset_id]) && $old[$preset_id] === $new[$preset_id];
            $change = !isset($old[$preset_id]) ? __('Added', 'live2d-show') : (!isset($new[$preset_id]) ? __('Removed', 'live2d-show') : ($same ? __('Unchanged', 'live2d-show') : __('Replaced', 'live2d-show')));
            $name = $new[$preset_id]['name'] ?? $old[$preset_id]['name'];
            echo '<details class="wzf-mascot-replace wzf-mascot-template-change"' . ($same ? '' : ' open') . '><summary>' . esc_html($name . ' · ' . $change) . '</summary><p class="description"><code>' . esc_html($preset_id) . '</code></p><div class="wzf-mascot-template-columns">';
            foreach (['before'=>__('Before', 'live2d-show'),'after'=>__('After', 'live2d-show')] as $key=>$label) {
                echo '<div><h5>' . esc_html($label) . '</h5>'; wzf_mascot_template_preset_summary(($key === 'before' ? $old : $new)[$preset_id] ?? null); echo '</div>';
            }
            echo '</div></details>';
        }
        if ($plan['mapping']) {
            echo '<h4>' . esc_html__('Resource mapping', 'live2d-show') . '</h4><ul>';
            foreach ($plan['mapping'] as $row) {
                $channel = $row['channel'] === 'motion' ? __('Motion', 'live2d-show') : __('Expression', 'live2d-show');
                echo '<li>' . esc_html($row['preset'] . ' / ' . $channel) . ': <code>' . esc_html($row['file'] . ' → ' . $row['id']) . '</code></li>';
            }
            echo '</ul>';
        }
    } else echo '<p>' . esc_html__('Quick interactions are retained. Only dialogue will be replaced.', 'live2d-show') . '</p>';
}
function wzf_mascot_template_panel($config, $id) {
    global $wzf_mascot_template_review;
    $review = $wzf_mascot_template_review ?? null;
    if (is_array($review) && !isset($review['error']) && $review['character'] !== (string)$id) $review = null;
    echo '<section class="wzf-mascot-card"><details class="wzf-mascot-template"' . ($review ? ' open' : '') . '><summary>' . esc_html__('Interaction templates', 'live2d-show') . '</summary><p>' . esc_html__('Reuse your dialogue and quick interactions with a JSON file. Model files, account preferences, PNG permission and hit-area bindings are excluded. Uploading only previews changes; applying needs a separate confirmation.', 'live2d-show') . '</p>';
    $values = ['character'=>(string)$id,'version'=>wzf_mascot_config_version($config)];
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">'; wp_nonce_field('wzf_mascot_template_export'); wzf_mascot_template_hidden(['action'=>'wzf_mascot_template_export'] + $values); submit_button(__('Download interaction JSON', 'live2d-show'), 'secondary'); echo '</form>';
    echo '<form method="post" enctype="multipart/form-data" action="' . esc_url(add_query_arg(['page'=>'wzf-mascot','character'=>$id,'mascot_template_preview'=>'1'], admin_url('options-general.php'))) . '">';
    wp_nonce_field('wzf_mascot_template_preview'); wzf_mascot_template_hidden($values);
    echo '<div class="wzf-mascot-field"><label>' . esc_html__('Interaction JSON (up to 64 KiB)', 'live2d-show') . '<input type="file" name="template" accept=".json,application/json" required></label></div><p><label><input type="checkbox" name="include_presets" value="1"> ' . esc_html__('Also replace quick interactions', 'live2d-show') . '</label></p>';
    submit_button(__('Preview template changes', 'live2d-show'), 'secondary'); echo '</form>';
    if (isset($review['error'])) echo '<div class="notice notice-error inline" role="alert"><p>' . esc_html($review['error']) . '</p></div>';
    elseif ($review) {
        wzf_mascot_template_diff($review);
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">'; wp_nonce_field('wzf_mascot_template_apply');
        $fields = array_intersect_key($review, array_flip(['character','version','payload','scope','issued','signature']));
        wzf_mascot_template_hidden(['action'=>'wzf_mascot_template_apply'] + $fields);
        echo '<p><label><input type="checkbox" name="confirm" value="1" required> ' . esc_html__('I reviewed these changes and want to replace the selected interaction settings.', 'live2d-show') . '</label></p><p class="description">' . esc_html__('This preview expires after 15 minutes. Changes elsewhere require a fresh preview.', 'live2d-show') . '</p>';
        submit_button(__('Apply reviewed template', 'live2d-show')); echo '<a class="button" href="' . esc_url(add_query_arg('character', $id, admin_url('options-general.php?page=wzf-mascot'))) . '">' . esc_html__('Cancel preview', 'live2d-show') . '</a></form>';
    }
    echo '</details></section>';
}
add_action('admin_init', 'wzf_mascot_template_preview_gate');
add_action('admin_post_wzf_mascot_template_export', 'wzf_mascot_template_export_post');
add_action('admin_post_wzf_mascot_template_apply', 'wzf_mascot_template_apply_post');
