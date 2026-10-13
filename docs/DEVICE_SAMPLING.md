# 实机采样 / Physical-device sampling

本流程用于在有权使用真实资源的**隔离站点**取得可比较样本。没有完成以下操作，不能把
软件 Chromium、模拟手机视口或 CI 结果称作真实 GPU、Android 或 iPhone 验收。
不需要在生产启用移动端，也不需要上传 Core、模型或诊断文件。

## 准备与记录

1. 准备至少一台真实桌面 GPU 设备、一台 Android 和一台 iPhone。记录设备型号、系统、
   浏览器版本、插件版本和角色 ID。先用正常规模角色验证流程，再测重型角色；同一比较
   使用相同模型资源版本、页面、浏览器缩放、网络、视口和设备电源模式。
2. 使用独立测试 WordPress 及其独立数据库和 uploads。只在该站启用移动端；保持读者
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
| 稳定绘制 | 每轮角色就绪后连续做三个“采样 3 秒”窗口 | 每次采样后立即下载一个 JSON；下一窗口会覆盖面板中的上一窗口 |
| 连续切换 | 固定同一组角色和顺序，反复预览、取消、确认、收起和显示 | 无旧模型残留、无多次欢迎、已保存选择和收藏不意外改变；失败与恢复分别记录 |
| 阅读与后台 | 打开受支持阅读面板，关闭；切后台再返回 | 暂停期间不绘制，返回后正确恢复；中断采样不与稳定窗口混算 |
| 桌面键盘 | Tab/Shift+Tab、Enter、Escape；搜索中切输入法 | 焦点可见、控件有名称、无键盘陷阱；输入法确认不误关闭面板 |
| 手机输入与旋转 | Android/iPhone 上打开输入框和软键盘，收起键盘；横竖屏切换 | 人物及控件不遮挡输入，暂停恢复正确，安全区与滚动正常；横竖屏样本分组 |
| 长驻 | 固定角色运行至少 15 分钟，开始、中段和结束各做三个窗口 | 记录温度／节能／后台变化、画面和响应；每个阶段单列，检查持续退化或异常 |
| 减少动画 | 打开系统减少动画 | 不渲染模型；这是行为检查，不是 FPS 性能样本 |

首帧未观察到必须保留空值；加载失败、fallback、切换旧窗口和后台中断不能伪装成成功
加载。`cpuDrawMsAvg` 是 CPU 调用耗时，**不是 GPU 执行时间**。长驻测试的稳定性、
画面、触屏及键盘结论由操作员记录，JSON 不能替代这些观察。

## 本地汇总

`tools/diagnostic_samples.py` 只读取明确指定的本地文件，不连接站点、不访问网络、不扫描
其他目录、不读取 Core 或模型。输入保持原样；输出必须是不存在的新路径。

在诊断文件旁创建自己的 `runs.json`。下面是一条示例，复制条目时给每个导出文件独立
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
cold loads and three warm loads, with three explicit three-second windows per load. Download
each window immediately: the next sample replaces the previous window in the panel. Missing
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
