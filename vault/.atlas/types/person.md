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
  variants:
    kind: multiSelect
    label: Misheard as
---

# Person

Someone. `company` points at a company and nothing else.

Person is built in: `@` mentions find people by it, so it cannot be deleted.
Its properties are yours to change.

`aliases` are other spellings of their name — a nickname — for matching
attendees to them; they never change text. `variants` are how a notetaker
mishears the name: Atlas corrects each to it, as it does a term's, and the
Terms page lists and edits them. Adding a term named like the person on the
Terms page adds its misheard spellings here.

When a meeting arrives, its attendees are matched to people by `email` or
any of `other_emails`, then by name or alias — so a second address belongs
in `other_emails`, and a meeting where they used it still finds them.
