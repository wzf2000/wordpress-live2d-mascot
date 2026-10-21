# 常见问题与维护

[文档首页](index.md) · [安装与资源准备](INSTALL.md) · [互动与偏好](INTERACTIONS.md)

**启用后为什么没有看板娘？** 先在“设置 → Live2D Mascot”确认 Core 和至少一个角色已配置，再用桌面浏览器点击“显示看板娘”并同意条款。登录用户还应检查个人资料中的“允许前台显示看板娘”。减少动画、后台标签页或正在打开的支持对话框／评论面板会抑制显示；加载失败时按前台提示重试。

**手机能显示吗？** 宽度 **≤ 782px** 的移动模式默认关闭。管理员允许后，读者仍须在手机浏览器单独同意并开启；桌面偏好不会自动开启。采用紧凑布局，系统或浏览器开启“减少动画”时始终不渲染。

**为什么 Core 或模型导入被拒绝？** Core 必须是指定 Web 5 R5 文件。模型检查单 model3、引用闭包、格式、路径和大小；整个 SDK、带声音／编辑文件的项目包、多模型合集都会拒绝。先查看后台提示，再按[安装指南中的 ZIP 结构](INSTALL.md#准备模型-zip)重新准备，不要仅重命名旧格式文件。

**升级会丢失模型或偏好吗？** 导入资源放在当前站点 uploads 的 `wzf-mascot/` 独立目录，正常更新插件不覆盖；停用后也保留。浏览器偏好和 WordPress 资源配置独立保存，迁移站点仍需迁移 uploads 和数据库。

**可以更新、停用或删除已有角色吗？** 在“角色管理 → 编辑”中可更新同 ID 的模型、停用／启用、移入回收站／恢复，并交换回退到上一版资源与动作。更新保留名称、署名、布局和其他显示配置；动作按相对文件路径映射，无法保留时默认拒绝，须明确允许重置不兼容动作。回退保留当前显示信息和启用／回收站状态。所有旧文件仍保留供缓存和恢复，回收站不执行永久文件删除。首次导入的 ID 仍须唯一。停用角色的本地收藏与已有选择保留，恢复后可继续使用。

**支持音频、招呼和自动欢迎吗？** 当前不支持音频。导入器生成动作／表情目录，但默认不设置招呼或自动欢迎动作，管理员可在“角色管理 → 编辑”中从真实动作目录配置待机、招呼和首次显示欢迎动作，也可在互动面板手动播放动作。

**导入提示已有任务正在进行，怎么办？** 查看后台“资源和设置任务”：空闲、运行中、中断待核查或旧版／未知。任务不会按时间自动抢锁；运行中请等待并刷新。只有守卫确认无活动任务的新协议遗留记录，才提供需明确确认的“恢复中断的任务”。恢复仅删除该条锁记录，模型、配置和候选目录均保留；随后请检查已安装资源，再重试原操作。旧版、非法记录或守卫缺失／被替换等情况须管理员人工核查，不能仅凭时间删除锁。正常打开后台不会创建守卫或改写旧锁。

首次导入与同 ID 更新均区分服务器上传大小限制、上传中断、未选文件和临时存储失败。请求超过 `post_max_size` 而丢失表单字段时会拒绝并说明限制；诊断不会跳过权限或 nonce 执行写入。

## 任务状态与受控恢复

后台任务面板区分空闲、运行中、中断待核查和旧版／未知状态。所有资源与设置写入任务共用非阻塞的操作系统文件守卫，覆盖整个写入过程。资源目录中的永久小型守卫文件应保持原位，维护时不得替换或删除。任务记录包含守卫协议、inode、任务类型与开始时间；时间经过本身不允许接管任务。

只有原始守卫安全且未锁定的新协议记录提供恢复入口。恢复要求 `manage_options` 权限、专用 nonce、明确确认、原记录指纹及未变化的配置版本，并在同一操作系统守卫内再次检查；仅删除该条任务记录。资源、配置、候选目录与用户偏好均保留，重试前应检查已安装资源。旧版、非法记录、守卫缺失或被替换时，需要管理员人工核查服务器。打开设置页不会创建守卫或迁移旧记录；超大 POST 导致 nonce 丢失时，错误诊断也不允许写入。

## 只读磁盘盘点

管理员主动点击 **盘点磁盘用量 / Inspect disk usage** 后，使用权限与 nonce 校验的 POST 在当前站点 `uploads/wzf-mascot` 精确根内盘点文件元数据。打开设置页不会自动遍历磁盘。报告只向管理员显示相对路径、文件数、逻辑字节数、当前／上一版模型、缩略图、共享 Core 与条款引用；不把盘点数据加入前台配置。

整个被引用模型目录都受保护，包括 model3 未引用但 catalog 使用的维护动作；停用与回收站角色、上一版历史、嵌套／迁移目录均计入引用。目录保护文件与候选目录也标为保留。**未引用不代表安全可删**，来源使用权限未知；此功能没有删除、清理、定时任务、配置写入或新增锁，也不读贴图内容或计算哈希。

扫描上限为 20,000 项／3 秒；显示最多 500 条路径、保护引用最多 1,000 条。显示截断与扫描不完整分别标注。缺失／不可读／非法引用、软链接、特殊文件、达到扫描上限、正在进行的资源任务或盘点期间配置变化，都会保守标为不完整／未知并停止“未引用”判断。不会跟随软链接或访问根外目录。硬链接逐路径计入逻辑大小并另列数量，报告不代表物理磁盘占用；盘点不是恢复演练或模型视觉验收。

同一次受限扫描还提供逐角色的当前模型、上一版模型、缩略图、各版去重小计、当前／上一版交集和角色路径去重合计，位于路径明细之前。角色共用或嵌套同一目录、缩略图处于模型目录内、当前／上一版复用路径时，联合统计仅计该相对文件路径一次；共享引用明确标注保留。不同角色／版本行不可相加当作全站总量；全局 `bytes` 完整值仍为扫描根下所有唯一相对文件路径的逻辑字节，硬链接继续逐路径计数。

路径显示到 500 行后，容量仍由同一完整受限扫描汇总。扫描不完整、引用未知、任务锁存在或配置并发变化时，完整容量字段为 `null`，保留明确标为部分观察值的 `observedBytes`；不能把部分数值或零解释为完整占用。

点击 **下载最新盘点 JSON / Download fresh inventory JSON** 会以独立权限和 nonce 校验的 POST 重新扫描，直接下载到管理员本机；它可能与先前页面盘点不同。schema 2 报告保留 `complete`、`referencesComplete`、`displayTruncated`、`limits`、相对路径和角色容量指标，不含绝对路径、账号、凭据、配置正文或模型内容。报告不保存在服务器文件、option 或 transient，也不提供给普通账号或前台。

Character capacity is aggregated during the same bounded metadata scan, independently of the displayed-path limit. Each version subtotal, character union and global character union counts a relative file path once; overlapping model/history/thumbnail references and shared paths are explicitly marked. Do not add character/version rows together. Incomplete scans or unknown references expose `observedBytes` while complete capacity `bytes` values are `null`. The separate administrator-only JSON download starts a fresh scan, returns an attachment directly and persists nothing on the server. This remains an inventory, with no cleanup or deletion feature.

## 本地诊断

设置页的 **前台入口检查** 自动进行轻量只读门禁：检查角色配置类型，以及安全模型／catalog 入口路径、可读性和大小；不解析 model3，不扫描动作引用或贴图，也不哈希所有角色。异常角色标为“被隔离”，其他有效角色继续显示；所有角色异常或共享 Core／条款配置无效时停止输出。原配置、文件和浏览器收藏／选择保留；修复后重新可用。可显示仅表示角色入口通过，仍须共享资源有效，并由读者开启。

管理员在设置页点击 **检查已安装资源**，另外只读核对 Core SHA256、运行引用、catalog、布局与条款配置。不会修改选项或模型，不代表已通过画面验收。

前台的 **本地诊断** 仅对具备 `manage_options` 权限的管理员创建入口；访客和普通账号不采集。登录 HTML须绕过共享页面缓存。此 flag仅控制本地工具，不是服务端权限凭证。诊断独立于角色就绪状态，加载失败时也能打开。展开不会采集；点击 **开启本地诊断** 后才读取当前 WebGL / GPU renderer，并在内存中记录白名单阶段及错误码。请先开启诊断，再显示或重试角色，才能记录完整加载时间。`readyMs` 是引擎初始化完成时间，`firstFrameMs` 必须在实际 `frames > 0` 后记录；未观察到首帧时留空并注明原因。

**采样 3 秒** 使用采样期间实际新增帧数和经过时间计算 FPS；收起、阅读暂停、后台标签或切换角色会中断并标记窗口。`cpuDrawMsAvg` 是此窗口 CPU 侧绘制调用耗时，`engineLifetimeCpuDrawMsMax` 与 `engineStats.renderMsAvg/Max` 为引擎累计 CPU 侧统计，均不是 GPU 执行时间。每个采样窗口记录自己的角色 ID 和环境；切换后保留的旧窗口不会重新归属到新角色。预览失败与恢复原角色分别记录为加载 attempt，包含请求／实际显示角色、失败角色和 fallback 标记。软件 renderer 标识只是字符串启发式判断；未提供 renderer 时为 `null`。这些数据不能代替真实硬件或不同模型的画面测试。

点击 **连续采样 3 组 / Sample 3 windows** 会依次采集 3 个 3 秒窗口，显示进度；**停止采样** 中断当前窗口并停止后续连采，**停止记录** 另外停止诊断采集。收起、切换角色、阅读暂停或隐藏标签会中断并停止序列，恢复后不会自动补采。当前页内存仅保留最近 20 个已完成或中断窗口，并显示被替换数量；重新开启诊断会清空窗口并建立新批次。每个窗口冻结角色、环境、加载与首帧记录及统计，带批次、加载 session 和窗口 ID。

**下载全部已保存窗口** 输出最多 20 窗口的 `wzf-mascot-diagnostic-batch` schema 1 批次，停止记录后仍可下载。**下载诊断 JSON** 保持单报告 schema 1：已有窗口时下载最后冻结窗口，尚未采样时下载当前状态；它不代表切换后新角色的当前状态。点击下载才生成本地文件；没有网络上传，也不保存到浏览器持久存储。报告含插件版本、角色 ID、加载阶段与错误类别、窗口统计及明确授权采集的环境信息，不包含页面 URL／query、Cookie、账号或用户资料。停止采集后仍可下载本页已生成报告；重新开启会重置报告。

## 实机采样步骤

完整中英设备清单、真实设备证据边界、离线 manifest 与汇总命令见 [设备采样与离线汇总](DEVICE_SAMPLING.md)。`tools/diagnostic_samples.py` 只读取显式本地输入并写入新的本地输出，无自动上传、Core／模型下载或性能策略修改；实机结论应按插件版本、设备与条件单独记录。

以下是待管理员执行的实机流程，文档和合成 CI 不表示已经完成真机验收。准备有合法真实资源的隔离站；移动默认关闭，手机测试须由管理员在该隔离站另行开启，读者仍需自行同意并开启。不要把桌面模拟手机尺寸或软件 WebGL 的结果当作 Android／iOS 或真实桌面 GPU 验收。

1. 以具备 `manage_options` 权限的管理员账号登录隔离站前台（访客和普通账号没有本地诊断入口）。分别准备真实桌面 GPU、Android、iOS。记录插件版本、浏览器及版本、系统、设备／GPU、角色 ID；选定同一页面、视口、缩放和网络条件，每个角色保持一致。手机记录竖屏／横屏实际视口、安全区和软键盘状态。
2. 每轮先收起角色，再重新打开页面，避免加载早于诊断授权；打开 **本地诊断 → 开启本地诊断** 后再点击显示并加载角色。开启前不会采集 GPU 信息；仅当前页面内存保存。先做冷加载 3 次（清除此隔离站相关浏览器资源缓存，再重新开启诊断），再做暖加载 3 次（保留缓存），分别下载诊断 JSON 并标记轮次。避免把清缓存造成的网络差异混为渲染差异。
3. 每次就绪后点击 **连续采样 3 组**，等待 3/3 完成，再 **下载全部已保存窗口**。也可保留原单次 **采样 3 秒** 操作；最多保留最近 20 窗口，刷新或重新开启诊断前先下载。记录 `readyMs`、实际首帧 `firstFrameMs`、FPS、CPU 绘制统计、renderer 及是否软件 renderer；被切换／暂停／后台中断的窗口单列，未观察到首帧的字段保持空值。
4. 连续切换／预览角色、播放动作／表情、收起再显示；打开阅读面板后关闭，切到后台再返回。检查原选择、收藏、暂停原因和恢复画面。桌面用键盘完成控件操作；手机打开外部输入框和软键盘，检查暂停及结束后的恢复，再测试旋转、安全区和面板滚动。
5. 在固定角色和条件下长驻至少 15 分钟，在开始、中段和结束各做 3 秒采样，检查画面、响应及异常日志。记录长驻期间发生的后台、网络变化和操作；用相同条件重现异常，报告当前角色与设备，不推断未测机型。

JSON 只在点击下载时保存在本机，无自动采集、自动上传或远程汇总。`cpuDrawMsAvg` 是 CPU 侧耗时，不能解释为 GPU 执行时间；诊断仍须配合肉眼画面检查。资源、条款或前台入口异常先修复，再继续该角色的采样。

可直接保留批次 JSON 交给维护者离线整理，无需先手写 manifest。自行处理时运行 `python3 tools/diagnostic_samples.py --unpack-batch batch.json --out new-directory`，先校验再生成固定文件名的 schema 1 窗口和 `runs.json`。模板默认 `physicalDevice=false`、`visualCheck=not-run`，设备、系统／浏览器版本、平台、缓存、场景与视觉结果须实际观察后填写；解包成功不代表验收。安全解包需 Linux/macOS，输入最多 2 MiB／20 窗口，拒绝软链接和已有输出目录；Windows 浏览器可正常采样并交回 JSON。原 manifest 汇总命令继续可用。详见设备文档。

For physical sampling, sign in as an administrator with `manage_options` (guests and ordinary accounts have no diagnostic entry), then enable diagnostics explicitly before showing a character, then choose **Sample 3 windows** and download all saved windows after the sequence completes. Stop sampling, hiding, switching, reading suspension or backgrounding interrupts the active window and stops the sequence; returning never resumes it automatically. The page retains the latest 20 frozen windows and shows replacement counts. **Stop recording** preserves downloads; enabling again starts a new random batch and clears saved windows. Single-report JSON stays schema 1 and downloads the last saved snapshot, or current state before any window exists. Batch files can be handed directly to a maintainer, or unpacked locally with `--unpack-batch ... --out NEW_DIRECTORY`. Fill real device/OS/browser versions and conditions manually; defaults declare no physical-device or visual pass. Check both orientations, keyboards, background/resume and at least 15 minutes of residence. CPU timings and synthetic browser tests establish no GPU improvement or physical-device acceptance.
