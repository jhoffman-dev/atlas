---
name: term
label: Term
icon: term
properties:
  variants:
    kind: multiSelect
    label: Misheard as
  kind:
    kind: select
    options: [product, person, company, acronym, other]
  refers_to:
    kind: relation
    target: company
    label: Refers to
---

# Term

A name Atlas should spell right: a product, a colleague, a vendor, an acronym.
The note's title is the one right spelling; `variants` are the ways a
notetaker mishears it (`lark spur`, `Larks Burr` for Larkspur). Terms are
listed, added and edited on the Terms page.

Term is built in: the Terms page lists its notes, and Atlas spells names by
them, so it cannot be deleted. Its properties are yours to change.

## The vocabulary

Every term's title and variants, and every Person's and Company's name and
`aliases`, make one vocabulary, longest spelling first. A name is its own
right spelling, so a Person needs no term. Spellings match however they are
cased or spaced.

A spelling two notes claim for two different right spellings is a conflict:
the Terms page shows it, and it is not used until one of them lets it go.

## refers_to

What the term names, when that is a note: the company a product or an
acronym belongs to. A relation points at one type, so it is Company here; a
misheard person is better given an alias on their Person note.
