---
type: adr
id: ADR-0006
title: A property edit writes frontmatter, through the same save as the body
status: accepted
date: 2026-09-21
---

# ADR-0006 — A property edit writes frontmatter

## Context

Until now frontmatter was opaque: read for the index, carried through a save byte
for byte, never written. A properties panel has to write it, and that raises two
problems at once.

The first is fidelity. Rebuilding a YAML block from parsed values loses comments,
key order, quoting style and the difference between a block list and an inline one.
That is the same failure the block serializer exists to avoid, one level down.

The second is losing work. A property panel that writes the file by itself would
write whatever body was last saved — discarding anything typed since.

## Decision

Frontmatter is edited as a YAML _document_, not rebuilt from values. The `yaml`
package's `parseDocument` keeps everything it was not asked to change; only the
named keys are set or deleted. Writing is configured not to wrap long lines and
not to pad inline collections, so an untouched line comes back byte for byte.

A property change goes through `saveNote` with a `changes` argument, alongside the
serialized body. One write path, so a property edit cannot discard unsaved text and
a body save cannot discard a property.

Relation values are stored as wiki links and therefore quoted: unquoted,
`[[Ada Lovelace]]` is a nested YAML sequence rather than a string. Obsidian writes
them the same way.

## Consequences

- Editing a property rewrites one line. Comments, ordering and list style survive,
  which is checked by a test asserting that a change of _nothing_ returns the block
  unchanged.
- Property edits save immediately. There is no separate dirty state to reconcile.
- A relation picker offers only notes of the target type, answered by the index
  rather than by scanning. A type with no notes yet offers nothing, which is
  correct and not an error.
- Types and templates are ordinary notes under `.atlas/`, so they travel with the
  vault and can be edited in the app itself.
