# 角色互动与偏好指南

适用于 3.10.1。后台入口为 **设置 → Live2D Mascot → 选择角色**；前台显示角色后打开 **互动**。Core 与模型由管理员自行导入，资源说明见 [发行边界](DISTRIBUTION.md)。

[文档首页](index.md) · [安装指南](INSTALL.md) · [排障与维护](TROUBLESHOOTING.md)

## 日常操作

1. 点击 **显示看板娘** 并同意条款，角色就绪后打开 **互动**。
2. 用 **招呼** 或快捷互动播放管理员配置的内容；动作和表情也可分别选择、停止或重置。
3. 展开 **换个角色** 搜索、收藏和预览；点击 **使用这个角色** 后才保存选择，取消可返回原角色。
4. 展开 **更多互动与设置** 调整台词、布局和可选功能；需要安静阅读时随时收起。

## 配置台词

管理员在“角色台词”中分别设置欢迎、点击、上午、下午、晚间、离开后返回和偶尔闲聊。每个事件可启用、设置 15–3600 秒冷却（闲聊为 90–1800 秒，默认 120 秒），并填写最多 8 条备选，每行一条，每条最多 300 字节。中文通常每字占 3 字节。留空不会影响角色显示。

台词只使用本站已保存的纯文本。管理员可手动选择“台词草稿”，将通用语气或角色原创示例填入空白字段；已有非空文本保持原样，需检查并保存才生效。角色草稿不是官方台词，来源链接仅供背景参考，不会自动匹配安装角色。首次显示时，欢迎台词在同页最多出现一次；未设置欢迎时，按浏览器当地时间选择上午（0–11 时）、下午（12–17 时）或晚间（18–23 时）。返回台词要求页面离开至少 60 秒。自动台词与模型触碰台词还共用 15 秒防打扰间隔。

首次打开互动面板时仅显示当前角色、招呼、最多 3 个快捷预设，以及“换个角色”“更多互动与设置”。搜索、收藏、随机和最近角色在换角区；预览的确认与取消始终位于面板主层，折叠分组不会藏起它们。其余互动、布局、PNG 和账号偏好收在默认折叠的更多区；打开分组不会读取或保存账号。

访客在“更多互动与设置 → 台词偏好”中选择：

- **自动台词**：允许上述自动规则与主动互动。
- **仅主动互动**：仅点击、快捷互动及明确接入的站点操作通知。
- **静默**：不显示台词；纯台词快捷预设会禁用并说明原因，含动作或表情的预设仍可使用。

“偶尔闲聊”默认关闭，仅保存在本机；管理员启用该角色的 idle 规则后，访客仍需自愿开启，并使用自动模式。其他模式会保留勾选并提示切回自动台词后生效。就绪、可见且未预览、未打开面板、未拖动或处理其他互动时，以 1–2 倍闲聊间隔等待，每 10 分钟最多 3 条。句池抽完前不重复，跨轮避免紧邻重复。隐藏、后台、阅读暂停、切角色、静默或仅主动模式均取消等待；恢复后重新等完整间隔，不补播。到期遇到文本输入焦点、气泡焦点或忙碌时跳过并重等；不读取输入内容。

