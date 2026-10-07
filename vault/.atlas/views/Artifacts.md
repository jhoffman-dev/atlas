---
atlas: view
type: artifact
layout: gallery
description: Everything saved from Claude, by kind. Filter by project or kind from the toolbar.
groupBy: kind
columns: [kind, project, tags]
sorts:
  - key: saved_at
    direction: desc
limit: 500
---

# Artifacts

Every artifact note, as cards: a picture of its saved copy's first screen on
the front — its thumbnail, made when the copy is saved — or its kind and title
when it has none. "Generate missing thumbnails" makes the ones that are not
there yet. Grouped by `kind`; the toolbar's Filter narrows it to a project or
a kind.
