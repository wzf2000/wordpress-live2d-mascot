<?php
// GPL-2.0-or-later with the additional permission in LICENSE.
if (!defined('ABSPATH')) exit;

function wzf_mascot_interaction_text($value, $limit, $message) {
    try { return wzf_mascot_plain_text($value, $limit); }
    catch (Throwable $e) { throw new RuntimeException($message); }
}
function wzf_mascot_line_events() {
    return ['welcome'=>__('Welcome', 'live2d-show'), 'click'=>__('Click', 'live2d-show'), 'morning'=>__('Morning', 'live2d-show'), 'afternoon'=>__('Afternoon', 'live2d-show'), 'evening'=>__('Evening', 'live2d-show'), 'return'=>__('Return after absence', 'live2d-show'), 'idle'=>__('Occasional chatter', 'live2d-show')];
}
// Optional presentation never participates in whole-character isolation.
function wzf_mascot_dialogue($value, $strict = false) {
    $result = [];
    foreach (wzf_mascot_line_events() as $event=>$label) {
        try {
            $rule = is_array($value) ? ($value[$event] ?? []) : [];
            if (!is_array($rule)) throw new RuntimeException(__('Dialogue settings are invalid.', 'live2d-show'));
            $enabled = $rule['enabled'] ?? false;
            $cooldown = $rule['cooldown'] ?? ($event === 'idle' ? 120 : 60);
            if ($event === 'idle' && (!is_int($cooldown) || $cooldown < 90 || $cooldown > 1800)) throw new RuntimeException(__('Chatter cooldown must be 90–1800 seconds.', 'live2d-show'));
            if (!is_bool($enabled) || !is_int($cooldown) || $cooldown < 15 || $cooldown > 3600) throw new RuntimeException(__('Dialogue cooldown must be 15–3600 seconds.', 'live2d-show'));
            $lines = wzf_mascot_list($rule['lines'] ?? [], 'Lines');
            if (count($lines) > 8) throw new RuntimeException(__('Use up to 8 plain-text lines per event, each at most 300 bytes.', 'live2d-show'));
            $valid = [];
            foreach ($lines as $line) {
                $line = trim(wzf_mascot_interaction_text($line, 300, __('Dialogue lines must be plain text without markup or control characters, within 300 bytes.', 'live2d-show')));
                if ($line !== '') $valid[] = $line;
            }
            $result[$event] = ['enabled'=>$enabled && !!$valid, 'cooldown'=>$cooldown, 'lines'=>array_values(array_unique($valid))];
        } catch (Throwable $e) { if ($strict) throw $e; }
    }
    return $result;
}
function wzf_mascot_save_interaction($id, $version, $dialogue) {
    if (!current_user_can('manage_options')) throw new RuntimeException(__('Administrator permission is required.', 'live2d-show'));
    if (!is_string($id) || !is_string($version) || !preg_match('/\A[0-9a-f]{64}\z/D', $version) || !is_array($dialogue)) throw new RuntimeException(__('Dialogue settings are invalid.', 'live2d-show'));
    $dialogue = wzf_mascot_dialogue($dialogue, true);
    $task = wzf_mascot_task_begin('settings');
    try {
        $config = $task['config'];
        if (!hash_equals(wzf_mascot_config_version($config), $version)) throw new RuntimeException(__('Another request changed the resource configuration. Refresh before editing again.', 'live2d-show'));
        if (!is_array($config['characters'][$id] ?? null)) throw new RuntimeException(__('The character does not exist or its configuration is invalid.', 'live2d-show'));
        if (($config['characters'][$id]['dialogue'] ?? null) === $dialogue) return;
        $config['characters'][$id]['dialogue'] = $dialogue;
        if (!update_option(WZF_MASCOT_OPTION, $config, false)) throw new RuntimeException(__('Cannot save character settings.', 'live2d-show'));
    } finally { wzf_mascot_task_end($task); }
}
function wzf_mascot_interaction_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_interaction');
    $id = is_string($_POST['character'] ?? null) ? wp_unslash($_POST['character']) : '';
    try {
        $rules = [];
        foreach (wzf_mascot_line_events() as $event=>$label) {
            $row = $_POST['dialogue'][$event] ?? [];
            if (!is_array($row) || !is_string($row['lines'] ?? null) || strlen($row['lines']) > 2408 || !is_string($row['cooldown'] ?? null) || !preg_match('/\A[0-9]{1,4}\z/D', $row['cooldown']) || (isset($row['enabled']) && $row['enabled'] !== '1')) throw new RuntimeException(__('Dialogue settings are invalid.', 'live2d-show'));
            $rules[$event] = ['enabled'=>isset($row['enabled']), 'cooldown'=>(int)$row['cooldown'], 'lines'=>preg_split('/\r\n|\r|\n/', wp_unslash($row['lines']))];
        }
        wzf_mascot_save_interaction($id, is_string($_POST['version'] ?? null) ? wp_unslash($_POST['version']) : '', $rules);
        $notice = __('Dialogue settings saved.', 'live2d-show');
    } catch (Throwable $e) { $notice = wzf_mascot_error_message($e); }
    wp_safe_redirect(add_query_arg(['mascot_notice'=>rawurlencode($notice), 'character'=>$id], admin_url('options-general.php?page=wzf-mascot')));
    exit;
}
// Administrator-only suggestions. This library is never part of frontend configuration.
function wzf_mascot_dialogue_drafts() {
    return [
        'quiet'=>['name'=>__('Quiet company', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')],
            'click'=>[__('I am here.', 'live2d-show')],
            'morning'=>[__('A calm start to the day.', 'live2d-show')],
            'afternoon'=>[__('Pause for a breath when you need one.', 'live2d-show')],
            'evening'=>[__('Let us take the evening slowly.', 'live2d-show')],
            'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('A small pause can make room for a new thought.', 'live2d-show'),__('There is no hurry. I will keep you company.', 'live2d-show')],
        ],'sources'=>[]],
        'bright'=>['name'=>__('Cheerful greeting', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Hello! Ready to begin?', 'live2d-show')],
            'click'=>[__('Here I am!', 'live2d-show')],
            'morning'=>[__('A fresh morning, a fresh start!', 'live2d-show')],
            'afternoon'=>[__('Time for a little stretch!', 'live2d-show')],
            'evening'=>[__('You have made it through another day.', 'live2d-show')],
            'return'=>[__('You are back! Shall we continue?', 'live2d-show')],
            'idle'=>[__('One small step at a time!', 'live2d-show'),__('A sip of water and we are ready again.', 'live2d-show')],
        ],'sources'=>[]],
        'reading'=>['name'=>__('Reading companion', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Choose something interesting. I will keep you company.', 'live2d-show')],
            'click'=>[__('What shall we read next?', 'live2d-show')],
            'morning'=>[__('A new page for a new day.', 'live2d-show')],
            'afternoon'=>[__('A short pause may help the next paragraph.', 'live2d-show')],
            'evening'=>[__('One more page, or a well-earned rest?', 'live2d-show')],
            'return'=>[__('Welcome back to your reading.', 'live2d-show')],
            'idle'=>[__('You can leave a thought to revisit later.', 'live2d-show'),__('A difficult paragraph can wait while you take a breath.', 'live2d-show')],
        ],'sources'=>[]],
        'character-haru'=>['name'=>'Haru','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Hello! Where would you like to begin today?', 'live2d-show'),__('Found something you like? Stay a little longer.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/haru/']]],
        'character-mao'=>['name'=>'虹色まお · Mao','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('If today were a color, which would you choose?', 'live2d-show'),__('Draw a little circle in the air and add a little cheer.', 'live2d-show'),__('Hat on tight! Let us take our time exploring.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://note.com/live2dnote/n/nb2c8302a7e25'],['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/niziiro-mao/']]],
        'character-hiyori'=>['name'=>'桃瀬ひより · Hiyori','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Welcome back. Find a comfortable pace for your reading.', 'live2d-show'),__('A pause can reveal details you missed before.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/momose-hiyori/']]],
        'character-mark'=>['name'=>'Mark-kun','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Reading team, assemble! Pick an interesting title.', 'live2d-show'),__('I am ready! How about your curiosity?', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/']]],
        'character-rice'=>['name'=>'Rice Glassfield','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Ready? Let us tackle a new question today.', 'live2d-show'),__('Understand this stage first, then keep moving.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/rice-glassfield/']]],
        'character-wanko'=>['name'=>'Wankoromochi','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Woof! A soft little hello for you.', 'live2d-show'),__('Woof! Take a break, then keep exploring.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/wankoromochi/']]],
        'character-ren'=>['name'=>'Ren Foster','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Hello. What has caught your curiosity today?', 'live2d-show'),__('Take your time and work through one question at a time.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/ren-foster/']]],
        'character-epsilon'=>['name'=>'Epsilon','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Welcome. Start with what you most want to understand.', 'live2d-show'),__('A small question can lead to an interesting discovery.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/']]],
        'character-chitose'=>['name'=>'Chitose','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Hello. Let us find something new today.', 'live2d-show'),__('When an idea gets stuck, try another angle.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/']]],
        'character-hibiki'=>['name'=>'Hibiki','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Hello again! Leave a little unhurried time in your day.', 'live2d-show'),__('Even when reading gets absorbing, give your eyes a rest.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/hibiki/']]],
        'character-izumi'=>['name'=>'Izumi','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('A different angle may reveal something new.', 'live2d-show'),__('What detail made you want to look twice today?', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/']]],
        'character-haruto'=>['name'=>'春翔 · Haruto','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Let us go! Find the answer you most want to know.', 'live2d-show'),__('A little step is still progress today!', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/']]],
        'character-koharu'=>['name'=>'小春 · Koharu','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Hello! Let us collect a little discovery today.', 'live2d-show'),__('Found something you like? Leave yourself a bookmark.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/']]],
        'character-ni-j'=>['name'=>'Ni-j','note'=>__('Background unverified; these drafts use a neutral voice.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Hello. It is good to see you here.', 'live2d-show'),__('What would you like to explore today?', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[]],
        'character-nico'=>['name'=>'Nico','note'=>__('Background unverified; these drafts use a neutral voice.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Welcome. Take your time looking around.', 'live2d-show'),__('An interesting discovery often starts with a small question.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[]],
        'character-nietzsche'=>['name'=>'Nietzsche','note'=>__('Background unverified; these drafts use a neutral voice.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Hello. Leave a little room for curiosity today.', 'live2d-show'),__('Getting one question clear is already a good start.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[]],
        'character-nipsilon'=>['name'=>'Nipsilon','note'=>__('Background unverified; these drafts use a neutral voice.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Welcome. I hope you find something here.', 'live2d-show'),__('Pause and see whether you missed a clue.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[]],
        'character-nito'=>['name'=>'Nito','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Hey! Is your curiosity awake today?', 'live2d-show'),__('No rush. A little at a time is fine!', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/nito/']]],
        'character-shizuku'=>['name'=>'雫 · Shizuku','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Hello. What would you like to talk about today?', 'live2d-show'),__('Slowing down can help you hear your own thoughts.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/shizuku/']]],
        'character-tororo'=>['name'=>'白猫 · Tororo','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Meow. This corner is perfect for a quiet moment.', 'live2d-show'),__('Purr... Take your time. I will keep you company.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/']]],
        'character-hijiki'=>['name'=>'黑猫 · Hijiki','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Meow? Found something new?', 'live2d-show'),__('Have a stretch, then carry on. Meow.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/']]],
        'character-gantzert_felixander'=>['name'=>'Gantzert & Felixander','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Swordsman and dragon ready! Which page shall we explore?', 'live2d-show'),__('A new clue lies ahead. Keep a steady pace.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Live2D source','url'=>'https://www.live2d.com/en/learn/sample/gantzert-felixander/']]],
        'character-misaka-summer'=>['name'=>'御坂美琴 · 夏季校服','note'=>__('Original voice examples. Source links provide context, not official dialogue.', 'live2d-show'),'lines'=>[
            'welcome'=>[__('Good to see you. Take your time.', 'live2d-show')], 'return'=>[__('Welcome back. We can continue at your pace.', 'live2d-show')],
            'idle'=>[__('Break a tough problem into pieces and solve them one by one!', 'live2d-show'),__('That little charm... it is pretty cute.', 'live2d-show'),__('Hey, take a break if you have been reading too long. You need energy to keep going.', 'live2d-show'),__('Take your time. Just finish this small section first.', 'live2d-show'),__('Have a stretch, then keep discovering interesting things.', 'live2d-show'),__('Want a new topic? Start with a small question.', 'live2d-show')],
        ],'sources'=>[['title'=>'Character source','url'=>'https://toaru-project.com/railgun_t/chara/mikoto.html']]],
    ];
}
function wzf_mascot_dialogue_draft_controls() {
    if (!current_user_can('manage_options')) return;
    $drafts = wzf_mascot_dialogue_drafts();
    echo '<div class="wzf-mascot-drafts" data-filled-message="' . esc_attr__('Draft filled into empty fields. Review and save to apply.', 'live2d-show') . '"><label>' . esc_html__('Dialogue draft', 'live2d-show') . '<select class="wzf-mascot-draft-select">';
    foreach ($drafts as $key=>$draft) echo '<option value="' . esc_attr($key) . '">' . esc_html($draft['name']) . '</option>';
    echo '</select></label> <button type="button" class="button wzf-mascot-fill-dialogue">' . esc_html__('Fill blank dialogue', 'live2d-show') . '</button><p>' . esc_html__('Original editorial examples, not official character dialogue. Choose a draft manually. Only empty fields are filled; review and save the form to apply. Chatter still requires each reader to opt in.', 'live2d-show') . '</p><div class="wzf-mascot-draft-sources"></div><p class="wzf-mascot-draft-status" role="status"></p><script type="application/json" class="wzf-mascot-draft-data">' . wp_json_encode($drafts, JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT) . '</script></div>';
}
function wzf_mascot_interaction_panel($config, $id) {
    $rules = wzf_mascot_dialogue($config['characters'][$id]['dialogue'] ?? []);
    echo '<section class="wzf-mascot-card"><h2>' . esc_html__('Character dialogue', 'live2d-show') . '</h2><p class="description">' . esc_html__('Optional local text only. One alternative per line; up to 8 lines per event and 300 bytes per line. Occasional chatter also requires a reader opt-in and waits 1–2 cooldown periods (90–1800 seconds). Return requires at least 60 seconds away. Readers can choose automatic, active only or silent.', 'live2d-show') . '</p><form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    wp_nonce_field('wzf_mascot_interaction');
    wzf_mascot_dialogue_draft_controls();
    echo '<input type="hidden" name="action" value="wzf_mascot_interaction"><input type="hidden" name="character" value="' . esc_attr($id) . '"><input type="hidden" name="version" value="' . esc_attr(wzf_mascot_config_version($config)) . '"><div class="wzf-mascot-fields">';
    foreach (wzf_mascot_line_events() as $event=>$label) {
        $rule = $rules[$event] ?? ['enabled'=>false,'cooldown'=>$event === 'idle' ? 120 : 60,'lines'=>[]];
        $prefix = 'dialogue[' . $event . ']';
        echo '<fieldset class="wzf-mascot-field"><legend>' . esc_html($label) . '</legend><label><input type="checkbox" name="' . esc_attr($prefix . '[enabled]') . '" value="1" ' . checked($rule['enabled'], true, false) . '> ' . esc_html__('Enable dialogue', 'live2d-show') . '</label><label>' . esc_html__('Cooldown (seconds)', 'live2d-show') . '<input type="number" min="' . ($event === 'idle' ? '90' : '15') . '" max="' . ($event === 'idle' ? '1800' : '3600') . '" required name="' . esc_attr($prefix . '[cooldown]') . '" value="' . esc_attr($rule['cooldown']) . '"></label><label>' . esc_html__('Alternative lines', 'live2d-show') . '<textarea rows="3" name="' . esc_attr($prefix . '[lines]') . '">' . esc_textarea(implode("\n", $rule['lines'])) . '</textarea></label></fieldset>';
    }
    echo '</div>'; submit_button(__('Save dialogue settings', 'live2d-show')); echo '</form></section>';
}
add_action('admin_post_wzf_mascot_interaction', 'wzf_mascot_interaction_post');

