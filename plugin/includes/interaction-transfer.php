<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;

function wzf_mascot_template_fields($object, $keys) {
    if (!($object instanceof stdClass) || array_diff(array_keys(get_object_vars($object)), $keys) || array_diff($keys, array_keys(get_object_vars($object)))) throw new RuntimeException(__('Interaction template fields are invalid.', 'live2d-show'));
    return get_object_vars($object);
}
function wzf_mascot_template_path($value, $suffix) {
    if ($value === '') return '';
    $path = wzf_mascot_installed_reference($value);
    if (strlen($path) > 1024 || !str_ends_with($path, $suffix)) throw new RuntimeException(__('Template resource paths must be relative motion or expression files.', 'live2d-show'));
    return $path;
}
function wzf_mascot_interaction_json($raw) {
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
    return $object;
}
function wzf_mascot_template_decode($raw) {
    if (!is_string($raw) || strlen($raw) < 1 || strlen($raw) > 65536) throw new RuntimeException(__('Choose a valid interaction JSON file no larger than 64 KiB.', 'live2d-show'));
    $object = wzf_mascot_interaction_json($raw);
    $value = wzf_mascot_template_fields($object, ['type','schema','dialogue','presets']);
    if ($value['type'] !== 'wzf-mascot-interactions' || $value['schema'] !== 1) throw new RuntimeException(__('This interaction template type or version is not supported.', 'live2d-show'));
    $rules = wzf_mascot_template_fields($value['dialogue'], array_keys(wzf_mascot_line_events()));
    foreach ($rules as $event=>$object_rule) {
        $has_motions = $event === 'idle' && $object_rule instanceof stdClass && property_exists($object_rule, 'motionFiles');
        $rule = wzf_mascot_template_fields($object_rule, $has_motions ? ['enabled','cooldown','lines','motionFiles'] : ['enabled','cooldown','lines']);
        if ($has_motions) {
            $files = wzf_mascot_list($rule['motionFiles'], 'Chatter motion files');
            if (count($files) > 8 || count(array_unique($files, SORT_REGULAR)) !== count($files)) throw new RuntimeException(__('Choose up to 8 chatter motions from this character.', 'live2d-show'));
            $rule['motionFiles'] = array_map(function($file) { if ($file === '') throw new RuntimeException(__('Template resource paths must be relative motion or expression files.', 'live2d-show')); return wzf_mascot_template_path($file, '.motion3.json'); }, $files);
        }
        if (!is_bool($rule['enabled']) || !is_int($rule['cooldown'])) throw new RuntimeException(__('Dialogue settings are invalid.', 'live2d-show'));
        if (!is_array($rule['lines']) || count($rule['lines']) > 8) throw new RuntimeException(__('Use up to 8 plain-text lines per event, each at most 300 bytes.', 'live2d-show'));
        $rules[$event] = $rule;
    }
    $dialogue = wzf_mascot_dialogue($rules, true);
    if (array_key_exists('motionFiles', $rules['idle'])) $dialogue['idle']['motionFiles'] = $rules['idle']['motionFiles'];
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
    $dialogue = wzf_mascot_dialogue($c['dialogue'] ?? [], true);
    if (array_key_exists('motions', $dialogue['idle'])) {
        if (!empty($dialogue['idle']['motions']) && $motions === null) $motions = wzf_mascot_character_catalog($c);
        $files = [];
        foreach (wzf_mascot_chatter_motions($dialogue['idle']['motions'], $motions) as $id) {
            $file = $motions[$id]['file'];
            if (count(array_filter($motions, function($item) use ($file) { return $item['file'] === $file; })) !== 1) throw new RuntimeException(__('A preset resource cannot be mapped. Repair the preset before exporting.', 'live2d-show'));
            $files[] = $file;
        }
        unset($dialogue['idle']['motions']); $dialogue['idle']['motionFiles'] = $files;
    }
    return wzf_mascot_template_json(['type'=>'wzf-mascot-interactions','schema'=>1,'dialogue'=>$dialogue,'presets'=>$presets]);
}
function wzf_mascot_template_plan($config, $id, $version, $raw, $scope) {
    $c = wzf_mascot_template_character($config, $id, $version);
    if (!in_array($scope, ['dialogue','dialogue-presets'], true)) throw new RuntimeException(__('Interaction template fields are invalid.', 'live2d-show'));
    $template = wzf_mascot_template_decode($raw);
    $before = wzf_mascot_dialogue($c['dialogue'] ?? []);
    $dialogue = $template['dialogue'];
    // Import never turns chatter on. Empty imported lines still turn it off.
    $dialogue['idle']['enabled'] = ($before['idle']['enabled'] ?? false) && !!$dialogue['idle']['lines'];
    $files = $dialogue['idle']['motionFiles'] ?? null; unset($dialogue['idle']['motionFiles']);
    if (array_key_exists('motions', $before['idle'])) $dialogue['idle']['motions'] = $before['idle']['motions'];
    $mapping = []; $replace_pool = $scope === 'dialogue-presets' && $files !== null;
    if ($replace_pool) {
        $motions = $files ? wzf_mascot_character_catalog($c) : []; $pool = [];
        foreach ($files as $file) {
            $matches = []; foreach ($motions as $resource_id=>$item) if ($item['file'] === $file) $matches[] = (string)$resource_id;
            if (count($matches) !== 1) throw new RuntimeException(__('A template resource is missing or ambiguous in this character. Import dialogue only, or fix the matching catalog.', 'live2d-show'));
            $pool[] = $matches[0]; $mapping[] = ['preset'=>__('Occasional chatter', 'live2d-show'),'channel'=>'motion','file'=>$file,'id'=>$matches[0]];
        }
        $dialogue['idle']['motions'] = $pool;
    }
    $next = $c; $next['dialogue'] = $dialogue;
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
    return ['before'=>$c,'after'=>$next,'dialogueBefore'=>$before,'mapping'=>$mapping,'replaceChatterMotions'=>$replace_pool];
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
        if (!wzf_mascot_resources_update($config)) throw new RuntimeException(__('Cannot save character settings.', 'live2d-show'));
    }, 'settings');
}
function wzf_mascot_template_targets($value) {
    if (is_string($value)) {
        if (strlen($value) > 16384) throw new RuntimeException(__('Choose 1–50 target characters.', 'live2d-show'));
        try { $value = json_decode($value, true, 4, JSON_THROW_ON_ERROR); } catch (Throwable $e) { $value = null; }
    }
    if (!is_array($value) || !array_is_list($value) || count($value) < 1 || count($value) > 50) throw new RuntimeException(__('Choose 1–50 target characters.', 'live2d-show'));
    foreach ($value as $id) if (!is_string($id) || !preg_match('/\A[A-Za-z0-9_-]{1,200}\z/D', $id)) throw new RuntimeException(__('Choose 1–50 target characters.', 'live2d-show'));
    $value = array_values(array_unique($value)); sort($value, SORT_STRING); return $value;
}
function wzf_mascot_template_batch_plan($config, $targets, $version, $raw, $scope) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    $targets = wzf_mascot_template_targets($targets); $rows = []; $blocked = false;
    foreach ($targets as $id) {
        try { $rows[$id] = ['plan'=>wzf_mascot_template_plan($config, $id, $version, $raw, $scope)]; }
        catch (Throwable $e) { $rows[$id] = ['error'=>wzf_mascot_error_message($e)]; $blocked = true; }
    }
    return ['targets'=>$targets,'rows'=>$rows,'blocked'=>$blocked];
}
function wzf_mascot_template_batch_signature($targets, $version, $raw, $scope, $issued) {
    return hash_hmac('sha256', serialize(['batch',get_current_blog_id(),get_current_user_id(),wzf_mascot_template_targets($targets),$version,$raw,$scope,$issued]), wp_salt('nonce'));
}
function wzf_mascot_template_batch_preview($targets, $version, $raw, $scope) {
    $raw = wzf_mascot_template_json(wzf_mascot_template_decode($raw), false);
    $review = wzf_mascot_template_batch_plan(wzf_mascot_task_snapshot()['config'], $targets, $version, $raw, $scope);
    $issued = (string)time();
    return $review + ['batch'=>true,'version'=>$version,'payload'=>$raw,'scope'=>$scope,'issued'=>$issued,
        'signature'=>$review['blocked'] ? '' : wzf_mascot_template_batch_signature($review['targets'], $version, $raw, $scope, $issued)];
}
function wzf_mascot_template_batch_apply($targets, $version, $raw, $scope, $issued, $signature, $confirmed) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    $targets = wzf_mascot_template_targets($targets);
    if ($confirmed !== '1') throw new RuntimeException(__('Confirm the displayed interaction changes before applying.', 'live2d-show'));
    if (!is_string($issued) || !preg_match('/\A[0-9]{1,12}\z/D', $issued) || (int)$issued > time() || time()-(int)$issued > 900 || !is_string($signature) || !hash_equals(wzf_mascot_template_batch_signature($targets,$version,$raw,$scope,$issued),$signature)) throw new RuntimeException(__('This template preview expired or changed. Upload it again to review a fresh preview.', 'live2d-show'));
    $review = wzf_mascot_template_batch_plan(wzf_mascot_task_snapshot()['config'],$targets,$version,$raw,$scope);
    if ($review['blocked']) throw new RuntimeException(__('One or more targets are blocked. Nothing was applied.', 'live2d-show'));
    $task = wzf_mascot_task_begin('settings');
    try {
        $config = $task['config']; $review = wzf_mascot_template_batch_plan($config,$targets,$version,$raw,$scope);
        if ($review['blocked']) throw new RuntimeException(__('One or more targets are blocked. Nothing was applied.', 'live2d-show'));
        $changed = false;
        foreach ($review['rows'] as $id=>$row) if ($row['plan']['before'] !== $row['plan']['after']) { $config['characters'][$id]=$row['plan']['after']; $changed=true; }
        if ($changed && !wzf_mascot_resources_update($config)) throw new RuntimeException(__('Cannot save character settings.', 'live2d-show'));
    } finally { wzf_mascot_task_end($task); }
}
function wzf_mascot_template_batch_apply_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_template_batch_apply'); $id = is_string($_POST['character'] ?? null) ? wp_unslash($_POST['character']) : '';
    try {
        if (array_diff(array_keys($_POST), ['action','_wpnonce','_wp_http_referer','character','targets','version','payload','scope','issued','signature','confirm'])) throw new RuntimeException(__('Interaction template fields are invalid.', 'live2d-show'));
        $fields = wzf_mascot_template_post_fields(['targets','version','payload','scope','issued','signature','confirm']);
        wzf_mascot_template_batch_apply($fields['targets'],$fields['version'],$fields['payload'],$fields['scope'],$fields['issued'],$fields['signature'],$fields['confirm']);
        $notice = __('Reviewed template applied to all selected characters.', 'live2d-show');
    } catch (Throwable $e) { $notice = wzf_mascot_error_message($e); }
    wp_safe_redirect(add_query_arg(['mascot_notice'=>rawurlencode($notice),'character'=>$id],admin_url('options-general.php?page=wzf-mascot'))); exit;
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
        if (isset($_POST['targets'])) {
            $wzf_mascot_template_review = wzf_mascot_template_batch_preview(wp_unslash($_POST['targets']), $fields['version'], $raw, $scope);
            $wzf_mascot_template_review['character'] = $fields['character'];
        } else $wzf_mascot_template_review = wzf_mascot_template_preview($fields['character'], $fields['version'], $raw, $scope);
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
    // WordPress esc_attr preserves existing entities. Encode literal ampersands
    // first so HTML parsing cannot alter the exact signed payload bytes.
    foreach ($values as $key=>$value) echo '<input type="hidden" name="' . esc_attr($key) . '" value="' . esc_attr(str_replace('&', '&amp;', $value)) . '">';
}
function wzf_mascot_template_literal($value) {
    // Preview user text exactly as frontend textContent will display it.
    return esc_html(str_replace('&', '&amp;', (string)$value));
}
function wzf_mascot_template_rule_summary($rule) {
    $label = !empty($rule['enabled']) ? __('Enabled', 'live2d-show') : __('Disabled', 'live2d-show');
    echo '<p><strong>' . esc_html($label) . '</strong> · ' . esc_html(sprintf(__('Cooldown: %s seconds', 'live2d-show'), (string)($rule['cooldown'] ?? 60))) . '</p>';
    if (array_key_exists('motions', $rule)) echo '<p>' . esc_html__('Chatter motions (up to 8)', 'live2d-show') . ': ' . esc_html(implode(', ', $rule['motions']) ?: __('None', 'live2d-show')) . '</p>';
    echo '<pre>' . ($rule['lines'] ? wzf_mascot_template_literal(implode("\n", $rule['lines'])) : esc_html__('None', 'live2d-show')) . '</pre>';
}
function wzf_mascot_template_preset_summary($row) {
    if ($row === null) { echo '<p>' . esc_html__('None', 'live2d-show') . '</p>'; return; }
    echo '<dl class="wzf-mascot-template-preset">';
    foreach (['name'=>__('Preset name', 'live2d-show'),'motion'=>__('Motion', 'live2d-show'),'expression'=>__('Expression', 'live2d-show'),'line'=>__('Preset line', 'live2d-show')] as $field=>$label) {
        echo '<dt>' . esc_html($label) . '</dt><dd>' . ($row[$field] !== '' ? wzf_mascot_template_literal($row[$field]) : esc_html__('None', 'live2d-show')) . '</dd>';
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
    echo '<p>' . esc_html($plan['replaceChatterMotions'] ? __('Chatter motions will be replaced.', 'live2d-show') : __('Current chatter motions are retained.', 'live2d-show')) . '</p>';
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
            echo '<details class="wzf-mascot-replace wzf-mascot-template-change"' . ($same ? '' : ' open') . '><summary>' . wzf_mascot_template_literal($name) . ' · ' . esc_html($change) . '</summary><p class="description"><code>' . wzf_mascot_template_literal($preset_id) . '</code></p><div class="wzf-mascot-template-columns">';
            foreach (['before'=>__('Before', 'live2d-show'),'after'=>__('After', 'live2d-show')] as $key=>$label) {
                echo '<div><h5>' . esc_html($label) . '</h5>'; wzf_mascot_template_preset_summary(($key === 'before' ? $old : $new)[$preset_id] ?? null); echo '</div>';
            }
            echo '</div></details>';
        }
        if ($plan['mapping']) {
            echo '<h4>' . esc_html__('Resource mapping', 'live2d-show') . '</h4><ul>';
            foreach ($plan['mapping'] as $row) {
                $channel = $row['channel'] === 'motion' ? __('Motion', 'live2d-show') : __('Expression', 'live2d-show');
                echo '<li>' . wzf_mascot_template_literal($row['preset']) . ' / ' . esc_html($channel) . ': <code>' . wzf_mascot_template_literal($row['file'] . ' → ' . $row['id']) . '</code></li>';
            }
            echo '</ul>';
        }
    } else echo '<p>' . esc_html__('Quick interactions are retained. Only dialogue will be replaced.', 'live2d-show') . '</p>';
}
function wzf_mascot_template_panel($config, $id) {
    global $wzf_mascot_template_review;
    $review = $wzf_mascot_template_review ?? null;
    if (is_array($review) && !isset($review['error']) && empty($review['batch']) && ($review['character'] ?? null) !== (string)$id) $review = null;
    echo '<section class="wzf-mascot-card"><details class="wzf-mascot-template"' . ($review ? ' open' : '') . '><summary>' . esc_html__('Interaction templates', 'live2d-show') . '</summary><p>' . esc_html__('Reuse your dialogue and quick interactions with a JSON file. Model files, account preferences, PNG permission and hit-area bindings are excluded. Uploading only previews changes; applying needs a separate confirmation.', 'live2d-show') . '</p>';
    $values = ['character'=>(string)$id,'version'=>wzf_mascot_config_version($config)];
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">'; wp_nonce_field('wzf_mascot_template_export'); wzf_mascot_template_hidden(['action'=>'wzf_mascot_template_export'] + $values); submit_button(__('Download interaction JSON', 'live2d-show'), 'secondary'); echo '</form>';
    echo '<form method="post" enctype="multipart/form-data" action="' . esc_url(add_query_arg(['page'=>'wzf-mascot','character'=>$id,'mascot_template_preview'=>'1'], admin_url('options-general.php'))) . '">';
    wp_nonce_field('wzf_mascot_template_preview'); wzf_mascot_template_hidden($values);
    echo '<div class="wzf-mascot-field"><label>' . esc_html__('Interaction JSON (up to 64 KiB)', 'live2d-show') . '<input type="file" name="template" accept=".json,application/json" required></label></div><p><label><input type="checkbox" name="include_presets" value="1"> ' . esc_html__('Also replace quick interactions and chatter motions', 'live2d-show') . '</label></p>';
    echo '<fieldset><legend>' . esc_html__('Target characters (up to 50)', 'live2d-show') . '</legend><div class="wzf-mascot-checks">';
    foreach ($config['characters'] as $target_id=>$target) if (is_array($target) && wzf_mascot_character_status($target) !== 'trash') echo '<label><input type="checkbox" name="targets[]" value="' . esc_attr($target_id) . '" ' . checked((string)$target_id, (string)$id, false) . '> ' . esc_html((is_string($target['name'] ?? null) ? $target['name'] : (string)$target_id) . ' · ' . $target_id) . '</label>';
    echo '</div><p class="description">' . esc_html__('Select every character you want to update. Review all targets before applying.', 'live2d-show') . '</p></fieldset>';
    submit_button(__('Preview template changes', 'live2d-show'), 'secondary'); echo '</form>';
    if (isset($review['error'])) echo '<div class="notice notice-error inline" role="alert"><p>' . esc_html($review['error']) . '</p></div>';
    elseif ($review) {
        if (!empty($review['batch'])) {
            foreach ($review['rows'] as $target_id=>$row) {
                echo '<details class="wzf-mascot-replace"><summary>' . esc_html((is_string($config['characters'][$target_id]['name'] ?? null) ? $config['characters'][$target_id]['name'] : (string)$target_id) . ' · ' . $target_id . ' · ' . (isset($row['error']) ? __('Blocked', 'live2d-show') : ($row['plan']['before'] === $row['plan']['after'] ? __('Unchanged', 'live2d-show') : __('Changed', 'live2d-show')))) . '</summary>';
                if (isset($row['error'])) echo '<p>' . esc_html($row['error']) . '</p>'; else wzf_mascot_template_diff(['plan'=>$row['plan'],'scope'=>$review['scope']]);
                echo '</details>';
            }
            if ($review['blocked']) { echo '<p role="alert">' . esc_html__('One or more targets are blocked. Nothing was applied.', 'live2d-show') . '</p></details></section>'; return; }
        } else wzf_mascot_template_diff($review);
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">'; wp_nonce_field(!empty($review['batch']) ? 'wzf_mascot_template_batch_apply' : 'wzf_mascot_template_apply');
        $fields = array_intersect_key($review, array_flip(['character','version','payload','scope','issued','signature']));
        if (!empty($review['batch'])) $fields['targets'] = wp_json_encode($review['targets']);
        wzf_mascot_template_hidden(['action'=>!empty($review['batch']) ? 'wzf_mascot_template_batch_apply' : 'wzf_mascot_template_apply'] + $fields);
        echo '<p><label><input type="checkbox" name="confirm" value="1" required> ' . esc_html__('I reviewed these changes and want to replace the selected interaction settings.', 'live2d-show') . '</label></p><p class="description">' . esc_html__('This preview expires after 15 minutes. Changes elsewhere require a fresh preview.', 'live2d-show') . '</p>';
        submit_button(__('Apply reviewed template', 'live2d-show')); echo '<a class="button" href="' . esc_url(add_query_arg('character', $id, admin_url('options-general.php?page=wzf-mascot'))) . '">' . esc_html__('Cancel preview', 'live2d-show') . '</a></form>';
    }
    echo '</details></section>';
}
add_action('admin_init', 'wzf_mascot_template_preview_gate');
add_action('admin_post_wzf_mascot_template_export', 'wzf_mascot_template_export_post');
add_action('admin_post_wzf_mascot_template_apply', 'wzf_mascot_template_apply_post');

add_action('admin_post_wzf_mascot_template_batch_apply', 'wzf_mascot_template_batch_apply_post');
