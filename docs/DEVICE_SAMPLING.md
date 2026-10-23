# 实机采样 / Physical-device sampling

本流程用于在有权使用真实资源的**隔离站点**取得可比较样本。没有完成以下操作，不能把
软件 Chromium、模拟手机视口或 CI 结果称作真实 GPU、Android 或 iPhone 验收。
不需要在生产启用移动端，也不需要上传 Core、模型或诊断文件。

Only a signed-in WordPress administrator with `manage_options` can access local diagnostics. Guests and ordinary accounts have no diagnostic entry or collection; logged-in HTML must bypass shared caches.

## 准备与记录

1. 准备至少一台真实桌面 GPU 设备、一台 Android 和一台 iPhone。记录设备型号、系统、
   浏览器版本、插件版本和角色 ID。先用正常规模角色验证流程，再测重型角色；同一比较
   使用相同模型资源版本、页面、浏览器缩放、网络、视口和设备电源模式。
2. 使用独立测试 WordPress 及其独立数据库和 uploads，以具备 `manage_options` 权限的管理员账号登录前台；访客和普通账号不提供本地诊断入口或采集。只在该站启用移动端；保持读者
   自主同意和开启流程。不要为测试改变生产的资源、许可或用户偏好。
3. 检查角色画面、条款和资源诊断。预热设备后关闭无关后台负载，记录节能模式、充电与否、
   屏幕刷新率等条件。不同条件另分组，不用网络差异推断渲染性能。
4. 每轮先收起角色、打开新页面、**开启本地诊断，再显示角色**。诊断只在授权后采集；
   已加载完才开启诊断不会补出首帧耗时。若浏览器屏蔽 renderer，保留“未知”，不要强行
   开启实验标志或据此推断硬件。

## 采样矩阵

| 场景 | 操作 | 记录与通过依据 |
| --- | --- | --- |
| 冷加载 | 清除隔离站资源缓存，保留同样网络；独立刷新三轮 | 每轮 readyMs、实际首帧 firstFrameMs；肉眼确认人物完整、比例与裁剪正常 |
| 暖加载 | 保留缓存，独立刷新三轮 | 与冷加载分组，不把重复导出同一页面算成新加载 |
| 稳定绘制 | 每轮角色就绪后连续做三个“采样 3 秒”窗口 | 点击“连续采样 3 组”，等待 3/3 后下载全部已保存窗口；最多保留最近 20 窗口 |
| 连续切换 | 固定同一组角色和顺序，反复预览、取消、确认、收起和显示 | 无旧模型残留、无多次欢迎、已保存选择和收藏不意外改变；失败与恢复分别记录 |
| 阅读与后台 | 打开受支持阅读面板，关闭；切后台再返回 | 暂停期间不绘制，返回后正确恢复；中断采样不与稳定窗口混算 |
| 桌面键盘 | Tab/Shift+Tab、Enter、Escape；搜索中切输入法 | 焦点可见、控件有名称、无键盘陷阱；输入法确认不误关闭面板 |
| 手机输入与旋转 | Android/iPhone 上打开输入框和软键盘，收起键盘；横竖屏切换 | 人物及控件不遮挡输入，暂停恢复正确，安全区与滚动正常；横竖屏样本分组 |
| 长驻 | 固定角色运行至少 15 分钟，开始、中段和结束各做三个窗口 | 记录温度／节能／后台变化、画面和响应；每个阶段单列，检查持续退化或异常 |
| 减少动画 | 打开系统减少动画 | 不渲染模型；这是行为检查，不是 FPS 性能样本 |

首帧未观察到必须保留空值；加载失败、fallback、切换旧窗口和后台中断不能伪装成成功
加载。`cpuDrawMsAvg` 是 CPU 调用耗时，**不是 GPU 执行时间**。长驻测试的稳定性、
画面、触屏及键盘结论由操作员记录，JSON 不能替代这些观察。

## 首帧前资源计时

先开启诊断，再开始加载，导出的各次 `load` 可包含 `resources`。记录只在当前加载及首帧观察期间收集；已有 Core／引擎记为 `reuse`，共享脚本执行的等待记为 `runtime-wait`，不会补成 0 毫秒下载。旧报告没有此字段仍可读取。

每条仅含固定资源类别、操作、序号、相对加载开始的 `startMs`、本次操作的 `durationMs`、`bodyBytes`、结果及固定错误码。贴图下载和图片解码共用序号；解码、执行等待和复用没有读取响应体，`bodyBytes` 为 null；失败、取消或尚未读完时也为 null，不能把未知大小记作零。只有完整读取到的空响应体才记 0。`bodyBytes` 是实际读到的 HTTP 响应体字节数，**不是网络传输量**，不能据此推断压缩比或带宽。下载与解码可并行，不能把各条耗时相加作为总加载时间，也不代表 GPU 时间。

