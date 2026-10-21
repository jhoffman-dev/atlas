---
name: company
label: Company
properties:
  stage:
    kind: select
    options: [seed, series-a, series-b, public]
  founded: date
  site: url
  domains:
    kind: multiSelect
    label: Email domains
  ceo:
    kind: relation
    target: person
  employees:
    kind: relation
    target: person
    many: true
  aliases:
    kind: multiSelect
    label: Also spelt
  variants:
    kind: multiSelect
    label: Misheard as
---

# Company

The example from the plan: `ceo` is a relation to a person, so the picker offers
people and nothing else.

Company is built in: meetings and terms point at companies, so it cannot be
deleted. Its properties are yours to change.

`aliases` are other spellings of its name — a short form — for matching
meetings to it; they never change text. `variants` are how a notetaker
mishears the name: DFAI corrects each to it, as it does a term's, and the
Terms page lists and edits them. Adding a term named like the company on the
Terms page adds its misheard spellings here.

A meeting is linked to a company when an attendee's address is at one of
its `domains` (or its `site`'s), or at a domain named for it
(`larkspur.example` for "Larkspur").
