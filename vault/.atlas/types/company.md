---
name: company
label: Company
properties:
  stage:
    kind: select
    options: [seed, series-a, series-b, public]
  founded: date
  site: url
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
---

# Company

The example from the plan: `ceo` is a relation to a person, so the picker offers
people and nothing else.

Company is built in: meetings and terms point at companies, so it cannot be
deleted. Its properties are yours to change.

`aliases` are other spellings of its name — a short form, or how a notetaker
mishears it. Atlas's vocabulary reads them (the Terms page), and spells each
as the name.