“聊一句”可主动试用已保存的闲聊池，仅主动模式也可使用；静默模式禁用。管理员未配置闲聊动作池时只显示文本；配置后可配合[闲聊动作](#闲聊动作池)。

主动点击“打招呼”“聊一句”可立即显示新台词，不受自动台词冷却影响；有多条台词时连续点击会换一句。“聊一句”在动作播放或加载时仍可显示文字，配套动作让位于手动操作。“打招呼”会取消旧的欢迎、待加载互动与动作请求，播放有效的招呼动作，并保留当前表情；静默且没有招呼动作时禁用。直接点击模型仍保留区域绑定和 8 秒动作防连点。

动作与表情分别处理加载与取消。停止动作不会取消正在加载的表情，恢复默认表情也不会取消动作；仍有效的一项加载失败时会显示提示。隐藏或暂停会取消未完成的互动，恢复显示后不会补播或重现旧错误。

后台“填入常用互动草稿”仅填空白预设，提供招呼、休息一下和继续阅读。仅招呼可引用管理员已配置且仍有效的招呼／欢迎动作，不猜测动作编号，不自动保存。

台词和快捷互动表单的“试播未保存的内容”使用当前表单草稿，其他表单仍沿用已保存值。预览不保存配置，也不清除未保存提醒；点击“开始试播”才加载已安装资源。可模拟规则触发并轮换台词，检查欢迎／时段优先关系及当前闲聊动作池，也可暂停、结束或关闭。资源数量来自目录，视线与命中区域数量由模型加载后报告；预览失败不会替换当前配置。

气泡按文本长度估算阅读时间，范围为 4.5–30 秒；气泡聚焦、鼠标停留或触摸滚读时暂停计时，离开后重新留出完整阅读时间。气泡在窄屏面板与人物旁移动时保留焦点与可用滚动位置。打开阅读面板、隐藏角色、切换角色或页面进入后台会清除台词。

## 配置快捷互动

管理员在“快捷互动”中添加最多 8 个命名组合，名称最多 80 字节。动作、表情与台词均可留空，但至少填写一项；台词最多 300 字节。动作和表情从当前角色目录选择。全部留空可删除对应预设。

前台按钮位于角色选择之后。点击后动作、表情与台词同时开始，不等待动作播放结束。新操作会取消旧预设尚未加载完成的通道；部分资源失败会给出提示。

更新模型时，动作和表情按相对文件路径映射，无法映射的整个预设会跳过并在后台提示。回退模型恢复对应资源版本的预设，保留当前台词与展示偏好。


## 复用互动模板

在角色编辑页展开 **互动模板 / Interaction templates**，可把已配置的台词、快捷互动和可选闲聊动作池保存为 JSON，在另一个角色或站点复用。

1. 在来源角色中选择 **下载互动 JSON**。文件包含七类台词、启用状态、冷却时间、快捷预设和可选闲聊动作池；动作与表情记录相对资源路径，不打包模型。
2. 上传该 JSON，勾选目标角色（最多 50 个），选择 **预览模板变化**。默认只替换台词并保留目标角色的闲聊动作池；如需一起替换快捷预设和闲聊动作池，先勾选 **同时替换快捷互动和闲聊动作**。
3. 逐个检查目标的前后内容、启用状态、冷却时间以及动作／表情映射，再勾选确认并应用。任一目标被阻止时整批不会应用；预览 15 分钟后过期，其他设置变化也需要重新预览。未出现在模板中的原有台词或预设会随对应分组被替换，预览会展示这些变化。

上传预览不会保存设置。预览有效期为 15 分钟；期间角色或其他资源配置被修改时，需要重新预览。取消、返回或关闭页面不会应用模板。文件上限为 **64 KiB**，仅接受此插件导出的 schema 1 互动 JSON。

偶尔闲聊保留目标角色当前的启用状态，导入不会把关闭的闲聊打开；导入空白闲聊句池会关闭该规则。读者本机的闲聊选择仍独立保存。

快捷预设只匹配目标角色已经存在、路径完全一致且唯一的动作或表情；缺失或歧义时不会保存。可取消勾选“同时替换快捷互动和闲聊动作”，或先修复目标目录。若目标角色已有模型点击区域绑定，必须先在原设置中解除绑定才能替换快捷预设；仅导入台词可以保留这些绑定。

模板不包含 Core、模型、贴图、源角色目录、账号偏好、模型点击区域绑定或 PNG 下载许可，也不修改角色名称、署名、布局、资源历史和移动端设置。请检查台词内容是否适合目标角色；模板不会赋予素材或文字的额外使用权。

Interaction templates are available in 3.10.0. Export dialogue, cooldowns, enable settings, presets and optional chatter motions as JSON, then upload it to another character and review the before/after changes before confirming. Dialogue-only import is the default and preserves the target chatter motion pool. Select “Also replace quick interactions and chatter motions” to replace these using exact, unique relative resource matches. Older templates without motionFiles preserve the target pool; an explicit empty list clears it when replacement is selected. Existing hit-area bindings block preset replacement. Chatter keeps the target enable setting, and an empty imported pool disables that rule. Previews write nothing, expire after 15 minutes and become stale after configuration changes. Templates contain no Core/model files, account data or PNG permission.

## 移动、停靠和复位

使用角色朝页面内侧、画布之外的 **↔ 移动柄** 拖动，松开后停靠到较近的左右边。只在移动柄上处理拖动，不接管页面滚动。

移动柄获得键盘焦点后，左右键切换停靠边，上下键移动；按住 Shift 使用较大步长。Escape 恢复默认位置与大小。位置与大小按角色保存在当前浏览器，窗口或软键盘变化只重算可见范围，不重写偏好。拖动被取消时恢复起始位置。移动柄为 44 × 44 触控区，与画布留有间距；极窄／矮视口按比例临时缩小画布并让柄位于其上方，不覆盖角色脚部，也不改写已保存布局。

## 视线与模型点击区域

“指针互动”中的 **轻柔跟随鼠标** 默认关闭，由访客自愿开启。仅在模型实际包含支持的参数、使用细鼠标指针且角色未暂停时工作。离开窗口、拖动、隐藏和切换会让视线归零。

管理员可在“模型命中区域”中，将模型声明的区域绑定到已有快捷预设。前台还会检查该区域实际存在可用的模型绘制区域。没有区域、没有绑定或绑定失效时，继续使用普通招呼。键盘激活招呼按钮始终走普通招呼。

## 接入站点操作通知

互动面板的“互动帮助”可随时展开阅读。站点工具也可在自己的用户操作成功回调中，主动发送固定语义通知：

```js
// 示例放在你自己的“生成结果”按钮操作成功回调中。
const result = await window.WZFMascot?.notify?.({
  event: 'tool-complete',
  caption: '结果已准备好',
  // presetId: 'preset-1', // 可选，当前角色的管理员预设 ID
});

// 等价的单向 DOM 事件；如需读取结果，请使用 notify()。
document.dispatchEvent(new CustomEvent('wzf-mascot-event', {
  detail: { event: 'action-complete', caption: '保存完成' },
}));
```

`event` 仅接受 `help`、`tool-complete`、`action-complete`；`caption` 为最多 300 字节的纯文本。省略 caption 时使用预设台词或对应的简短默认说明。presetId 必须是当前角色已有且有效的预设。

通知至少间隔 15 秒，同一角色同一事件至少间隔 30 秒。预览、暂停、隐藏、加载或交互忙碌时会拒绝，不会自行显示或切换角色。静默选择会抑制台词。调用返回 `{ok, code, characterId?}`；常见 code 包括 `shown`、`played`、`invalid-request`、`unknown-id`、`unavailable`、`busy`、`rate-limited`、`muted` 和 `cancelled`。`WZFMascot.cancel()` 取消待完成的联动与预设，并清除气泡。

这需要各工具主动接入，当前没有自动监听全站任意点击、复制或读取正文。已有的动作／表情 `command()` 接口见[开发与站点集成](DEVELOPMENT.md#本地联动-api-v1)。

## 自愿使用账号偏好

“账号偏好”默认不请求服务端。登录后按以下顺序操作：

1. **读取账号偏好**：读取当前账号的版本和偏好，不自动应用。
2. **使用账号偏好** 或 **保留本机偏好**：明确选择本浏览器使用哪一份。
3. 如需上传，再按 **将本机偏好保存到账号**。

仅同步角色、收藏与布局。角色显示、条款同意、手机开启、视线和最近历史保持本机独立。合法但暂时停用或不可用的角色 ID 会保留；可用角色需成功加载后才提交本机选择。

账号在别处变更时，本次保存不会覆盖，会显示新版本供选择。再次按保存表示明确替换刚读取的账号版本。请求超时后不会自动重发：保存结果可能未知，请重新读取后决定。浏览器拒绝本机存储时会说明是否已恢复；若恢复也被拒绝，会明确提示本机保存可能不完整。

相关偏好在其他标签页发生变化时会提示，并使当前账号读取结果失效；重新读取后再决定使用或保存。另一页的变更不会自动切换本页角色、打开手机显示或改变条款同意。上传账号偏好使用当前页的一致快照；“使用账号偏好”加载角色期间若其他页改了本机数据，会取消应用并保留新数据。

布局保存会尽量保留其他角色的新布局，但本地存储没有跨标签页原子合并保证。同一角色的同时修改仍应由使用者检查；保存被浏览器拒绝时会提示仅在本页生效。

偏好按站点区分。普通访客无需登录即可继续使用本机偏好。

## 随机收藏与最近角色

“随机收藏候选”只从当前搜索和筛选中可见的收藏抽取。每轮抽完前不会重复；有多个候选时也避免跨轮立即重复。改变收藏或筛选会重建候选池。

“最近角色”保留最近 8 个成功确认或由账号明确成功应用的角色。预览、取消和加载失败不会写入历史；暂不可用的 ID 不会因筛选而被删除。浏览器拒绝保存时，本页仍保留历史并显示提示。

两种入口都只选择候选，仍需按“预览角色”并确认，不会提前请求模型。

## 保存透明 PNG

管理员在“角色 PNG 下载”中，逐角色启用许可并明确确认资源条款允许。每个角色默认关闭；更新或回退模型资源会再次关闭，需重新确认。

访客展开“角色 PNG”后，可下载当前角色的透明 PNG。图片只包含当前角色画布，不包含台词、面板或页面正文，尺寸为当前画布的原始像素。一次只处理一个请求，暂停、隐藏或切换角色会取消尚未完成的导出。

## 管理员诊断

本地诊断仅向具备 WordPress `manage_options` 权限的管理员提供，访客与普通账号不创建入口或启动采集。该服务器 flag 仅控制本地工具，不承载私人数据或服务端权限；登录页面须遵守 WordPress 缓存绕过契约，不能把管理员 HTML 共享缓存给访客。没有访客诊断 bootstrap 请求。

Occasional chatter is off by default and stays local to this browser. It needs a saved enabled idle rule, reader opt-in, automatic dialogue and an available character. A single cancellable timer waits 1–2 cooldowns (90–1800 seconds), with at most three automatic lines per ten minutes. Pauses cancel the wait; returning starts fresh. Inputs, focused bubbles and busy interactions skip a deadline without reading text. “Chat once” is also available in active mode. Explicit “Say hello” and “Chat once” clicks bypass automatic dialogue cooldowns and can change the line on each click. Chat text remains available while a manual motion is playing or loading; its optional motion yields to manual work. “Say hello” replaces older welcome and pending interaction or motion requests without resetting the current expression. Silent mode disables chat, text-only greetings and text-only presets, with an explanation beside the presets. Presets with motions or expressions remain available. Chatter opt-in is preserved in other dialogue modes, with a reminder to switch to automatic dialogue. Direct model touches retain hit-area bindings and the eight-second motion cooldown. Both automatic chatter and “Chat once” can use up to eight existing motions selected by the administrator; an empty motion pool keeps them text-only. Chatter motions yield to manual actions and are cancelled on stop, pause, character changes or chatter preference changes. A motion failure leaves the dialogue visible. Administrator drafts only fill blank fields; review and save remains explicit. Character examples are original editorial suggestions, never official quotations or automatic model bindings. Local diagnostics require the server-generated manage_options flag and expose no private server data.


## 角色缩略图

管理员在角色管理中上传 **PNG、JPEG 或 WebP**，确认使用权。输入最多 **4 MiB**，宽高均不超过 **2048**，最多 **4M 像素**；需要服务器 PHP GD。图片解码后缩至最长边 **512** 并重新编码 PNG，移除 EXIF／其他元数据、源文件脚本和尾部字节，不接受 SVG 或 URL。生成图片独立存入 uploads，不随模型更新或回退改变；清除只移除配置引用，旧文件保留供缓存。

前台仅在互动面板打开并选中候选角色时按需加载这一张图片，不预取 Core 或模型。缩略图须来自本站同源的插件缩略图目录；缺省、无效或解码失败时显示名称缩写。搜索、收藏和候选变化只更新候选图，仍须明确预览／确认才会切换并保存角色。升级不会自动生成图片或改写旧配置。

## 可选移动端

设置页“移动端显示”默认关闭，未配置也视为关闭。管理员允许后，手机浏览器仍须点击显示按钮、同意条款并单独开启；已有桌面显示偏好不会自动开启手机。收起只保存本设备类型的偏好，减少动画、账号显示权限、阅读暂停和后台标签限制始终有效。升级不自动打开移动端或改写原配置。

手机采用紧凑尺寸并标明实际像素大小，保留桌面位置／大小偏好；面板可滚动、按钮至少 44 像素并避让安全区。默认在外部输入框聚焦时暂停，可由管理员关闭该规则；插件自身搜索与选择控件不触发此暂停。输入结束后只有其他暂停原因也解除才会恢复。

## 闲聊动作池

管理员可在“角色台词 → 偶尔闲聊”中选择当前角色最多 8 个已有动作，保存后供偶尔闲聊和“聊一句”随机使用；多选时尽量避免连续重复。留空只显示文字，表情保持原样。偶尔闲聊仍需访客主动开启、使用自动台词模式，按原冷却、输入／阅读暂停和每十分钟三条上限运行。

动作池只在角色待机时播放，不抢占手动动作。停止、换角、隐藏、暂停或修改闲聊偏好会取消尚未加载完成的动作；动作失败仍保留气泡。

互动模板 schema 1 的 idle 规则新增可选 `motionFiles` 路径列表，导出不携带模型专属动作 ID。默认只导入台词并保留本机动作池；勾选“同时替换快捷互动和闲聊动作”才按当前目录唯一文件路径映射，预览显示保留／替换及映射结果。旧模板缺少该字段时保留本机池；显式空列表可清空。缺失或歧义路径拒绝应用。资源同 ID 更新也按文件路径保留池，缺失项移除；回退恢复原资源对应的池并保留当前台词。
