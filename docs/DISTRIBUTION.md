# 完整发行包与许可边界

## 发行目标

面向 GitHub Releases 的可独立安装 WordPress ZIP，顶层为 `live2d-show/`。
当前准备的是 3.4.0 官方样例本地候选：保留插件功能和 22 个现有官方角色，排除
`misaka-summer` 及其全部素材。生产的 23 角色配置不随发行候选改变。

完整包包含 PHP 入口、当前哈希资源、Core、着色器、角色清单、模型运行引用、
动作/表情目录、贴图、条款及许可说明。无须从现有站点复制模型。
Git 源码快照受忽略规则影响，不等于完整包；旧五文件增量包也不能用于全新安装。
打包命令、校验及候选文件位置见 README 的完整发行章节。

## 安装与使用

许可条件确认后，将安装 ZIP 通过 WordPress 后台“插件 → 安装插件 → 上传插件”安装并启用。
这是完整 ZIP，不能把配套源码 ZIP 当作安装包。当前约 60 MB；若主机上传限制更小，
可由管理员使用 `wp plugin install /path/to/installation.zip --activate` 或按正常插件部署流程上传。
不要通过降低站点安全限制绕过主机策略。

访客在桌面页面点击“显示看板娘”，阅读并同意条款后显示 Haru，再从互动面板预览或确认角色。
角色选择、收藏及布局存于当前浏览器；注册用户还可在个人资料页关闭前台显示。
手机宽度不超过 782px 或开启减少动画时不加载模型。这是既定行为，不是安装失败。

本包包含显示所需的 Core、着色器、模型与贴图，无需访问开发者站点获取运行资源。
管理员仍应核对自身站点的 CSP 是否允许模型请求及 `script-src blob:`，不能自动放宽安全策略。
卸载前自行决定是否保留用户显示偏好；本插件无自动清除用户元数据的卸载脚本。

## 许可分层

用户已选择自有代码采用 GPL-2.0-or-later，适用范围见根目录 LICENSE，原文见 COPYING。
以下第三方组件不被重新授权：

| 组件                       | 已有依据                                                         | 发行核对                                       |
| -------------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| Cubism Core Web 5 R5       | Core-LICENSE.md、Core-RedistributableFiles.txt、source-lock.json | 核对固定原始字节、发行条件和接收者条款         |
| Cubism Framework / shaders | Framework-LICENSE.md、固定 Framework commit                      | 保留原声明；不能给组合 engine 整体标 GPL       |
| 22 个官方角色              | 官方来源记录、Free Material License、各角色特别条款              | 保留署名、角色限制和来源；不能当作无条件素材包 |
| 御坂夏季校服               | 自制来源说明只涉及本站同人展示                                   | 明确排除；自制不等于拥有原作角色分发权益       |

官方角色集合：Haru、Mao、Hiyori、Mark、Rice、Wanko、Ren、Epsilon、Chitose、Hibiki、
Izumi、Haruto、Koharu、Ni-j、Nico、Nietzsche、Nipsilon、Nito、Shizuku、Tororo、Hijiki、
Gantzert & Felixander。Nito 的四个变体依据现有官方归档来源链，不按陌生网络包判断。
不加入 Natori、历史 49 模型方案、声音文件或编辑工程。

## 发行状态与剩余条件

截至 2026-10-06，仅本地候选，`public_release_ready=false`：

1. **组合许可兼容性**：当前 engine 将自有代码与 Framework 编译到同一文件。
   Framework 协议 5.6、Core 协议 5.3.2/6.8 限制对其施加其他许可。
   用户已同意在自有代码 LICENSE 中加入仅针对 Cubism SDK Web 5 R5 的组合例外。
   该例外不替第三方授权，仍须满足 SDK 组合分发条件，不宣称获得 Live2D 的确认。
2. **SDK 发行资格**：Core 协议 1.5、2.1–2.2 涉及可扩展应用及发行豁免条件。
   插件支持维护者更换/增加角色，是否属于该类须结合实际发行产品向权利方确认；
   本文不自行判定，也不代替发行者接受协议、作资质声明或申请授权。
3. **素材与条款**：官方来源与单站使用记录不是无条件再分发证明。需按完整插件的
   分发方式确认官方素材条款、署名、接收者限制及模型特别条件。候选已排除御坂。
