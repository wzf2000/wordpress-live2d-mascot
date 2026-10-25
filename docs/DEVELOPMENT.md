# 开发与站点集成

[文档首页](index.md) · [安装指南](INSTALL.md) · [通知与互动](INTERACTIONS.md)

适用于 3.13.0。以下命令从仓库根目录执行；不用于直接修改生产站点。

## 构建与打包

配套源码 ZIP 根为 `wordpress-live2d-mascot/`，自包含插件文件与固定 Framework，可重建或再打包。需要 Python 3、Node.js 和 **esbuild 0.25.12**。

以下命令用于克隆后的当前 main 工作树；`npm run check` 需要 Git 提交信息。从发行源码 ZIP 开发时，请遵循包内 README，可独立运行测试、构建和打包。3.7.0 源码包包含 npm／CI 入口；历史 3.5.0 附件保持原样。

```sh
npm ci --ignore-scripts
npm run check
# 也可独立运行合成回归或生成审阅构建：
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tools/translations.py --check
node tests/admin-ui.cjs
python3 build.py --esbuild node_modules/.bin/esbuild
```

构建写入 `build/`。审阅后将生成的三个哈希前端文件及 `haru-assets.json` 放到 `plugin/`，再运行：

```sh
python3 tools/package_release.py --out build/public-release-unique
```

输出安装 ZIP、源码 ZIP、SHA256SUMS 与机器清单。工具只读取明确白名单、当前前端资源和固定 13 个着色器；不读取忽略目录中的旧 Core、模型、历史元数据或备份。拒绝软链、缺失、非空角色清单、带 Core/model 的清单与哈希不一致。

Python 单元回归使用合成模型 ZIP 和 WordPress PHP stubs，零资源 smoke 检查没有前端输出。真实 WordPress 集成另以独立数据库和 HTTP 登录／表单验证服务端行为。3.5.0 另通过独立 WordPress 7.1 / PHP 8.2 环境的 37 项安装、导入和浏览器检查；这不代表所有 WordPress 版本、模型或真机均已验证。工具直接核对 loader/CSS 源码字节；引擎必须用固定 esbuild 重建并比较 SHA256，不能用文件名检查替代源码对应性验证。

## GitHub Actions

