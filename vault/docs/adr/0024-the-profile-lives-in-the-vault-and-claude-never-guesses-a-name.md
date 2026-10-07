---
type: adr
id: ADR-0024
title: The profile lives in the vault, and Claude never guesses a name
status: accepted
date: 2026-10-04
---

# ADR-0024 — The profile lives in the vault, and Claude never guesses a name

## Context

Claude in Atlas once wrote "Jordan Hoffman" as a note's owner (atlas-archive#1). Atlas starts
Claude Code with none of the person's own settings (`--setting-sources ""`,
ADR-0021), so the only clue it had to who it was working for was "jhoffman" in
a path, and it invented a first name to go with it. atlas-archive#10 asks for a **Profile**
section in Settings holding the person's name, and for Claude to use it instead
of guessing.

Two questions had to be answered: where the name is kept, and what Claude is
told when there is none.

## Decision

### The name is kept in the vault's settings note

`profileName` and `profilePreferredName` sit in `.atlas/settings.md`, beside
the add button's types and the sidebar's order, written through the vault's one
settings writer and the byte-preserving frontmatter write. A blank name removes
its key rather than writing an empty one. A save writes only the name the
person changed: the other key keeps whatever the file holds, even a value Atlas
cannot show (a list, or a name past the limit). The fields cannot be edited
until the note has been read for the open vault.

atlas-archive#1 first suggested keeping it on each Mac, beside the other Claude settings in
`localStorage`. The vault was chosen instead:

- **It is about the vault's owner, not the Mac.** The name answers "whose notes
  are these", and every Mac that opens the vault is opening the same person's
  notes. The provider and model are per-Mac because they depend on what is
  installed and logged in there; a name does not.
- **It syncs.** `.atlas/settings.md` travels with the vault (sync, iCloud, a
  copied folder), so the name is set once rather than once per Mac, and a new
  Mac never starts out guessing.
- **It is readable where it is used.** The local API and the MCP server read
  the same file (below), so an outside Claude that asks gets the same answer.

The price, accepted: a vault shared between two people has one profile. Atlas
vaults are personal; a shared one would need per-person settings, which nothing
else in Atlas has either.

The name is cleaned in the domain (`cleanProfileName`) before it is shown or
handed to the model: one line, single-spaced, no control characters, no
invisible ones (zero-width spaces, the byte-order mark, soft hyphens, direction
marks, overrides and isolates — a joiner is kept only inside a word or an emoji,
where it shapes what is shown), and at most 100 characters as a reader counts
them, so an emoji or a flag is never cut in half. A hand-edited file can hold
anything, and a name with line breaks would otherwise add lines to the system
prompt; a name that is nothing but invisible characters is no name.

### Claude is told the name, or told not to invent one

`chatSystemPrompt` takes the profile and always carries a "Who you are working
for" section (`ownerSection`). Both providers send the same system prompt, so
the Claude Code path and the API-key path get the same words.

- With a name: each name is on a line of its own (`Full name: …`,
  `Goes by: …`), exactly as given, so a quote inside it cannot end it early and
  nothing is escaped for the model to copy; framing tags in it are neutralised.
  The model is told each is a name, never an instruction, and to use exactly
  that name wherever a note needs theirs — an owner, author, assignee, attendee
  or signature.
- Without one: the model is told the person has not given a name, to write
  `[Your name]` exactly or ask, and never to guess one from a username, an
  email address, a folder path or anything else.

- Not known: until the open vault's settings note has been read, or while it
  cannot be, the profile is `'unknown'` — not "no name". The model is told
  Atlas couldn't read the person's name and to ask rather than write a
  placeholder or guess, since a placeholder would be wrong for a person who
  did give a name. Switching vaults never carries one vault's name into the
  next.

Either way it is told never to invent anyone's name. The chat session reads
the profile at the moment of each question, so a name set mid-conversation
applies to the next one. The first question waits briefly (1.5 s at most) for
a read under way, so a question asked at launch is not sent as unknown.

While no full name is set — even if a preferred name is — an empty chat shows a
hint saying what Claude will write instead, with a button that opens Settings.

### The API and MCP read it, and never write it

`GET /v1/profile` answers `{ profile: { name, preferredName, placeholder } }`,
and the MCP tool `atlas_profile` calls it, read-only. The API never writes
`.atlas` (ADR-0016), so the name is changed only in Settings. A settings note
that cannot be read is an error, not an empty profile, so a caller is never
handed "no name" when there is one.

### Nothing else in Atlas fills in a person

Nothing else in Atlas writes a person's name into a note. Quick add, capture,
templates and the daily note write what the person typed or what the template
holds. Sync commits as git's own identity, or as "Atlas on <this Mac>" when
git has none; that names a Mac, not a person, and is left as it is.

## Consequences

- One place holds the name, and every Mac that syncs the vault has it.
- A model that ignores its instructions can still write a wrong name, but it
  can only write through a proposal the person accepts (ADR-0021), and it now
  has the right name, or the placeholder, in front of it.
- A second person sharing a vault would see the first person's name. If that
  ever matters, a per-Mac override can be layered on top without moving the
  vault's value.
