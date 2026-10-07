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
---

# Company

The example from the plan: `ceo` is a relation to a person, so the picker offers
people and nothing else.
