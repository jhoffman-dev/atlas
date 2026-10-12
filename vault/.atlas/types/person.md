---
name: person
label: Person
properties:
  role: text
  email: text
  other_emails:
    kind: multiSelect
    label: Other emails
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

When a meeting arrives, its attendees are matched to people by `email` or
any of `other_emails`, then by name or alias — so a second address belongs
in `other_emails`, and a meeting where they used it still finds them.