[CI](https://github.com/wzf2000/wordpress-live2d-mascot/actions/workflows/ci.yml) 在 PR、main push 或手动运行时执行，也可由发布工作流复用。固定 Node.js 24.22.1、Python 3.12、PHP 8.2、esbuild 0.25.12 与 Playwright 1.55.1；`package-lock.json` 是构建依赖的唯一锁文件，使用官方 npm registry。

检查覆盖合成导入回归、PHP/JS 语法、零资源 smoke、已提交的三项哈希资源与重新构建结果逐字节一致，以及无 Core/模型的安装与源码包白名单、摘要和源码自包含复打包。发布新增的失败测试检查版本、提交、附件篡改及未知源文件。真实 WordPress integration job 必须通过，发布所复用的 CI 完成前会等待该 job 的 PHP 8.2／8.5 两项。隔离 MySQL 服务、新建 WordPress 7.1.3 和 WP-CLI 2.12.0 下载均固定版本，下载核对 SHA256；测试禁用邮件与 cron。升级测试以合成旧插件入口起步，再将完整合成资源、配置和账号显示偏好经真实 WordPress 覆写升级，逐项核对 option、user meta 和资源文件摘要；它不是历史真实素材或旧版渲染验收。以 Python 标准库 cookiejar 完成真实 HTTP 登录、nonce／权限失败、设置保存与过期版本冲突、multipart 导入／更新／缩略图，以及回退、停用恢复、移动设置和角色隔离。测试用独立 option 配置合成非执行 Core 占位文件及固定哈希元数据，仅验证服务端输出；生产常量和 Core 上传校验保持完整，占位文件也无法通过完整哈希诊断。只上传不含凭据的测试摘要，合成素材不作为 artifact 或发行附件。**不代替真实 SDK、模型画面、GPU、手机或许可验收。**

新版本发布从 [Live2D Mascot 手动发布](https://github.com/wzf2000/wordpress-live2d-mascot/actions/workflows/release.yml) 发起：

1. 将新版本的 PHP 版本入口、源码和核验过的构建产物提交到 main，并在 `.github/release-notes/<版本>.md` 写好中文发行说明，介绍本次更新和安装方式。
2. 选择 main，填写与 PHP 入口完全一致的版本号（不带 `v`），保留 `publish=false`，先下载该次运行的 artifact 审阅。
3. 准备正式发布时再次发起，明确选择 `publish=true`。已存在的 tag 或 release 会拒绝，不覆盖既有 v3.5.0 附件。

每次运行固定触发时的 `github.sha`，附件携带该 SHA、版本和文件摘要。发布任务仅验证本次运行的 artifact，具有写权限的任务不 checkout 或执行仓库代码；原子创建对应 tag，先建立草稿、上传并核对所有附件摘要，确认 tag 仍指向核验的提交后才公开。失败会保留已创建的草稿/tag 供检查，不自动覆盖或删除。

检查入口还覆盖翻译目录完整性与占位符、PO/MO 编译重现、未保存提醒、离线采样输入边界，以及真实后台的搜索／状态筛选、盘点权限与只读行为、英文／中文页面。资源仍全部使用合成样例；GitHub 流水线运行结果以对应提交为准。

3.10.0 增加互动模板的真实 HTTP 路径：管理员 JSON 导出、multipart 预览、签名／明确确认、过期配置拒绝、默认仅台词与闲聊状态保留、预设路径映射及命中区域绑定阻止。预览不落 transient；应用仍在现有资源任务守卫内重新读取配置并核对版本。同版还检查清理复核的显式选择、子树等待期、旧 Core 目录保留、非法天数、权限与 nonce，并核对配置和文件摘要不变。CI 故障摘要保留 PHP HTTP 服务清理前／后的退出码、错误等级／源码位置与 HTTP SAPI 的 OPcache／JIT 白名单状态，不上传原始消息、请求体或服务日志。

3.10.0 的真实 HTTP 测试还使用独立 WP-CLI 进程持有实际任务守卫，核对同一账号保存冲突、不同账号与管理员设置并行，以及旧版独占桥接锁在两个方向的互斥。管理员任务持有永久 `.task-guard` 的共享锁和 `.resource-guard` 的独占锁；账号保存持有同一个桥接共享锁和按站点／用户划分的账号独占锁。守卫文件不删除、截断或替换。所有参与进程须使用同一个稳定的 uploads 资源根；迁移资源根需先停止旧根和新根的写入方，不支持热迁移或动态跨节点根。

3.10.0 还覆盖闲聊动作池的权限、nonce、配置版本与目录 ID 校验，以及旧安装动作文件内部 ASCII 空格的真实 HTTP 保存回归。资源 ZIP、角色 root、主模型和 Core 的路径要求保持严格；安装目录读取、运行文件诊断及模板路径映射共用限定引用校验。前台专项覆盖停止、手动表情、阅读暂停、隐藏、关闭闲聊及模式切换时的迟到取消，动作失败保留台词和播放中的手动动作优先。模板仍使用 schema 1，新增可选 idle.motionFiles；旧模板和仅台词导入保留本机池。

## 本地前台浏览器回归

```sh
npm ci --ignore-scripts
npx --no-install playwright install chromium
npm run test:browser
# 专项：台词／语义事件、移动／视线、账号、候选选择、PNG
npm run test:dialogue-browser
npm run test:movement-browser
npm run test:account-browser
npm run test:selection-browser
npm run test:capture-browser
# 可选：仅保存合成结果 JSON 和选定关键截图，不记录 trace、cookie 或 storage state。
npm run test:browser -- --out /tmp/mascot-browser-review
```

独立 `browser` CI job 固定 **Ubuntu 24.04**，总上限 25 分钟。系统依赖安装、Chromium 下载和浏览器回归分为独立步骤，分别限时 8、4、10 分钟；步骤结果和耗时写入运行摘要，任一阶段失败仍阻断门禁。系统依赖步骤仅在 GitHub 托管的 Ubuntu 24.04 runner 上，将 Ubuntu 官方 APT 镜像配置中的 `azure.archive.ubuntu.com` 替换为 `archive.ubuntu.com`；保留其余源和第三方源，不修改开发者本机配置。

浏览器 CI 使用锁定 Playwright 1.55.1 与它匹配的 Chromium，和 WordPress 集成一起作为 PR／发布复用 CI 的门禁。测试只启动随机回环端口的本地 HTTP fixture，浏览器加载安装包中实际哈希 loader／CSS；测试源码和依赖锁包含在源 ZIP，Playwright、浏览器和合成 fixture 不进入 WordPress 安装包。结束或失败时关闭浏览器及服务，不访问生产站点或外部服务。

整页测试通过实际 DOM、事件、请求与本地存储覆盖：同意前零运行资源请求；预览／取消／确认与刷新偏好；初始化／预览取消和迟到候选丢弃；多来源阅读暂停、可见性与页面生命周期；默认关闭的移动显示、独立同意及外部输入暂停；动作／表情独立恢复、API 校验／限流／取消；context-lost 错误与手动重试；首次加载失败后的换角预览、暂停取消与迟到候选销毁；跨标签页偏好失效及异步应用前的三键基线复核；键盘 Escape 和 IME 边界。引擎／Core 只是自包含契约合成物，图形错误与可见性为 DOM 事件模拟，手机为视口模拟。**不验证 Cubism SDK、模型解析或画面、真实 GPU、实体手机或许可。**

Local whole-page browser tests use only shipped loader/CSS and public synthetic contract fixtures. Run `npm run test:browser` after installing the pinned development dependencies and matching Chromium. Optional `MASCOT_PLAYWRIGHT` (module directory) and `MASCOT_CHROMIUM` (browser executable) reuse local tools; neither is a required installation path or bundled dependency. An explicitly overridden browser version is recorded in the result and is distinct from CI's Playwright-matched revision. CI artifacts also retain each specialized suite’s synthetic results.json and selected PNG screenshots; raw logs, traces, cookies and storage state are excluded. Output contains only a synthetic summary and selected screenshots; no trace, cookies, storage state or automatic upload is produced locally.

## 本地运行真实 WordPress 集成

为测试预先准备专用空数据库服务和 PHP mysqli／zip／GD、MySQL CLI；只接受显式 loopback 地址、新的 `mascot_ci_*` 数据库和新的 `/tmp/mascot-ci-*` 目录。脚本拒绝含其他应用数据库的服务、复用已有数据库／目录、生产路径或非本地地址，不清空已有站点。凭据通过环境变量设置，勿写入源码或终端共享记录。

```sh
# MASCOT_CI_DB_NAME=mascot_ci_example
# MASCOT_CI_DB_HOST=127.0.0.1:专用数据库端口
# MASCOT_CI_DB_USER / MASCOT_CI_DB_PASSWORD 由本机测试环境提供
python3 tools/wordpress-integration.py --lab /tmp/mascot-ci-example --port 18129
```

测试只下载固定公开 WordPress／WP-CLI，不下载 Core、官方或私人模型。执行后 HTTP 服务停止，摘要保存在实验目录的 `results.json`；数据库与含合成凭据的实验目录由实验负责人按本机保留规则清理，不上传。测试摘要明确标记未做渲染验收。

## 阅读协调

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

## 既有站点的条款兼容

3.5.1 支持服务器维护的可选 `presentation` 配置，保留站点原有条款页、条款版本和纯文本同意提示。该配置用于经过审阅的站点接入；后台没有上传 HTML 或编辑这些字段的入口。

`wzf_mascot_resources_v1` 中的 `presentation` 必须同时包含 `terms`、`termsVersion`、`consentText`：`terms` 是相对 uploads 中插件资源根的现存 `.html` 路径，不接受网络 URL、越界或软链接；版本和提示只能是非空纯文本（分别最多 200／2000 字节）。提示由 `textContent` 显示，不作为 HTML 解释。缺省沿用公开版通用说明；显式配置无效时停止前台输出，避免展示错误条款。相同条款版本保留已有浏览器同意记录；是否仍适用于现有资源由站点维护者确认。

## 管理与双语界面

3.7.0 在角色管理中增加名称／ID 搜索与全部、启用、停用、回收站、被隔离、入口可显示筛选。状态数量复用已有轻量入口检查；被隔离与生命周期状态可以重叠，入口通过仍不代表画面或完整资源正常。搜索和筛选只读，不保存设置。首次使用清单区分 Core 入口、启用角色与条款，提示下一步导入、修复或前台同意。

修改角色／手机设置或选择上传文件后，离页会触发浏览器的未保存提醒；提交另一个表单也会提醒仍未保存的修改。有效提交自己的表单可继续，未改动的只读搜索不提醒。多个表单分别保存，提醒不会自动保存文件或输入内容。

自有后台、个人资料和前台控件支持 **en_US / zh_CN**；后台跟随 WordPress 用户界面语言，匿名前台跟随站点语言。采用 `live2d-show` textdomain、随包 PO/MO 与前台配置字典，缺省 JS 使用本地英文文案。角色名称、署名、角色 ID、导入目录的动作／表情标签、用户资料和既有站点条款内容保持原样。旧 Haru 内置动作标签保留并提供双语文案。Framework／vendor、机器错误码、资源许可与自定义条款页面不属于界面翻译范围。

修改 `plugin/languages/live2d-show-*.po` 后执行 `python3 tools/translations.py` 生成 POT/MO；`--check` 只读核对 PHP 嵌套包含文件、自有前台错误与控件的完整覆盖、插值参数及逐字节可重现性。只使用 Python 标准库，无在线翻译或额外依赖。

## 本地联动 API v1

加载器初始化后提供 `window.WZFMascot`，`version === 1`。这是同页本地接口，不连接音频、聊天或外部服务，不发送数据。只能操作读者已同意、明确显示、就绪且未暂停的当前角色；不能显示、切换角色、加载 URL 或绕过减少动画／阅读暂停。

```js
// ID 必须存在于当前角色 catalog；示例 ID 按实际模型替换。
const result = await window.WZFMascot.command({
  action: 'motion', id: '01', caption: '你好',
});
await window.WZFMascot.command({ action: 'expression', id: 'smile' });
await window.WZFMascot.command({ action: 'reset', channel: 'expression' });
await window.WZFMascot.command({ action: 'stop' }); // 恢复待机
window.WZFMascot.cancel(); // 取消本接口尚未完成的命令
```

`command()` 接受普通对象且只允许 `action`、`id`、`channel`、`caption`：`motion`／`expression` 必须有当前目录 ID，不能带 channel；`reset` 可选 `all`（默认）／`motion`／`expression`，`stop` 无 channel，二者均不能带 ID。可选 caption 最多 120 个 Unicode 字符，不接受 HTML 标记或控制字符，仅在互动面板状态区用纯文本显示约 5 秒，不是聊天气泡。成功命令至少间隔 500 毫秒；手动动作、招呼或 API 命令正在处理时拒绝并发。

返回 Promise，成功为 `{ok:true, code:'played'|'reset'|'stopped', characterId}`；拒绝为 `{ok:false, code}`，包括 `invalid-request`（参数）、`unknown-id`（目录无此 ID）、`unavailable`（未显示／就绪或已暂停）、`busy`、`rate-limited`、`cancelled`、`resource-error`。取消／资源失败结果可带 characterId。`cancel()` 返回 `{ok:true, code:'cancelled'|'idle'}`，阻止尚未完成命令产生动作或字幕；已开始播放的动作可另发 stop，已经发出的同源资源请求可能继续填入引擎缓存。收起、暂停、角色切换或新的手动操作也会取消未完成联动。接口不提供网络地址、任意参数写入或强制恢复入口。

固定站点操作通知、自愿账号偏好、模型区域与 PNG 的具体步骤和示例见[互动与偏好指南](INTERACTIONS.md)。