每次加载最多记录 128 条，超出数保存在 `dropped`；`endedBy` 说明因首帧、停止记录、取消或失败等原因结束。停止观察时未完成的记录以取消收尾，不代表网络请求必然停止。后续迟到结果不会改写已经结束的记录或冻结窗口。名称、URL 与原始错误不进入资源记录。

无需等待 FPS 窗口，也可单独读取一次成功或失败的加载报告：

```sh
python3 tools/diagnostic_samples.py --resource-report report.json --out resource-summary.json
```

输出按类别和操作列出条数、最大单项耗时、已知响应体字节数及大小未知的下载数；不会计算“串行总耗时”。文件仅在本机读取，新输出路径不得已存在。

## 新版互动的人工检查

性能 JSON 与人工操作记录分开保存。每组浏览器先填写插件版本、源码提交、模型资源版本、
系统与浏览器版本、电源模式、缓存清理方式和屏幕方向；不知道的写“未知”。旧版本采样
保留原版本，不填入新版的结果栏。相同设备换浏览器也要另开一组。

建议先在 Windows 的 Edge／Chrome、Android 的系统浏览器／Chrome 完成下表，再复查
macOS Safari／Chrome 和 iPhone Safari／Chrome。设备没有的浏览器或模型没有的能力写
`not-run` 并说明原因；例如没有表情／命中区域时入口隐藏可以是正确行为。

| 检查 | 操作与观察 |
| --- | --- |
| 首次失败恢复 | 在隔离环境制造一次模型资源加载失败，检查重试和选择其他角色；加载中暂停阅读或切后台，返回后不会擅自重试失败角色；确认前不改变保存选择。不要在生产删除资源来制造失败。 |
| 换角与偏好 | 预览、取消、确认并刷新；在两个标签页修改收藏或布局，检查另一页的变化提示；账号偏好只有主动读取／保存才请求服务端。 |
| 账号冲突与失败 | 仅用合成测试账号，读取后在另一页保存，再尝试旧页保存；检查冲突提示及重新读取。拒绝存储或断网后保留本页选择，不把请求超时当作保存失败的确证。 |
| 台词与快捷互动 | 检查招呼、可用动作／表情和预设；分别停止动作、重置表情；静默和仅主动模式符合选择，闲聊不自行开启。 |
| 长台词阅读 | 测试最长中文、英文及多行台词，Tab 聚焦后滚动阅读；焦点／指针阅读期间不消失。收起角色或打开阅读面板后不留下隐藏焦点。 |
| 小屏与键盘 | 搜索角色时展开软键盘，再收起、旋转；搜索、结果和确认按钮均能滚动到。桌面检查 Tab、Shift+Tab、Enter、Escape 和输入法组合键。 |
| 移动与安全区 | 触摸拖动及键盘方向键移动，检查四边、刘海／底部安全区与矮窗口；移动柄不遮挡人物，取消拖动不会保存中间位置。 |
| 可选能力 | 检查有／无视线、模型区域绑定及 PNG 许可的角色；PNG 只在管理员已经确认授权的测试角色上下载。缺少能力不记作渲染失败。 |
| 长驻与恢复 | 至少运行 15 分钟，分别记录开始、中段、结束；包含一次后台返回、阅读暂停、手机键盘展开和关闭。采样窗口被中断时保留中断事实。 |

每项用 `pass`、`fail` 或 `not-run` 记录，失败附最短操作步骤、实际结果与截图编号。
截图避免账号、正文输入和私人内容；人工记录不写 Cookie、密码、诊断端点或资源下载地址。
“全部操作通过”也不替代冷暖三轮和长驻的性能样本。

可复制以下记录骨架；这是操作员记录，不是诊断 JSON，现有离线统计工具不会把它当作
性能数据或自动给出设备验收结论：

```json
{
  "pluginVersion": "填写实际版本",
  "sourceCommit": "填写实际提交",
  "modelResourceVersion": "填写模型版本或摘要记录编号",
  "device": "设备型号，不含序列号",
  "os": "系统与版本",
  "browser": "浏览器与版本",
  "conditions": "电源、缓存清理方式、方向、缩放",
  "checks": [
    { "id": "failure-recovery", "result": "not-run", "note": "", "evidence": [] },
    { "id": "preferences-two-tabs", "result": "not-run", "note": "", "evidence": [] },
    { "id": "account-conflict", "result": "not-run", "note": "", "evidence": [] },
    { "id": "interaction", "result": "not-run", "note": "", "evidence": [] },
    { "id": "long-dialogue", "result": "not-run", "note": "", "evidence": [] },
    { "id": "keyboard-and-rotation", "result": "not-run", "note": "", "evidence": [] },
    { "id": "movement", "result": "not-run", "note": "", "evidence": [] },
    { "id": "optional-capabilities", "result": "not-run", "note": "", "evidence": [] },
    { "id": "soak-15-minutes", "result": "not-run", "note": "", "evidence": [] }
  ]
}
```

