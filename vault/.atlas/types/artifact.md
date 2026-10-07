---
name: artifact
label: Artifact
icon: artifact
properties:
  url:
    kind: url
    label: Link
  kind:
    kind: select
    options: [page, deck, design, doc, other]
  project:
    kind: relation
    target: project
  tags:
    kind: multiSelect
  saved:
    kind: text
    label: Saved copy
  saved_at:
    kind: date
    label: Saved on
  cover:
    kind: thumbnail
    label: Thumbnail
---

# Artifact

Something made in Claude — a page, a deck, a design, a doc — kept in Atlas.
One note per artifact, in `artifacts/`: its `url` is the claude.ai link, and
its body is whatever you want to remember about it.

## The saved copy

`saved` names the folder beside the note that holds a copy of the page —
`index.html` and the files it uses — so the artifact still opens offline,
inside the note, in a sandboxed frame with no access to the app or the vault.
Empty when only the link is kept. Pages hides these folders: the note stands
for its copy.

## Ways in

- **New artifact** (the sidebar's New menu, the search palette, or pasting a
  claude.ai artifact link into it) keeps the link. Atlas cannot fetch a private
  claude.ai page, so the copy comes from a file: drop the `.html` on the
  dialog, or on the note.
- **From Claude**, over the local API: `atlas_save_artifact` in the MCP server
  saves the note and the copy in one call (`vault/docs/api/v1.md`).

## The thumbnail

`cover` fronts the note's card in the Artifacts gallery. When a copy is saved —
from the dialog, by dropping a page on the note, or from Claude — Atlas pictures
its first screen in a webview of its own, with no way back to the app, and keeps
the picture in the copy as `atlas-thumbnail.png`; `cover` then names it. A cover
you set to anything else is yours: Atlas never replaces it on its own.
Regenerate (on the saved copy's toolbar, or on the Thumbnail row) pictures the
copy again and makes it the cover whatever it was; Clear takes it off for good
(`cover: false`), so only Regenerate puts one back. "Generate missing
thumbnails", on the Artifacts view, pictures every copy with no cover that was
not cleared.
Pictures are made on macOS; elsewhere the card keeps its drawn front.

`cover` is a Thumbnail property, the kind any type can have (U-15). An
artifact's page is its saved copy, so its picture is kept in the copy and
`cover` names it; any other type's thumbnail is a picture of the note's own
page, kept in `.atlas-cache/thumbnails`.