// Read expressions independently; optional preset failures never isolate a role.
function wzf_mascot_character_expressions($character) {
    $u = wzf_mascot_uploads();
    $root = wzf_mascot_no_links($u['path'] . '/' . wzf_mascot_path(rtrim($character['root'] ?? '', '/')));
    $catalog = wzf_mascot_json(@file_get_contents(wzf_mascot_no_links($root . '/catalog.json')));
    $items = wzf_mascot_list($catalog['expressions'] ?? [], 'Expressions');
    if (count($items) > 1000) throw new RuntimeException(__('Expression catalog is too large.', 'live2d-show'));
    $result = [];
    foreach ($items as $item) {
        $id = wzf_mascot_plain_text($item['id'] ?? null, 200, true);
        $file = wzf_mascot_path($item['file'] ?? null);
        $path = wzf_mascot_no_links($root . '/' . $file);
        if (isset($result[$id]) || !str_ends_with($file, '.exp3.json') || !is_file($path) || !is_readable($path) || filesize($path) > 8 * 1024 * 1024) throw new RuntimeException(__('Expression catalog is invalid.', 'live2d-show'));
        $result[$id] = ['file'=>$file, 'label'=>is_string($item['label'] ?? null) ? $item['label'] : $id];
    }
    return $result;
}
function wzf_mascot_presets($value, $motions, $expressions, $strict = false) {
    $result = []; $ids = [];
    if (!is_array($value) || !array_is_list($value) || count($value) > 8) {
        if ($strict) throw new RuntimeException(__('Use up to 8 interaction presets.', 'live2d-show'));
        return [];
    }
    foreach ($value as $row) {
        try {
            if (!is_array($row) || array_diff(array_keys($row), ['id','name','motion','expression','line'])) throw new RuntimeException(__('Interaction preset is invalid.', 'live2d-show'));
            $preset = [];
            foreach (['id'=>64,'name'=>80,'motion'=>200,'expression'=>200,'line'=>300] as $key=>$limit) $preset[$key] = trim(wzf_mascot_interaction_text($row[$key] ?? '', $limit, __('Preset fields must be plain text within the stated limits.', 'live2d-show')));
            if ($preset['name'] === '' && $preset['motion'] === '' && $preset['expression'] === '' && $preset['line'] === '') continue;
            if (!preg_match('/\A[a-z][a-z0-9-]{0,63}\z/D', $preset['id']) || isset($ids[$preset['id']]) || $preset['name'] === '' || ($preset['motion'] === '' && $preset['expression'] === '' && $preset['line'] === '')) throw new RuntimeException(__('A preset needs a name and at least one motion, expression or line.', 'live2d-show'));
            if (($motions !== null && $preset['motion'] !== '' && !isset($motions[$preset['motion']])) || ($expressions !== null && $preset['expression'] !== '' && !isset($expressions[$preset['expression']]))) throw new RuntimeException(__('Preset motion or expression is not in the current catalog.', 'live2d-show'));
            $ids[$preset['id']] = true; $result[] = $preset;
        } catch (Throwable $e) { if ($strict) throw $e; }
    }
    return $result;
}
function wzf_mascot_current_presets($character) {
    if (empty($character['presets'])) return [];
    try { $motions = wzf_mascot_character_catalog($character); } catch (Throwable $e) { $motions = []; }
    try { $expressions = wzf_mascot_character_expressions($character); } catch (Throwable $e) { $expressions = []; }
    return wzf_mascot_presets($character['presets'], $motions, $expressions);
}
function wzf_mascot_save_presets($id, $version, $presets) {
    wzf_mascot_locked_character($id, $version, function($config) use ($id, $presets) {
        $c = $config['characters'][$id];
        $next = wzf_mascot_presets($presets, wzf_mascot_character_catalog($c), wzf_mascot_character_expressions($c), true);
        if (($c['presets'] ?? []) === $next && empty($c['presetWarnings'])) return;
        $config['characters'][$id]['presets'] = $next;
        unset($config['characters'][$id]['presetWarnings']);
        if (isset($c['hitBindings'])) {
            $filtered = wzf_mascot_hit_bindings($c['hitBindings'], null, $next);
            $config['characters'][$id]['hitBindings'] = $filtered;
            $config['characters'][$id]['hitWarnings'] = is_array($c['hitBindings']) ? max(0,count($c['hitBindings'])-count($filtered)) : 1;
        }
        if (!update_option(WZF_MASCOT_OPTION, $config, false)) throw new RuntimeException(__('Cannot save character settings.', 'live2d-show'));
    }, 'settings');
}
function wzf_mascot_presets_post() {
    if (!current_user_can('manage_options')) wp_die(__('Administrator permission is required.', 'live2d-show'), '', ['response'=>403]);
    check_admin_referer('wzf_mascot_presets');
    $id = is_string($_POST['character'] ?? null) ? wp_unslash($_POST['character']) : '';
    try {
        wzf_mascot_save_presets($id, is_string($_POST['version'] ?? null) ? wp_unslash($_POST['version']) : '', wp_unslash($_POST['presets'] ?? []));
        $notice = __('Interaction presets saved.', 'live2d-show');
    } catch (Throwable $e) { $notice = wzf_mascot_error_message($e); }
    wp_safe_redirect(add_query_arg(['mascot_notice'=>rawurlencode($notice), 'character'=>$id], admin_url('options-general.php?page=wzf-mascot'))); exit;
}
function wzf_mascot_presets_panel($config, $id) {
    $c = $config['characters'][$id]; $presets = wzf_mascot_current_presets($c);
    echo '<section class="wzf-mascot-card"><h2>' . esc_html__('Quick interactions', 'live2d-show') . '</h2><p class="description">' . esc_html__('Up to 8 named combinations. Choose a motion, an expression, a plain-text line, or combine them. Leave all fields blank to remove a preset. Names: 80 bytes; lines: 300 bytes. Playback always starts from a reader action.', 'live2d-show') . '</p>';
    if (!empty($c['presetWarnings']) || (isset($c['presets']) && $presets !== $c['presets'])) echo '<div class="notice notice-warning inline"><p>' . esc_html__('Some presets are invalid or could not follow the resource update and were skipped. Review and save valid presets. The character remains available.', 'live2d-show') . '</p></div>';
    try { $motions = wzf_mascot_character_motions($c); $expressions = array_map(function($item) {return $item['label'];}, wzf_mascot_character_expressions($c)); }
    catch (Throwable $e) { echo '<p>' . esc_html(wzf_mascot_error_message($e)) . '</p></section>'; return; }
    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">'; wp_nonce_field('wzf_mascot_presets');
    echo '<input type="hidden" name="action" value="wzf_mascot_presets"><input type="hidden" name="character" value="' . esc_attr($id) . '"><input type="hidden" name="version" value="' . esc_attr(wzf_mascot_config_version($config)) . '">';
    $greeting = '';
    foreach (array_merge($c['greetings'] ?? [], [$c['welcome'] ?? '']) as $candidate) if (is_string($candidate) && isset($motions[$candidate])) { $greeting = $candidate; break; }
    $drafts = [['name'=>__('Say hello', 'live2d-show'),'line'=>__('Hello! I am here to keep you company.', 'live2d-show'),'motion'=>$greeting], ['name'=>__('Take a break', 'live2d-show'),'line'=>__('Rest your eyes for a moment.', 'live2d-show'),'motion'=>''], ['name'=>__('Continue reading', 'live2d-show'),'line'=>__('Ready when you are. Let us continue.', 'live2d-show'),'motion'=>'']];
    echo '<button type="button" class="button wzf-mascot-fill-presets" data-drafts="' . esc_attr(wp_json_encode($drafts)) . '">' . esc_html__('Fill common interaction drafts', 'live2d-show') . '</button><p>' . esc_html__('Only empty slots are filled. Review the text and existing greeting motion before saving; no changes are saved automatically.', 'live2d-show') . '</p>';
    $used = array_column($presets, 'id');
    for ($index = 0; $index < 8; $index++) {
        $row = $presets[$index] ?? [];
        $new_id = 'preset-' . ($index + 1);
        while (in_array($new_id, $used, true)) $new_id .= '-new';
        $preset_id = $row['id'] ?? $new_id; $used[] = $preset_id;
        $prefix = 'presets[' . $index . ']';
        echo '<details class="wzf-mascot-replace"><summary>' . esc_html($row['name'] ?? sprintf(__('New preset %s', 'live2d-show'), $index + 1)) . '</summary><div class="wzf-mascot-fields"><input type="hidden" name="' . esc_attr($prefix . '[id]') . '" value="' . esc_attr($preset_id) . '">';
        foreach (['name'=>__('Preset name', 'live2d-show'),'line'=>__('Preset line', 'live2d-show')] as $key=>$label) echo '<label class="wzf-mascot-field">' . esc_html($label) . '<input type="text" name="' . esc_attr($prefix . '[' . $key . ']') . '" value="' . esc_attr($row[$key] ?? '') . '"></label>';
        foreach (['motion'=>[__('Preset motion', 'live2d-show'),$motions], 'expression'=>[__('Preset expression', 'live2d-show'),$expressions]] as $key=>$field) {
            echo '<label class="wzf-mascot-field">' . esc_html($field[0]) . '<select name="' . esc_attr($prefix . '[' . $key . ']') . '"><option value="">' . esc_html__('None', 'live2d-show') . '</option>';
            foreach ($field[1] as $value=>$label) echo '<option value="' . esc_attr($value) . '" ' . selected($row[$key] ?? '', (string)$value, false) . '>' . esc_html($label . ' · ' . $value) . '</option>';
            echo '</select></label>';
        }
        echo '</div></details>';
    }
    submit_button(__('Save interaction presets', 'live2d-show')); echo '</form></section>';
}
add_action('admin_post_wzf_mascot_presets', 'wzf_mascot_presets_post');

function wzf_mascot_remap_presets($character, $old_motions, $new_catalog) {
    try { $old_expressions = wzf_mascot_character_expressions($character); } catch (Throwable $e) { $old_expressions = []; }
    $maps = [];
    foreach (['motion'=>'motions','expression'=>'expressions'] as $channel=>$key) {
        foreach ($new_catalog[$key] ?? [] as $item) $maps[$channel][$item['file']] = $item['id'];
    }
    $presets = wzf_mascot_presets($character['presets'] ?? [], $old_motions, $old_expressions);
    $result = [];
    foreach ($presets as $preset) {
        foreach (['motion'=>$old_motions,'expression'=>$old_expressions] as $channel=>$old) {
            if ($preset[$channel] === '') continue;
            $mapped = $maps[$channel][$old[$preset[$channel]]['file']] ?? null;
            if ($mapped === null) continue 2;
            $preset[$channel] = $mapped;
        }
        $result[] = $preset;
    }
    $raw_count = is_array($character['presets'] ?? null) ? count($character['presets']) : 0;
    return ['presets'=>$result, 'presetWarnings'=>max(0, $raw_count - count($result))];
}
