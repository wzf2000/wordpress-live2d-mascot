# Live2D Show — official samples edition

This source candidate corresponds to the accompanying installation ZIP and its
SHA256SUMS/release-manifest.json. It contains 22 official sample characters in its
configuration. User-created character assets are excluded. Original code uses
GPL-2.0-or-later with the additional Web 5 R5 permission specified in LICENSE;
third-party components retain their separate licenses. Local candidate status
does not authorize public redistribution: read LICENSE, COPYING and
docs/DISTRIBUTION.md before distribution.

The installation ZIP has a live2d-show/ root and contains all runtime resources.
The source ZIP has a live2d-show-source/ root; its plugin/ initially contains only
configuration, PHP, notices and terms. Binary models and Core are in the matching
installation ZIP. To reproduce or package, unpack both ZIPs and copy the contents
of live2d-show/ into live2d-show-source/plugin/. Keep the matching archives and hashes.

Requirements: Python 3, Node.js, esbuild exactly 0.25.12; PHP 8.2 and a separately
installed Playwright/Chromium for the optional browser smoke. Tools do not download
models or modify a WordPress site.

From live2d-show-source/:

```sh
python3 -m unittest discover -s tests -p 'test_release_package.py'
python3 build.py --esbuild /path/to/esbuild
```

build.py writes the rebuilt engine/loader/CSS and haru-assets.json to build/.
Compare them to the corresponding files in plugin/. To package intentional source
changes, copy the newly generated haru-engine-*.js, haru-loader-*.js, haru-css-*.css
and haru-assets.json from build/ into plugin/ after review; preserve the other
runtime resources from the matching installation ZIP. Then run:

```sh
python3 tools/package_release.py --out build/repacked-candidate
node tests/release-smoke.cjs plugin /path/to/node_modules/playwright
```

The packager accepts the matching 22-character official edition or the explicitly
recognized original site input, rejects unknown characters/roots and verifies
asset hashes. It checks loader/CSS source bytes against the runtime but does not
compile engine source to prove correspondence: rebuild with the fixed esbuild and
compare the engine hash separately. Existing output directories are refused. Every output remains a
license-pending local candidate, with installation ZIP, source ZIP and SHA256SUMS.
The browser smoke uses WordPress PHP stubs; it does not replace a real WordPress
installation/activation test.

Framework source retains its separate license. The project license applies only
to the listed original code; included third-party components are not relicensed.
