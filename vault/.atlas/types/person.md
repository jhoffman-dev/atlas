---
name: person
label: Person
properties:
  role: text
  email: text
  company:
    kind: relation
    target: company
  aliases:
    kind: multiSelect
    label: Also spelt
---

# Person

Someone. `company` points at a company and nothing else.

Person is built in: `@` mentions find people by it, so it cannot be deleted.
Its properties are yours to change.

`aliases` are other spellings of their name — a nickname, or how a
notetaker mishears it. Atlas's vocabulary reads them (the Terms page), and
spells each as the name.
