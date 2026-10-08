# Resource-free distribution and licensing

## Current distribution boundary

On 2026-10-08 the maintainer supplied a reply from the Live2D licensing team:
do not distribute Cubism Core or official character models; recommend that users
obtain them from the official website instead. This direction replaces the earlier
bundled 22-character candidate. The old draft's installation ZIP and accompanying
outdated attachments have been withdrawn. Local test archives are not release assets.

The 3.5.1 release contains plugin code, the compiled controller, Framework/shaders,
and relevant notices. It contains **no Cubism Core and no models, textures, motions,
expressions, sample model JSON, or character catalog data**. There are no bundled
characters or automatic downloads. An unconfigured installation emits no mascot
frontend resources. Administrators supply resources separately after obtaining the
necessary rights and accepting the applicable terms.

The maintainer confirmed that the original inquiry described the Expandable
Application and all included components. The licensing team's reply requested
removal of Core and official model assets, with users directed to obtain those
resources themselves. On 2026-10-08 the maintainer explicitly authorized public
release under that boundary. No additional consultation draft is pending.

This is the maintainer's distribution decision based on the supplied correspondence,
not a claim of official certification, endorsement, or a new license grant.
Framework/shaders retain their existing license and notices; publishers and website
administrators must separately satisfy all applicable third-party conditions.
The public repository is `wzf2000/wordpress-live2d-mascot`. Release metadata sets
`public_release_ready=true` to record this maintainer decision, not to certify
licenses or approve unrelated bundled assets.

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
   runtime ZIP as described in README; do not upload a complete SDK, editor project,
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
Small screens (at most 782px) and reduced-motion settings suppress rendering.

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

Historical verification (3.5.0 only): the 3.5.0 runtime passed 18 synthetic regression tests and 37 checks in a
separate WordPress 7.1 / PHP 8.2 installation on 2026-10-08. These covered empty
installation, administrator authorization and nonce, real multipart Core/model
imports, rejected archives with unchanged resources/configuration, rendering with
custom character IDs, selection persistence, mobile suppression, deactivation and
reactivation, and forced reinstallation of the same version. This is not evidence
of cross-version database migration, all models, or all devices. Test resources are
private fixtures and are never bundled. That evidence applies to the tested 3.5.0 runtime; it is not a fresh 37-check
acceptance result for 3.5.1. Version 3.5.1 adds optional server-managed local terms
presentation and plaintext consent compatibility; default installations continue
to use the generic imported-resource terms. No HTML-upload UI or model assets are
added. Version-specific CI and site acceptance must be recorded separately.
