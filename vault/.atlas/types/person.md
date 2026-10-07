---
name: person
label: Person
properties:
  role: text
  email: text
  company:
    kind: relation
    target: company
---

# Person

Someone. `company` points at a company and nothing else.
