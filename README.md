# WordPress Live2D Mascot

<p align="center"><strong>给 WordPress 添一位可切换、可互动，也懂得让出阅读空间的看板娘。</strong></p>
<p align="center">A WordPress Live2D controller with character previews, local favorites and reading-aware interaction.</p>
<p align="center"><a href="#开始使用">开始使用</a> · <a href="#准备模型-zip">模型准备</a> · <a href="#常见问题">常见问题</a> · <a href="https://github.com/wzf2000/wordpress-live2d-mascot/releases/tag/v3.5.2">下载 3.5.2</a> · <a href="#许可与资源来源">许可</a></p>

**当前发行版：3.5.2。** 插件提供互动功能，Core 与模型由站点管理员自行取得并导入。首次安装没有内置角色；完成资源设置后，读者可以自行显示或收起看板娘。

| 你需要准备 | 当前要求与验收范围                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------- |
| 服务器     | PHP **8.2+**、ZipArchive 扩展、可写的 WordPress uploads                                         |
| WordPress  | 已在 **WordPress 7.1 / PHP 8.2** 独立环境完成安装与导入验收；7.1 是已验版本，不表示最低版本要求 |
| 浏览器     | 支持 WebGL 的桌面浏览器；小屏与减少动画设置会抑制显示                                           |
| 资源       | 固定 Web 5 R5 Core，以及一个有权在本站使用的 Cubism model3 运行模型                             |

## 你能用它做什么

- **选择喜欢的角色。** 在互动面板搜索、预览、取消或确认角色；收藏保存在当前浏览器。
- **控制动作与表情。** 播放已登记的动作或表情，停止动作并恢复待机，或单独恢复默认表情。
- **调整显示方式。** 切换左右位置、调整大小，随时收起；支持原生控件的键盘操作。
- **让阅读继续顺畅。** 其他原生对话框或支持的评论面板打开时暂停看板娘，关闭后按原显示偏好恢复。
- **自行管理模型。** 管理员导入 Core 与单模型 ZIP，资源留在 uploads 中，升级插件不覆盖已导入内容。

导入默认不设置招呼或欢迎动作。显示偏好、角色选择与收藏是浏览器本地数据，不提供账号同步。

## 开始使用

### 1. 下载并安装插件

