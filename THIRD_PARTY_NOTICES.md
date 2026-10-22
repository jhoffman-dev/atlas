# Third-party notices

DFAI's own code is MIT (see `LICENSE`). A built app also carries the work of others,
whose licences ask that their notice travels with it. This file ships in the app's
`dist` folder as `THIRD_PARTY_NOTICES.txt`; each licence text named below ships
beside the files it covers, under `pdfjs/`.

This file lists what is bundled into the _reader_ and its data files (#504). The npm
dependencies of the rest of the app keep their licences in `node_modules` and in
`pnpm-lock.yaml`; a full generated list is a release task (see `RELEASING.md`).

## pdf.js (pdfjs-dist)

Reads and draws PDFs in the reader. Its code is bundled into the reader's chunk and its
worker script is shipped as a file.

- Copyright Mozilla Foundation and contributors
- Licence: Apache License 2.0 — `pdfjs/LICENSE`
- Source: https://github.com/mozilla/pdf.js

## Files pdf.js reads, shipped under `pdfjs/`

| Folder                  | What it is                                     | Licence file                                                           |
| ----------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| `pdfjs/cmaps/`          | Adobe character maps for East Asian text       | `pdfjs/cmaps/LICENSE` (Adobe, BSD-style)                               |
| `pdfjs/standard_fonts/` | Foxit and Liberation fonts for the standard 14 | `LICENSE_FOXIT` (BSD-style), `LICENSE_LIBERATION` (see its own text)   |
| `pdfjs/wasm/`           | JBIG2, OpenJPEG and qcms image decoders        | `LICENSE_JBIG2`, `LICENSE_OPENJPEG`, `LICENSE_QCMS`, `LICENSE_PDFJS_*` |

The Liberation fonts are licensed under the GNU General Public License v2 _with the
font exception_: a document made with the fonts is not itself covered. The fonts are
data files, loaded by address, and are not linked into DFAI's code.