## 连采与下载

只有明确点击“开启本地诊断”才采集 GPU 信息。点击“连续采样 3 组”启动 3×3 秒，
状态区显示进度；“停止采样”中断当前窗口并停止后续，“停止记录”停止全部诊断采集。
收起、切角色、阅读暂停、标签隐藏同样停止连采，恢复后不会补采。每个保存窗口冻结
当时的角色、环境、加载／attempt、首帧及统计；之后切换或错误不会改写旧窗口。

当前页保留最近 20 个窗口并显示被替换数量，不写浏览器持久存储、不上传、不设后台
任务。停止后仍可下载；重新开启会清空并创建新批次。单份 JSON 保持 schema 1，取
最后保存窗口；尚未采样才取当前诊断状态。批次带明确 kind/schema、随机批次与加载
session、稳定窗口 ID。下载文件不含 URL、query、Cookie、账号或输入内容。

## 本地汇总

`tools/diagnostic_samples.py` 只读取明确指定的本地文件，不连接站点、不访问网络、不扫描
其他目录、不读取 Core 或模型。输入保持原样；输出必须是不存在的新路径。

可直接把批次 JSON 交给维护者处理，无需先编写清单。若自行离线整理，先解包：

```sh
python3 tools/diagnostic_samples.py --unpack-batch /path/to/batch.json \
  --out /path/to/new-sampling-directory
```

安全解包需要 Linux/macOS 的目录描述符接口；Windows 浏览器仍可正常采样并把批次交给维护者。
原 manifest 汇总用法不变。不支持的系统会友好退出 `2`。解包只接受明确本地输入，
最多 2 MiB／20 窗口；在全部验证后才新建目录，使用固定的
`window-01.json` 等文件名和 `runs.json`。拒绝软链接、输入提供的路径字段和已有输出，
保留合法中断窗口、缺首帧和 schema 1 事实。模板默认 `physicalDevice=false`、
`visualCheck=not-run`，平台／缓存／场景留空，设备及系统／浏览器版本等待填写。
退出 `0` 仅表示解包完成，不表示硬件、画面或性能验收。

窗口的稳定 ID 使重复导出不会增加样本数。同批次同一次加载共享 session；不同批次或
加载有独立随机命名空间。保持模板 ID 与 session；补充元数据后再运行原汇总命令。
改换横竖屏、缓存、场景或长驻检查点时，先保存批次，再停止／重新开启诊断建立新批次，
不同条件独立汇总；已经加载后重新开启不会补出冷加载或首帧时间。

也可使用原单报告流程，在诊断文件旁手工创建自己的 `runs.json`。下面是一条示例，复制条目时给每个导出文件独立
`id`；同一次加载的多个窗口使用相同 `session`，刷新后改用新 session。`conditions`
使用自己的非隐私标签，对应另行记录的资源版本、页面、网络、电源模式及长驻阶段。
不填写私人 URL、账号、Cookie 或设备序列号。

```json
{
  "schema": 1,
  "runs": [
    {
      "id": "desktop-cold-1-window-1",
      "session": "desktop-cold-load-1",
      "platform": "desktop",
      "physicalDevice": true,
      "device": "test-laptop-a",
      "os": "record OS and version",
      "browser": "record browser and version",
      "conditions": "model-rev-a_page-a_wifi-ac",
      "cache": "cold",
      "scenario": "load",
      "visualCheck": "pass",
      "report": "desktop-cold-1-window-1.json"
    }
  ]
}
```

- `platform`：`desktop`、`android` 或 `ios`；模拟视口仍填其实际宿主平台，
  `physicalDevice` 填 `false`。真实设备也不得把软件 renderer 写成硬件。
- `cache`：`cold` 或 `warm`；`scenario`：`load`、`switch`、`resume` 或 `soak`。
  切换、恢复和长驻窗口只汇总绘制数据，不作为独立冷启动证据。
- `visualCheck`：`pass`、`fail` 或 `not-run`，是肉眼检查结果，不是自动判断。
- `session` 在同组条件内标识一次加载；更换设备、角色、横竖屏、测试场景或长驻阶段后
  新建 session。不同阶段的 `conditions` 也要分开，不能用平均数掩盖随时间退化。
- `report` 只能是此清单目录内的相对路径；绝对路径、`..`、软链接和非普通文件被拒绝。
  最多 256 条记录，每个报告最多 2 MiB，清单最多 256 KiB。

```sh
python3 tools/diagnostic_samples.py /path/to/private-samples/runs.json \
  --out /path/to/private-samples/summary-new.json
```

