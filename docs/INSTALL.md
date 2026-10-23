# 安装与资源准备

[文档首页](index.md) · [常见问题](TROUBLESHOOTING.md) · [English setup](DISTRIBUTION.md#administrator-setup)

适用于 3.11.1。需要 PHP 8.2+、ZipArchive、可写的 WordPress uploads 和支持 WebGL 的浏览器。首次安装需管理员自行取得并导入指定 Core 与有权使用的模型。

## 1. 下载并安装插件

[**下载 WordPress 安装包：wordpress-live2d-mascot-3.11.1.zip**](https://github.com/wzf2000/wordpress-live2d-mascot/releases/download/v3.11.1/wordpress-live2d-mascot-3.11.1.zip)

在后台打开 **插件 → 安装插件 → 上传插件**，上传此 ZIP，安装并启用。在站点或网络后台插件列表的操作区，以及本插件说明区，可通过 **设置** 直达资源配置（仅对具备设置权限的管理员显示），也可通过 **文档／反馈** 打开项目说明与 issue 页面。安装包的顶层目录为 `live2d-show/`。

发行页中的 `*-source.zip` 和 GitHub 自动提供的 **Source code** 用于开发；后台安装请选上面的完整安装附件。可用发行页的 [SHA256SUMS](https://github.com/wzf2000/wordpress-live2d-mascot/releases/download/v3.11.1/SHA256SUMS) 核对下载。

## 2. 导入自己取得的 Core

打开后台 **设置 → Live2D Mascot**。自行访问 [Cubism SDK for Web 官方下载页](https://www.live2d.com/en/sdk/download/web/)，阅读和接受适用条件，取得 **Web 5 R5**，上传其中的 `live2dcubismcore.min.js`，并勾选使用权确认。

当前只接受这一固定版本的已核验文件；不同版本会被拒绝。插件不会自动下载 SDK，也不会在服务器上执行上传内容来识别版本。

## 3. 导入单个模型

自行取得有权使用的模型，例如 [Live2D 官方样例](https://www.live2d.com/en/learn/sample/)。按[模型 ZIP 说明](#准备模型-zip)提取一个模型的导出运行文件，上传 ZIP，填写**角色 ID、名称与署名／来源**，并确认使用权。

使用官方角色时，须填写权利人要求的署名，并向访问者提供来源及特别使用条件；默认的“管理员导入资源”不能代替版权声明。首次角色 ID 可以自定，无须命名为 `haru`。

导入后，在 **角色管理 → 编辑** 中可调整名称、署名、默认大小（140–260 像素，步长 10）、垂直偏移（-100–100%）与动作。待机必选，欢迎可关闭，招呼可多选或全部取消。既有浏览器大小偏好优先。保存只更新这些字段，保留模型路径、条款及其他服务器配置；不修改模型文件。并发导入或设置修改会拒绝冲突请求，请刷新后重新编辑。打开设置页不会迁移或改写旧配置。

## 4. 在前台显示并确认效果

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

只允许具备 `manage_options` 的管理员导入，上传会校验 nonce 与使用权确认。文件先写入独立候选目录，校验后原子提交并持锁保存配置；失败不改变有效配置并清理本次候选。首次导入不覆盖已有角色 ID；更新现有角色请使用角色管理中的同 ID 更新入口。

</details>

## 服务器与资源边界

uploads 中仅写固定哈希 Core JS 和数据白名单，并生成 Apache/IIS 禁止服务器脚本执行的规则；Nginx 等服务器应按站点惯例禁止 uploads 下的服务器脚本执行。资源在前台使用时公开提供，不是私人文件存储。

运行时脚本经可取消请求下载后通过 Blob URL 执行。站点 CSP 需允许对应资源请求与 Blob 脚本；插件不会自动放宽安全头。模型视觉、来源许可和实际浏览器兼容性仍由管理员确认。

## 升级与迁移

正常升级保留 uploads 中的 Core、模型、缩略图、角色配置和用户偏好。升级前备份数据库与 `uploads/wzf-mascot/`；迁移站点时两者都要迁移。停用插件也保留资源，角色回收站不执行永久文件删除。

更多管理操作见[常见问题与维护](TROUBLESHOOTING.md)，台词与手机设置见[互动指南](INTERACTIONS.md)。
