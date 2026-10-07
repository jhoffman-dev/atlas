---
type: adr
status: accepted
date: 2026-09-22
---

# The host walks the vault and is told what to skip

## Context

ADR-0005 says Rust reads files and stores rows, and every decision stays in
TypeScript. `collect_notes` did not honour that. It skipped every directory
whose name began with a dot, plus `node_modules`, before the list ever crossed
IPC — a rule about what a note _is_, living in the host.

For a long time this was invisible, because `isVisibleEntry` looked only at an
entry's own name. The host's copy was the stricter of the two and quietly kept
`.git` out of the index. A13-04 made `isVisibleEntry` inspect every segment of a
path, which made it total: it can now be asked about a flat list of every note in
the vault and get the right answer without the caller having ruled anything out.
That left the host's copy as the only remaining one, and the two were no longer
saying the same thing — `.atlas` notes are user space to TypeScript and did not
exist at all to Rust.

The straightforward fix, the host returning everything, has a cost that is not
theoretical. A vault with a `node_modules` in it holds tens of thousands of
paths. Sending them all across IPC on every vault open, so the frontend can
discard them, would make a rule we care about into a performance bug.

## Decision

The host walks the vault and returns what is on disk. It is **handed** the
directory names not to descend into; it does not choose them.

- `list_notes` takes `skipDirectories`. With none, it walks everything, including
  dotted folders. It has no opinion about what a dot means.
- The list is `HIDDEN_DIRECTORY_NAMES` in `packages/domain/src/vault/vault-visibility.ts`
  — the same constant `isVisibleEntry` checks against, not a copy of it.
- `listVaultNoteFiles` is the one place the rule is applied, and both the note
  list the editor resolves links against and the index refresh go through it.

Handing over the list is what keeps this on the right side of ADR-0005. Every
name in it is rejected unconditionally, on any path segment, by the first line of
`isVisibleEntry`, so a walk that stops there drops exactly the entries the filter
would have dropped. It is an optimisation of one rule, not a second rule. A
domain test asserts that property, because the moment it stops holding — a name
whose visibility depends on where it sits, such as `.atlas` — the host would be
deciding again.

## Consequences

- `.atlas` notes are now what `isVisibleEntry` always said they were: ordinary
  notes. They are wiki-link targets, they appear in `[[` autocomplete, they are
  indexed and searchable, and they count in the `taken` set when a new note is
  named. A type definition or a template is a note you can already open in the
  tree; it being unlinkable was the inconsistency, not the fix.
- `.atlas/views` and `.atlas/dashboards` stay out of all of that, as before,
  because a section of the sidebar already lists them and `isVisibleEntry`
  excludes them. `loadSidebarCatalog` still reads those two folders directly.
- `refreshIndex` used to call `fs.listNotes` raw. The host's pruning was the only
  thing keeping `.git` and `node_modules` out of the index — nothing in
  TypeScript said so. It now shares the filtered listing, which also means a note
  that cannot be linked to cannot turn up in search: one answer, not two.
- Cost is unchanged in practice. The host walks what it walked before, plus the
  dotted folders nobody named — in a real vault, `.atlas` and its handful of
  notes. What it no longer does is decide that `.secret` is one of those.
- Measured on a release build, over a vault of 2,000 notes plus ten in `.atlas`
  and a deliberately modest `node_modules` (200 packages, 50 files each): the
  walk as shipped finds 2,010 notes in **4.7 ms**; the same walk with nothing
  skipped finds 12,010 in **39 ms**, and the extra ten thousand entries then have
  to cross IPC and be filtered. A real `node_modules` is an order of magnitude
  larger again. That gap is the whole argument for handing over a list rather
  than returning everything.
- Adding a folder to the skip list is a domain change and nothing else. Adding a
  rule that depends on **where** a note sits belongs in `isVisibleEntry` and must
  not go in the list.
