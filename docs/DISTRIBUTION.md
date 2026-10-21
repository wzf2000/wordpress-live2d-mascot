# 发行与许可 / Distribution and licensing


[文档首页](https://github.com/wzf2000/wordpress-live2d-mascot/blob/main/docs/index.md) · [安装指南](https://github.com/wzf2000/wordpress-live2d-mascot/blob/main/docs/INSTALL.md) · [English setup](#administrator-setup)

## 资源由管理员自行取得

公开仓库、安装 ZIP 与源码 ZIP 提供插件代码、编译后的控制器、Framework／着色器及相应许可文件，**不包含 Cubism Core、模型、贴图、动作、表情或角色目录数据**。首次安装没有内置角色，不会自动下载 SDK 或模型；尚未配置资源时不输出看板娘前端资源。

管理员需要从 [Live2D 官方网站](https://www.live2d.com/en/sdk/download/web/)自行取得受支持的 **Web 5 R5 Core**，从[官方样例](https://www.live2d.com/en/learn/sample/)或其他有权来源取得模型，阅读适用条件后再导入。使用官方角色时，应提供权利人要求的署名、来源与特别使用条件；默认的“管理员导入资源”不能代替版权声明。

导入资源保存在 WordPress uploads 中，正常更新插件不覆盖；停用也保留。用于前台展示的文件会公开提供给访问者，此处不是私人文件存储。导入不会授予额外使用或再分发权利，站点资源不得加入 GitHub、安装包或源码包。

## 代码与素材的许可层次

- 自有代码采用 **GPL-2.0-or-later**；`LICENSE` 中的附加许可仅允许与指定 **Cubism SDK for Web 5 R5** 组合，完整 GPL 见 `COPYING`。
- Framework 与着色器保留原有 Live2D 许可。编译引擎包含 Framework，不能将整个引擎重新标为纯 GPL。
- Core、模型、角色及其他第三方内容遵循各自条款；自有代码的附加许可不能代替这些权利人的授权。

维护者根据收到的 Live2D 官方回复，采用“用户自行官网下载 Core 与模型”的发行方式。此决定不表示官方认证、背书或新的许可授予。下方保留英文安装说明、许可链接及历史背景。

## Current distribution boundary

Current releases contain plugin code, the compiled controller, Framework/shaders,
and relevant notices. They contain **no Cubism Core or models, textures, motions,
expressions, sample model JSON, or character catalog data**. There are no bundled
characters or automatic downloads. An unconfigured installation emits no mascot
frontend resources. Administrators obtain resources separately and satisfy their
applicable terms, attribution and source requirements.

Following the Live2D licensing team's reply supplied by the maintainer on
2026-10-08, users are directed to obtain Core and official models from the official
website. The earlier bundled candidate's outdated attachments were withdrawn;
local archives are not release assets. This distribution decision is not official
certification, endorsement or a new grant of third-party rights.

## Administrator setup

1. Install the plugin ZIP in WordPress and open its administrator settings page.
2. Obtain Cubism SDK for Web from the [official SDK page](https://www.live2d.com/en/sdk/download/web/).
   The release supports the fixed Web 5 R5 Core bytes identified by its SHA-256;
   a different download is rejected rather than silently treated as compatible.
   Do not use an unversioned CDN or a third-party mirror as a substitute.
3. Import the supported Core JavaScript file through the settings page. The plugin
   checks its hash before storing it; it does not fetch Core or run upload content
   on the server.
4. Obtain a model from the [official sample page](https://www.live2d.com/en/learn/sample/)
   or another source for which you have the necessary rights. Prepare one model's
   runtime ZIP as described in the installation guide; do not upload a complete SDK, editor project,
   or collection of multiple models. Import using the administrator settings page.
5. Confirm the character's attribution and applicable conditions. On a desktop
   frontend page, enable the mascot, read its terms, and verify the display.

Imported resources are site-managed data in the WordPress uploads area, outside
the plugin directory. Updating the plugin must not replace them. These files are
served publicly when used on the frontend; importing is not a private file-storage
service and does not grant redistribution rights. Do not add these site files to
GitHub, installation ZIPs, or source archives. Imported resources and preferences
are retained on deactivation; resource removal is a separate administrator action.

The browser still requires WebGL and appropriate CSP settings for resource requests
and Blob scripts. The plugin must not automatically relax site security headers.
Small screens (at most 782px) suppress rendering by default. Mobile rendering requires the administrator to enable it and the reader to opt in separately in that browser. Reduced-motion settings always suppress rendering.

## License layers

Original code is GPL-2.0-or-later with the explicitly approved additional permission
in LICENSE for combination with Cubism SDK for Web 5 R5. This permission covers only
the maintainer's own rights; it does not grant rights to Core, Framework, models,
WordPress, or other third-party work. GPL text is in COPYING.

Framework and shaders retain their original Live2D notices. The compiled engine
includes Framework and cannot be relabeled as entirely GPL. The Core-related notices
and supported hash are documentation, not a bundled Core implementation.

- [Core license](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)
- [Framework license](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html)
- [Material license](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)
- [Sample model conditions](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)
- [SDK publication licensing](https://www.live2d.com/en/sdk/license/)

<details>
<summary>Historical verification: 3.5.0–3.5.2</summary>

Historical verification (3.5.0 only): the 3.5.0 runtime passed 18 synthetic regression tests and 37 checks in a
separate WordPress 7.1 / PHP 8.2 installation on 2026-10-08. These covered empty
installation, administrator authorization and nonce, real multipart Core/model
imports, rejected archives with unchanged resources/configuration, rendering with
custom character IDs, selection persistence, mobile suppression, deactivation and
reactivation, and forced reinstallation of the same version. This is not evidence
of cross-version database migration, all models, or all devices. Test resources are
private fixtures and are never bundled. That evidence applies to the tested 3.5.0 runtime; it is not a fresh 37-check
acceptance result for 3.5.1 or 3.5.2. Version 3.5.1 adds optional server-managed local terms
presentation and plaintext consent compatibility; default installations continue
to use the generic imported-resource terms. No HTML-upload UI or model assets are
added. Version-specific CI and site acceptance must be recorded separately.

Version 3.5.2 retains the 3.5.1 resource and presentation behavior. It adds a named
settings link for site/network plugin action rows and a permission-gated settings
link in this plugin's metadata row. These are navigation changes, not new resource
imports or a change of terms. Their release checks must not be described as a new
37-check installation/model validation.

</details>