4. **源码交付**：配套源码 ZIP 提供自有代码、Framework 原始源码和构建脚本，
   公开发行时必须与安装 ZIP 一同交付并固定版本。已创建私有准备仓库
   [wzf2000/wordpress-mascot](https://github.com/wzf2000/wordpress-mascot)，仅保存经过整理的
   官方版源码及候选附件；不得用旧站点 main 提交冒充当前源码。
5. **安装验收**：真实全新 WordPress 7.1 / PHP 8.2.32 / MariaDB 11.4.2，
   使用 WP-CLI 2.12.0 安装 ZIP 并激活；499 个安装文件逐项哈希一致，19 项检查通过，
   包括首次访问无重资源、条款同意、Haru/Mao 渲染、个人资料 nonce 拒绝与有效保存、
   关闭账户显示、停用/再启用和偏好保留。使用调用真实 wp_head/wp_footer 的最小测试主题
   及 Chromium 140 / SwiftShader；未覆盖后台上传、默认主题矩阵、多站点、旧版 WP 或真 GPU。
   后续仅许可/说明变动的候选可在运行文件逐字节一致时复用该验收，不能声称测试过不同运行代码。

用户已授权私有 GitHub 同步；候选仅存私有仓库的草稿发行，不公开、不部署、不改生产配置。
工具没有把许可标记改为通过的开关。
后续发布须以已确认的许可和实际验收为依据；本页是持续维护的发行契约，不是法律结论。

## 官方核对入口

2026-10-06 读取当前官方文本：

- [Core Proprietary Software License](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)
- [Framework Open Software License](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html)
- [Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)
- [模型特别条款](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)
- [SDK 发行许可说明](https://www.live2d.com/en/sdk/license/)

这些链接不重新授权素材；本地 upstream 许可记录保留原样，不用网页新条款覆盖历史快照。

## 已确认的自有代码链接例外

下列方案保留 GPL-2.0-or-later，仅对作者有权授权的自有代码增加指定 SDK 组合权限。
用户已于 2026-10-06 确认并写入 LICENSE；它不替代 Live2D 的许可，不涵盖 WordPress
或其他第三方 GPL 代码，也不保证某应用已取得 SDK 发行资格。

> As an additional permission for code in this project that is owned by wzf2000,
> you may combine that code with the Cubism Framework and Cubism Core included
> in Live2D Cubism SDK for Web 5 R5, under their respective Live2D licenses, and
> distribute the resulting combination. The GNU GPL version 2 or, at your option,
> any later version continues to apply to the project-owned code, including its
> corresponding-source obligations. This permission does not relicense any
> Live2D component, model, WordPress code, or other third-party work, and grants
> no rights beyond those held by the grantor. You must separately comply with
> the licenses and publication requirements applicable to those works.

这是针对本项目需求授予的附加许可，非 Live2D 官方标准例外或法律意见；SDK 升级时须复核。
依据：[GNU GPL v2 FAQ 关于不兼容库与例外的说明](https://www.gnu.org/licenses/old-licenses/gpl-2.0-faq.html#GPLIncompatibleLibs)。

## 向 Live2D 询问的产品事实与问题（供发行者自行提交，尚未发送）

入口：[Live2D 官方联系表单](https://www.live2d.jp/eng/contact/?redirect=1)，选择 Cubism SDK → SDK Release License；
参考 [SDK 发行说明](https://www.live2d.com/en/sdk/license/)，
[可扩展性应用说明](https://www.live2d.com/en/sdk/license/expandable/)。
不要在取得回复前将“不确定”改写为“获得豁免”，也不要把咨询草稿当作已经发送。

用户已确认个人名义免费发布、无插件收费或广告、无相关商业收入。可提交以下咨询：

> 我计划通过 GitHub 发布一个 WordPress 看板娘插件及可独立安装的 ZIP。
> 使用 Cubism SDK for Web 5 R5，Core 保持原始字节，Framework 与自有 TypeScript
> 控制器一起编译。安装包带 22 个既有 Live2D 官方原创样例角色的运行资源，不含声音、
> 编辑工程、联名角色或第三方同人模型；保留官方署名和各角色条件。访客在浏览器中
> 选择内置角色，展示前同意条款。运行插件没有面捕、模型创作或后台模型上传接口；
> 但网站维护者可以编辑文件/注册表替换或增加模型，另有源码维护工具。
> 自有代码采用 GPL-2.0-or-later 并附针对上述 SDK 的明确链接例外，SDK/模型不改授许可。
> 我以个人名义免费发布，不对插件收费、不含插件广告，目前无相关商业收入（低于每年 1,000 万日元）。
>
> 请确认：
>
> 1. 此种可安装插件是否属于 Expandable Application？若否，应适用何种发行方案及豁免条件？
> 2. 是否允许随插件 ZIP 分发上述 Core、Framework 与官方样例运行数据，并让其他站长部署？
> 3. 是否允许另行公开 Framework 与自有控制器源码？对于 GPL 自有代码的 SDK 链接例外，
>    是否还有必须满足的组合发行要求？
> 4. 需要哪些最终用户条款、署名、标识、申请或书面许可？插件作者与安装者各自承担哪些要求？

这份咨询不包含模型文件、账号凭据或私有运维材料。
