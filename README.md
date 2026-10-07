# WordPress Mascot / 看板娘

3.5.0 是不附带 Core 或模型的完整功能插件候选。支持角色加载、预览与切换、搜索和本地收藏、动作停止、表情重置、键盘操作与阅读界面暂停协调。首次安装没有角色，前台不输出看板娘资源；管理员配置后才可启用。小屏和减少动画设置继续保持隐藏。

自有代码采用 GPL-2.0-or-later，附带 LICENSE 指定的 Web 5 R5 组合附加许可。Cubism Framework 与着色器保留各自条款。完整发行边界与待确认事项见 [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md)；所有本地输出仍为 `public_release_ready=false`，不能将基础检查当作权利人的分发许可。

## 安装与自行导入

需要 PHP 8.2、ZipArchive 和可写的 WordPress uploads。安装完整 ZIP 后，在“设置 → 看板娘资源”操作。只有具备 `manage_options` 的管理员可以导入，所有上传均校验 nonce 和使用权确认。

1. 自行访问 [Cubism SDK for Web 官方下载](https://www.live2d.com/en/sdk/download/web/)，阅读和接受适用条件。解压自己取得的 Web 5 R5 SDK，上传其中 `live2dcubismcore.min.js`。当前只接受 SHA256 为 `8741f739779b5d5210872bd3d7d99f0f1e56e6c87409e7d26d6bb4b80aa1ef47` 的固定 Core。插件不执行上传来识别版本，也不会下载 SDK。
2. 自行取得有权在本站使用的模型，例如 [官方样例](https://www.live2d.com/en/learn/sample/)。从下载内容提取一个模型的导出运行文件，制作单模型 ZIP。不要上传整个 SDK、编辑工程或包含多个模型的官方合集。只保留一个 `model3.json` 及其引用的 `moc3`、PNG、动作、表情、物理等运行 JSON；声音与 `Sound` 引用需要事先移除。可保留 `catalog.json`，导入时仍按 model3 重新生成。
3. 上传 ZIP，填写唯一的小写角色 ID、名称及署名／来源。使用官方模型时必须自行填写权利人要求的署名，并向访问者另行提供对应模型的来源及特别使用条件；默认的“管理员导入资源”不是充分的版权声明。默认待机使用第一个 Idle 组动作，缺少 Idle 时使用第一个合法动作；完全没有动作会拒绝。默认不设置招呼或欢迎动作。首次角色 ID 可以是任意合法 ID，无须 `haru`。

ZIP 限 64 MiB、1000 项，解压总大小限 64 MiB，单文件限 64 MiB。JSON 限 8 MiB，PNG 单张限 32 MiB、8192×8192，最多 16 张。路径必须是 ASCII 文件名（字母、数字、下划线、点、短横线及目录分隔），拒绝绝对路径、越界、百分号编码、重复路径、软链接、加密 ZIP、压缩比异常及 PHP/JS/HTML/声音/编辑文件。只提取所选模型的引用闭包，未引用资源不写入。

资源保存在当前站点 uploads 的 `wzf-mascot/` 唯一目录，更新插件不会覆盖。每次导入先检查和写入独立候选，再原子提交目录、持锁合并配置；已有角色 ID 不覆盖。失败不改变有效配置，清理本次候选。异常中断留下的导入锁不会自动抢占，需管理员检查处理。当前不提供删除管理。

上传目录仅写固定已核验 Core JS 与数据白名单，同时写入 Apache/IIS 禁止执行服务器脚本的规则；Nginx 等服务器仍应按站点惯例禁止 uploads 下的服务器脚本执行。所有导入及视觉、许可验收由管理员负责；单站使用不等于取得再分发许可。

## 开发、测试与本地打包

源码包含控制器和固定 Framework。安装包与源码包都不带 Core、模型、贴图、动作或旧模型来源清单。配套源码包自包含当前插件文件，可直接重建／再打包。

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
node tests/release-smoke.cjs plugin
python3 build.py --esbuild /path/to/esbuild
```

esbuild 必须是 0.25.12，构建工具写入 `build/`。审阅后把生成的三个哈希文件及 `haru-assets.json` 放到 `plugin/`，再生成完整候选：

```sh
python3 tools/package_release.py --out build/asset-free-candidate-unique
```

输出安装 ZIP（根为 `live2d-show/`）、源码 ZIP（根为 `live2d-show-source/`）、SHA256SUMS 与机器清单。工具只读取明确白名单、当前前端资源和固定 13 个着色器，不读取忽略目录中的旧 Core、模型、历史元数据或备份。拒绝软链、缺失、非空角色清单、带 Core/model 的资源清单及哈希不一致。

Python 回归使用合成模型 ZIP 与 WordPress PHP stubs；零资源 smoke 验证没有前端输出。真实 WordPress 安装、权限、导入和 GPU 画面仍需独立验收。工具核对 loader/CSS 源码字节，引擎源码与产物的对应性必须用固定 esbuild 重建、比较 SHA256，不能由文件名或依赖检查代替。

角色搜索／收藏和显示偏好保存在浏览器；原有未知角色偏好回退到当前可用的默认角色。阅读暂停适配开放的原生 dialog 与 `.pagenest-notes-slot`、`.llmn-show-notes`、`.llmn-panel` / `.llmc-panel`；其他组件可发送 `wzf-mascot-suspension` 事件（`detail: { source, suspended }`），只有所有原因解除后恢复。该功能只控制看板娘，不改评论、笔记或主题。