退出码 `0` 表示所有列出的窗口可汇总，`1` 表示已有摘要但排除了部分无效／重复／中断
窗口，`2` 表示清单或输出有误。**这不是验收通过码**。被排除的记录按输入顺序和 ID
列出，不回显文件路径、原始 JSON 或额外字段。先检查 schema 1、有限数字、三秒窗口、
帧数与 FPS 一致性、独立导出文件，以及路径和 session 条件是否符合上面的要求。

摘要按版本、设备、系统、浏览器、角色、视口、renderer、网络条件标签、冷暖缓存和
场景分组，给出中位数、最小值、最大值及样本数。每次加载的多个绘制窗口只计一个首帧
样本；需至少三个独立 session 才标记 `enoughLoadRepeats`。就绪与首帧分别计数：首帧
缺失保留在 `missingFirstFrameSessions`，至少三个实际首帧样本才标记
`enoughFirstFrameRepeats`。这些标记不表示画面或硬件验收通过。软件 renderer 和未知
renderer 分开保留，`hardwareVerified` 始终为 `false`。
设备、缓存与肉眼结论仍由操作员声明；工具不能证明真实机型、网络缓存状态或 GPU 工作。

先保存可重现的同条件基线，再测试候选。只有真实设备反复出现可解释的瓶颈，才考虑
帧率上限、渲染分辨率或低功耗模式；每项调整还需比较视觉质量、输入响应和资源使用。
不要把较短 CPU 时间直接写成 GPU 提速，也不根据单次测试对所有机型作结论。

## English checklist

Use a separate WordPress installation with its own database and uploads, and resources you may
legally use. Test a real desktop GPU, Android and iPhone separately. Browser viewport emulation
and software Chromium are not physical-device evidence. Keep production settings unchanged.

Record device, OS, browser, plugin and model versions, viewport, zoom, network, power mode and
refresh rate. Enable local diagnostics **before** showing the character. Run three independent
cold loads and three warm loads. For each load, click **Sample 3 windows** for three consecutive
three-second windows, then **Download all saved windows**. The latest 20 windows stay in memory;
download before refresh or enabling a new diagnostic batch. Missing
first-frame observations remain missing; exclude interrupted windows and unsuccessful/fallback
loads from successful startup timings. CPU draw duration is not GPU execution duration.

Also check repeated preview/cancel/confirm transitions, reading-panel and background suspension,
keyboard focus and IME behavior, phone keyboards, portrait/landscape safe areas, and at least
15 minutes of residence with separate start/middle/end samples. Reduced-motion mode should
suppress rendering; verify it as a behavior check, not an FPS sample. Inspect the character
visually and record defects independently of the numeric results.

Use the manifest example above with `platform` (`desktop`/`android`/`ios`), `physicalDevice`,
`cache` (`cold`/`warm`), `scenario` (`load`/`switch`/`resume`/`soak`) and `visualCheck`
(`pass`/`fail`/`not-run`). Give each export a unique ID. Reuse a session only for windows from
one load under identical conditions. Use a new session and condition label for a different
orientation, character or soak checkpoint. Keep report paths relative and inside the manifest
directory; no symlinks. Use non-private labels, never URLs, account details or serial numbers.

Run the local command above. It has no network or telemetry and refuses to overwrite files.
Exit `0` means all requested windows could be summarized, `1` means some were excluded, and
`2` means invalid manifest/output. None certifies acceptance. Groups retain software/unknown
renderers separately. Repeated windows do not increase the independent load count. Hardware,
cache and visual information remain operator declarations; `hardwareVerified` is always false.
Compare repeatable baselines before considering frame caps, resolution changes or power modes.

Batch unpacking is optional: users may hand the original batch JSON directly to a maintainer.
Safe batch unpacking requires Linux/macOS directory-descriptor support and exits cleanly with code 2 on unsupported systems. Windows browsers can still sample and hand JSON to a maintainer; the original manifest summary mode remains available.
`--unpack-batch INPUT --out NEW_DIRECTORY` validates at most 2 MiB/20 windows before creating
fixed-name schema-1 reports and a runs.json template. It rejects symlinks, input filename/path
fields and existing output. Interrupted windows and missing first-frame facts are preserved;
the existing summarizer still excludes interrupted windows. Templates default to
`physicalDevice=false` and `visualCheck=not-run`; fill platform, cache, scenario, real device,
OS/browser versions and observations manually. Successful unpacking is not acceptance.

Stop recording retains downloads. Enabling again clears windows and starts a random batch.
The single-report download selects the last frozen window, or current state before any sample;
it must not be interpreted as a newer character's live state. Start a new batch and separate
conditions for a new orientation or soak checkpoint; do not fabricate startup timings for an
already-loaded character. No automatic upload, persistent browser storage or performance tuning
is introduced. Actual physical-device sampling remains an operator task.
