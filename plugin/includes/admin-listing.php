<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;
function wzf_mascot_character_listing($characters, $rows, $query) {
    $search = isset($query['mascot_search']) && is_string($query['mascot_search']) ? trim(wp_unslash($query['mascot_search'])) : '';
    if (strlen($search) > 200) $search = '';
    $filter = isset($query['mascot_status']) && is_string($query['mascot_status']) ? $query['mascot_status'] : 'all';
    if (!in_array($filter, ['all','active','disabled','trash','isolated','ready'], true)) $filter = 'all';
    $health = array_column($rows, null, 'id');
    $counts = array_fill_keys(['all','active','disabled','trash','isolated','ready'], 0);
    $result = [];
    foreach ($characters as $id=>$character) {
        $status = is_array($character) ? wzf_mascot_character_status($character) : 'invalid';
        $ok = $health[(string)$id]['ok'] ?? false;
        $counts['all']++;
        if (is_string($status) && isset($counts[$status])) $counts[$status]++;
        if (!$ok) $counts['isolated']++;
        if ($ok && $status === 'active') $counts['ready']++;
        $name = is_array($character) && is_string($character['name'] ?? null) ? $character['name'] : '';
        $contains = function($text) use ($search) { return function_exists('mb_stripos') ? mb_stripos($text, $search, 0, 'UTF-8') !== false : stripos($text, $search) !== false; };
        if ($search !== '' && !$contains((string)$id) && !$contains($name)) continue;
        if ($filter !== 'all' && !($filter === 'isolated' ? !$ok : ($filter === 'ready' ? $ok && $status === 'active' : $status === $filter))) continue;
        $result[$id] = $character;
    }
    return ['characters'=>$result, 'search'=>$search, 'filter'=>$filter, 'counts'=>$counts];
}
function wzf_mascot_character_search($listing) {
    $labels = ['all'=>__('All', 'live2d-show'),'active'=>__('Active', 'live2d-show'),'disabled'=>__('Disabled', 'live2d-show'),'trash'=>__('Trash', 'live2d-show'),'isolated'=>__('Isolated', 'live2d-show'),'ready'=>__('Display entry ready', 'live2d-show')];
    echo '<form method="get" class="wzf-mascot-search" action="' . esc_url(admin_url('options-general.php')) . '"><input type="hidden" name="page" value="wzf-mascot"><label for="mascot-search">' . esc_html__('Search name or character ID', 'live2d-show') . '</label><input type="search" id="mascot-search" name="mascot_search" maxlength="200" value="' . esc_attr($listing['search']) . '"><label for="mascot-status">' . esc_html__('Status', 'live2d-show') . '</label><select id="mascot-status" name="mascot_status">';
    foreach ($labels as $key=>$label) echo '<option value="' . esc_attr($key) . '" ' . selected($listing['filter'], $key, false) . '>' . esc_html(sprintf(__('%1$s (%2$s)', 'live2d-show'), $label, number_format_i18n($listing['counts'][$key]))) . '</option>';
    echo '</select><button class="button">' . esc_html__('Search', 'live2d-show') . '</button><a class="button" href="' . esc_url(admin_url('options-general.php?page=wzf-mascot')) . '">' . esc_html__('Clear filters', 'live2d-show') . '</a></form><p role="status" aria-live="polite">' . esc_html(sprintf(_n('%1$s of %2$s character shown.', '%1$s of %2$s characters shown.', count($listing['characters']), 'live2d-show'), number_format_i18n(count($listing['characters'])), number_format_i18n($listing['counts']['all']))) . '</p>';
}
