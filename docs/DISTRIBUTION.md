# Resource-free distribution and licensing

## Current distribution boundary

On 2026-10-08 the maintainer supplied a reply from the Live2D licensing team:
do not distribute Cubism Core or official character models; recommend that users
obtain them from the official website instead. This direction replaces the earlier
bundled 22-character candidate. The old draft's installation ZIP and accompanying
outdated attachments have been withdrawn. Local test archives are not release assets.

The 3.5.0 candidate contains plugin code, the compiled controller, Framework/shaders,
and relevant notices. It contains **no Cubism Core and no models, textures, motions,
expressions, sample model JSON, or character catalog data**. There are no bundled
characters or automatic downloads. An unconfigured installation emits no mascot
frontend resources. Administrators supply resources separately after obtaining the
necessary rights and accepting the applicable terms.

The repository and candidate release remain private/draft. The official reply does
not expressly resolve Framework redistribution or whether the revised importer
makes this an Expandable Application. Removing Core/models does not itself establish
publication approval or exemption.

## Administrator setup

1. Install the plugin ZIP in WordPress and open its administrator settings page.
2. Obtain Cubism SDK for Web from the [official SDK page](https://www.live2d.com/en/sdk/download/web/).
   The candidate supports the fixed Web 5 R5 Core bytes identified by its SHA-256;
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

The 3.5.0 candidate passed 18 synthetic regression tests and 37 checks in a
separate WordPress 7.1 / PHP 8.2 installation on 2026-10-08. These covered empty
installation, administrator authorization and nonce, real multipart Core/model
imports, rejected archives with unchanged resources/configuration, rendering with
custom character IDs, selection persistence, mobile suppression, deactivation and
reactivation, and forced reinstallation of the same version. This is not evidence
of cross-version database migration, all models, or all devices. Test resources are
private fixtures and are never bundled. The final candidate's runtime bytes match
the tested installation; subsequent documentation and test additions do not change
that runtime.

## Follow-up to the licensing team (not sent by the assistant)

The maintainer has stated that this is an individual, free project with no related
commercial revenue. The remaining questions can be sent through the existing email
thread or the [official contact form](https://www.live2d.jp/eng/contact/?redirect=1):

> Thank you for clarifying. We will exclude Cubism Core and all official character
> model assets from the plugin, source archives, and release attachments. Website
> administrators will be directed to your official download pages and will download
> and import the required resources themselves after accepting the applicable terms.
>
> May we distribute Cubism Framework and our compiled controller containing Framework
> code, while excluding Core and all official model assets? Our original code is
> GPL-2.0-or-later with an explicit Web 5 R5 combination permission; third-party
> components retain their own licenses.
>
> Would this revised plugin, with administrator import of separately obtained Core
> and model resources, require approval or a Publication License Agreement as an
> Expandable Application? What obligations apply separately to the plugin publisher
> and website owners?

No further licensing response has been recorded. A build, private upload, or successful
test does not change this boundary or authorize public release.