[**下载 WordPress 安装包：wordpress-live2d-mascot-3.5.2.zip**](https://github.com/wzf2000/wordpress-live2d-mascot/releases/download/v3.5.2/wordpress-live2d-mascot-3.5.2.zip)

在后台打开 **插件 → 安装插件 → 上传插件**，上传此 ZIP，安装并启用。在站点或网络后台插件列表的操作区，以及本插件说明区，可通过 **设置** 直达资源配置（仅对具备设置权限的管理员显示），也可通过 **文档／反馈** 打开项目说明与 issue 页面。安装包的顶层目录为 `live2d-show/`。

发行页中的 `*-source.zip` 和 GitHub 自动提供的 **Source code** 用于开发；后台安装请选上面的完整安装附件。可用发行页的 [SHA256SUMS](https://github.com/wzf2000/wordpress-live2d-mascot/releases/download/v3.5.2/SHA256SUMS) 核对下载。

### 2. 导入自己取得的 Core

打开后台 **设置 → Live2D Mascot**。自行访问 [Cubism SDK for Web 官方下载页](https://www.live2d.com/en/sdk/download/web/)，阅读和接受适用条件，取得 **Web 5 R5**，上传其中的 `live2dcubismcore.min.js`，并勾选使用权确认。

当前只接受这一固定版本的已核验文件；不同版本会被拒绝。插件不会自动下载 SDK，也不会在服务器上执行上传内容来识别版本。

### 3. 导入单个模型

自行取得有权使用的模型，例如 [Live2D 官方样例](https://www.live2d.com/en/learn/sample/)。按[模型 ZIP 说明](#准备模型-zip)提取一个模型的导出运行文件，上传 ZIP，填写**角色 ID、名称与署名／来源**，并确认使用权。

使用官方角色时，须填写权利人要求的署名，并向访问者提供来源及特别使用条件；默认的“管理员导入资源”不能代替版权声明。首次角色 ID 可以自定，无须命名为 `haru`。

### 4. 在前台显示并确认效果

在桌面前台页面点击 **显示看板娘 → 同意条款并显示**。模型出现后点击 **互动**，检查角色、动作、表情和布局。多角色时先预览，再点击 **使用这个角色** 保存当前浏览器的选择。

管理员应实际检查画面和许可条件。成功导入不等于模型已通过视觉验收，也不会自动授予其他使用或再分发权利。

## 准备模型 ZIP

**上传单个模型的导出运行文件，不要直接上传整个 SDK、编辑工程或多模型合集。** ZIP 需要一个 `.model3.json`，以及它引用的 `.moc3`、PNG 和运行 JSON。至少保留一个合法动作；待机优先采用 Idle 组第一个动作，否则使用第一个合法动作。

下面仅示意 ASCII 文件名及目录关系，**不提供实际模型素材**：

```text
my-character.zip
└── my-character/
    ├── Model.model3.json
    ├── Model.moc3
    ├── Model.physics3.json          # 可选：仅当 model3 引用它
    ├── textures/
    │   └── texture_00.png
    ├── motions/
    │   └── idle.motion3.json
    └── expressions/
        └── smile.exp3.json          # 可选：仅当 model3 引用它
```

`Model.model3.json` 中的路径必须相对该文件，例如 `textures/texture_00.png`。不要用绝对路径、`../` 或网络 URL。声音文件与动作中的 `Sound` 引用应事先移除。可以保留现有 `catalog.json`，导入器仍会按 model3 重新生成动作／表情目录；未引用的资源不写入站点。

<details>
<summary><strong>展开：文件、大小与命名限制</strong></summary>

| 项目                         | 限制                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| ZIP 上传、解压总大小、单文件 | 分别不超过 **64 MiB**                                                 |
| ZIP 项数                     | 最多 **1000** 项                                                      |
| JSON                         | 单文件最多 **8 MiB**                                                  |
| PNG                          | 最多 **16** 张；单张最多 **32 MiB**、**8192 × 8192**                  |
| 角色 ID                      | 1–64 位，首位小写字母，其余为小写字母、数字或短横线；不可使用保留名称 |
| 名称／署名                   | 名称必填、最多 200 字节；署名最多 300 字节；不接受 HTML 或控制字符    |
| 资源路径                     | ASCII 字母、数字、下划线、点、短横线与目录分隔符 `/`                  |

支持 `.model3.json`、`.moc3`、`.png`、`.motion3.json`、`.exp3.json`、`.physics3.json`、`.pose3.json`、`.userdata3.json`、`.cdi3.json` 及可选 `catalog.json`。

拒绝绝对路径、越界、百分号编码、重复路径（含大小写冲突）、软链接、特殊文件、加密 ZIP、异常压缩比，以及 PHP／JS／HTML／声音／编辑文件。含脚本中间扩展名的文件同样拒绝，例如 `evil.php.png`。ZIP 必须只有一个 model3；引用文件缺失或没有合法动作也会拒绝。

Core 单文件最多 8 MiB，必须匹配以下 SHA256：

```text
8741f739779b5d5210872bd3d7d99f0f1e56e6c87409e7d26d6bb4b80aa1ef47
```

只允许具备 `manage_options` 的管理员导入，上传会校验 nonce 与使用权确认。文件先写入独立候选目录，校验后原子提交并持锁保存配置；失败不改变有效配置并清理本次候选。已有角色 ID 不覆盖，请使用新的 ID。

</details>

## 常见问题

**启用后为什么没有看板娘？** 先在“设置 → Live2D Mascot”确认 Core 和至少一个角色已配置，再用桌面浏览器点击“显示看板娘”并同意条款。登录用户还应检查个人资料中的“允许前台显示看板娘”。减少动画、后台标签页或正在打开的支持对话框／评论面板会抑制显示；加载失败时按前台提示重试。

**手机能显示吗？** 当前小屏宽度 **≤ 782px** 时隐藏看板娘，不启用模型渲染。系统或浏览器开启“减少动画”时也不启用；当前没有手机专用显示模式。

**为什么 Core 或模型导入被拒绝？** Core 必须是指定 Web 5 R5 文件。模型检查单 model3、引用闭包、格式、路径和大小；整个 SDK、带声音／编辑文件的项目包、多模型合集都会拒绝。先查看后台提示，再按上面的 ZIP 结构重新准备，不要仅重命名旧格式文件。

**升级会丢失模型或偏好吗？** 导入资源放在当前站点 uploads 的 `wzf-mascot/` 独立目录，正常更新插件不覆盖；停用后也保留。浏览器偏好和 WordPress 资源配置独立保存，迁移站点仍需迁移 uploads 和数据库。

**可以删除或覆盖已有角色吗？** 当前没有后台删除管理或覆盖更新入口。导入时角色 ID 必须唯一；添加修订模型请使用新 ID。手动移除资源属于管理员另行维护的操作，不要只删文件导致配置悬空。

**支持音频、招呼和自动欢迎吗？** 当前不支持音频。导入器生成动作／表情目录，但默认不设置招呼或自动欢迎动作，也没有配置这些动作的后台编辑器；仍可在互动面板手动播放动作。

**导入提示已有任务正在进行，怎么办？** 配置锁不会自动抢占。若先前请求异常中断，需管理员检查导入状态和锁后再处理，避免并发覆盖。

## 许可与资源来源

自有代码采用 **GPL-2.0-or-later**，适用 [LICENSE](LICENSE) 中指定 Web 5 R5 的组合附加许可；Framework 与着色器保留各自条款。安装包、源码包与公开仓库不附带 Core、模型、贴图、动作或表情素材。

维护者按收到的官方回复，以资源由用户自行官网下载导入的方式发行；这不表示官方认证，也不授予第三方权利。站点管理员仍需满足 Core、模型和角色的使用条件及署名要求。完整边界见[发行与许可说明](https://github.com/wzf2000/wordpress-live2d-mascot/blob/main/docs/DISTRIBUTION.md)。

<details>
<summary><strong>开发、测试与集成接口</strong></summary>

### 构建与打包

配套源码 ZIP 根为 `wordpress-live2d-mascot/`，自包含插件文件与固定 Framework，可重建或再打包。需要 Python 3、Node.js 和 **esbuild 0.25.12**。

以下命令用于克隆后的当前 main 工作树；`npm run check` 需要 Git 提交信息。从发行源码 ZIP 开发时，请遵循包内 README，可独立运行测试、构建和打包。3.5.2 源码包包含 npm／CI 入口；历史 3.5.0 附件保持原样。

```sh
npm ci --ignore-scripts
npm run check
# 也可独立运行合成回归或生成审阅构建：
python3 -m unittest discover -s tests -p 'test_*.py'
python3 build.py --esbuild node_modules/.bin/esbuild
```

构建写入 `build/`。审阅后将生成的三个哈希前端文件及 `haru-assets.json` 放到 `plugin/`，再运行：

```sh
python3 tools/package_release.py --out build/public-release-unique
```

输出安装 ZIP、源码 ZIP、SHA256SUMS 与机器清单。工具只读取明确白名单、当前前端资源和固定 13 个着色器；不读取忽略目录中的旧 Core、模型、历史元数据或备份。拒绝软链、缺失、非空角色清单、带 Core/model 的清单与哈希不一致。

Python 回归使用合成模型 ZIP 和 WordPress PHP stubs，零资源 smoke 检查没有前端输出。3.5.0 另通过独立 WordPress 7.1 / PHP 8.2 环境的 37 项安装、导入和浏览器检查；这不代表所有 WordPress 版本、模型或真机均已验证。工具直接核对 loader/CSS 源码字节；引擎必须用固定 esbuild 重建并比较 SHA256，不能用文件名检查替代源码对应性验证。

### GitHub Actions

[CI](https://github.com/wzf2000/wordpress-live2d-mascot/actions/workflows/ci.yml) 在 PR、main push 或手动运行时执行，也可由发布工作流复用。固定 Node.js 24.15.0、Python 3.12、PHP 8.2 与 esbuild 0.25.12；`package-lock.json` 是构建依赖的唯一锁文件，使用官方 npm registry。

检查覆盖合成导入回归、PHP/JS 语法、零资源 smoke、已提交的三项哈希资源与重新构建结果逐字节一致，以及无 Core/模型的安装与源码包白名单、摘要和源码自包含复打包。发布新增的失败测试检查版本、提交、附件篡改及未知源文件。普通 CI 只读，不需要私有 secret，不下载 Core 或模型；**不代替真实 SDK、模型画面、WordPress 安装或许可验收**。

新版本发布从 [Manual Live2D Mascot Release](https://github.com/wzf2000/wordpress-live2d-mascot/actions/workflows/release.yml) 手动发起：

1. 将新版本的 PHP 版本入口、源码和核验过的构建产物提交到 main。
2. 选择 main，填写与 PHP 入口完全一致的版本号（不带 `v`），保留 `publish=false`，先下载该次运行的 artifact 审阅。
3. 准备正式发布时再次发起，明确选择 `publish=true`。已存在的 tag 或 release 会拒绝，不覆盖既有 v3.5.0 附件。

每次运行固定触发时的 `github.sha`，附件携带该 SHA、版本和文件摘要。发布任务仅验证本次运行的 artifact，具有写权限的任务不 checkout 或执行仓库代码；原子创建对应 tag，先建立草稿、上传并核对所有附件摘要，确认 tag 仍指向核验的提交后才公开。失败会保留已创建的草稿/tag 供检查，不自动覆盖或删除。

### 阅读协调

加载器适配其他已打开的原生 `dialog`，以及 `.pagenest-notes-slot`、`.llmn-show-notes`、`.llmn-panel` / `.llmc-panel` 的阅读状态。其他页面组件可以在加载器初始化后发送：

```js
document.dispatchEvent(
  new CustomEvent("wzf-mascot-suspension", {
    detail: { source: "example-reader", suspended: true },
  }),
);
// 关闭时用相同 source 发送 suspended: false。
```

同一来源重复通知幂等，多来源分别记录，只有所有原因解除才恢复。暂停保留显示偏好，不改评论、笔记或主题；初始化前打开的已支持界面由 DOM 初次扫描识别。

### 既有站点的条款兼容

3.5.1 支持服务器维护的可选 `presentation` 配置，保留站点原有条款页、条款版本和纯文本同意提示。该配置用于经过审阅的站点接入；后台没有上传 HTML 或编辑这些字段的入口。

`wzf_mascot_resources_v1` 中的 `presentation` 必须同时包含 `terms`、`termsVersion`、`consentText`：`terms` 是相对 uploads 中插件资源根的现存 `.html` 路径，不接受网络 URL、越界或软链接；版本和提示只能是非空纯文本（分别最多 200／2000 字节）。提示由 `textContent` 显示，不作为 HTML 解释。缺省沿用公开版通用说明；显式配置无效时停止前台输出，避免展示错误条款。相同条款版本保留已有浏览器同意记录；是否仍适用于现有资源由站点维护者确认。

### 服务器与资源边界

uploads 中仅写固定哈希 Core JS 和数据白名单，并生成 Apache/IIS 禁止服务器脚本执行的规则；Nginx 等服务器应按站点惯例禁止 uploads 下的服务器脚本执行。资源在前台使用时公开提供，不是私人文件存储。

运行时脚本经可取消请求下载后通过 Blob URL 执行。站点 CSP 需允许对应资源请求与 Blob 脚本；插件不会自动放宽安全头。模型视觉、来源许可和实际浏览器兼容性仍由管理员确认。

</details>
