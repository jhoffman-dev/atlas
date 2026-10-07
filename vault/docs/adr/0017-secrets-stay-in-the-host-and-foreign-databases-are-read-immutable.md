---
type: adr
status: accepted
date: 2026-09-26
---

# Secrets stay in the host, and a foreign database is read immutable

## Context

[ADR-0012](0012-external-data-arrives-as-notes.md) left two things out of
sources: a token to fetch a private feed with, and someone else's SQLite file.
Both are P12-06. A source note is text in Git, so a token cannot be written in
one; and a database another program owns cannot be opened the way Atlas opens
its own index.

## Decision

### Secrets

A source names a secret and never holds it: `{{secret:github}}` in its `url:`
or a header value, or `auth: { secret: github }`, which is a bearer
`Authorization` header (`scheme:` changes the word). The value lives in the
macOS login Keychain, service `dev.jhoffman.atlas`, account
`<vault>/<name>`, where `<vault>` is the first 16 hex digits of the SHA-256 of
the vault's canonical path — so two vaults that both say `github` never read
each other's token.

**The webview never receives a value.** TypeScript splits each template into
text and names (`TemplatePart[]`) and sends that; the host fills the names in
from the Keychain as the request leaves. There is no `secret_get`: the commands
are `secret_list` (names and the sites each may go to), `secret_set`,
`secret_bind` and `secret_delete`, and a test on
the IPC contract fails if another secret command appears. What comes back —
the body and any error — has every value that went out struck from it, because
a server that echoes its headers would otherwise write the token into a note.
The host logs a request by its template, never its values; reqwest errors are
reported without their URL; a keyring error is described by its kind, since one
variant carries the undecodable bytes.

A request that carries a secret goes over https only, and does not follow a
redirect off its origin — scheme, host and port: reqwest drops `Authorization`
on the way to another host, but not a secret in a header of any other name, and
not on the way to another port of the same host.

**Each secret is bound to the sites it is for** (A19-01). A source note is text
anyone could have written — a synced vault, an MCP client through the local
API — so the note cannot be what decides where a Keychain value goes; before
this, one naming `github` could send it to any https host, with no click at
all if the note was open and had `interval:`. Now:

- Settings asks for the sites when a secret is added or set (`api.github.com`,
  or several separated by commas), and **Sites…** changes them later.
- The rule for what a site is lives in the domain: `parseSecretOrigins` turns
  what was typed into canonical origins — https only, host in lower case, a
  port only when it is not 443, nothing after it. The host re-parses each one
  as a backstop and stores the exact strings, beside the value in the
  Keychain, under account `<vault>:origins/<name>` (outside the vault, and
  outside the `<vault>/` accounts that list as names).
- **Enforcement is the host's**, because the webview is the untrusted side:
  `prepare` refuses any request whose origin (`Url::origin`) is not one of the
  strings bound to _every_ secret it fills, before anything is sent. That is
  string equality — obeying the domain's rule, not having one (the ADR-0014
  nuance). A secret set before bindings existed has none, and is refused until
  it is bound; Settings says "Sent nowhere until you choose the sites it is
  for".
- Adding a site to a value the Keychain already holds (`secret_bind`, which
  moves where an existing value may go) is asked in a native dialog, which
  script in the webview cannot answer. A value typed now, with its sites, is
  the caller's own and needs no question. The value is written before the
  binding, so a request in between sends the new value to the old sites, never
  the old value to new ones.
- The local API may still rewrite a source note's `url:`; the refresh that
  follows is refused by the binding (`sources-attacks.test.ts` shows the
  request, `a_source_the_api_pointed_at_another_host_is_refused_by_the_binding`
  shows the refusal).
- The binding checks the host, not the path: a note the API wrote could aim
  the `github` token at `https://api.github.com/user/emails` and read the
  answer back as notes. So **a source that sends any secret runs only from
  `.atlas/sources`** (A20-02), which the API cannot write
  (`sourceTrustRefusal` in the domain). The application's refresher enforces
  it for the pane and the API alike, and the API route answers `forbidden`
  before anything is fetched; a pane shows the refusal as the report's error,
  saying to move the note into System → sources. A public feed with no secret
  runs from anywhere. The host cannot be the backstop here: `http_get` is told
  the request, not which note asked, and a note path from the webview would be
  the untrusted side vouching for itself.
- The API refreshes one source at most every 30 seconds (`conflict`, with
  `retryAfter`), so a caller looping on the route cannot hammer a feed in the
  user's name. The refresher that keeps a source from running twice at once is
  made once by the app and injected into the panes and the API, not held in a
  module.

`http_get` fills secrets from the vault the refresh ran in, named with the
request and checked like a write (`root_for_write`): a refresh that finishes
after another vault was opened is refused, never filled from the other's.
`vault` is required on every secret write.

What comes back is struck of every secret in the forms a server echoes one:
as it is, percent-encoded in either case (whole or in part), JSON-escaped, and
as standard or URL-safe base64. Every match of every secret is found before
anything is replaced, and overlapping matches are struck as one span, so a
secret containing another is struck whole. A URL that does not parse is
reported by its template, never its filled value.

The reference syntax is TypeScript's alone. Rust concatenates parts it is
handed and checks only what it must as a backstop: a name that could climb into
another vault's accounts, a header value that would split the request.

Crates: `keyring-core` with `apple-native-keyring-store` (keychain feature),
which is how the keyring-rs maintainers ask applications to link since 4.0 —
the `keyring` crate is now their sample and CLI glue. Tauri Stronghold was the
alternative: it is an encrypted file that still needs its key kept somewhere,
which is the Keychain question again with a second store on top.

### A SQLite file

`format: sqlite`, with `file:` and `query:`. The query's rows become records,
and records become notes exactly as for CSV, JSON and iCalendar — the one path.
Choosing the source as a database on the Query page was the other option and is
left out: it would be a second way to read the same file, with its own rules
for which files a page may name.

Read-only for a file that is not ours means:

- Opened as `file:…?mode=ro&immutable=1` on a connection of its own, per query,
  never ATTACHed to the index. SQLite takes no locks, writes nothing, and
  creates no `-wal`, `-shm` or `-journal` beside the file.
- The statement goes through the Query page's guard (`run_query`): one
  statement, read-only, no ATTACH, DETACH, transactions or pragma setters, the
  step budget and the row cap — and a size cap: the foreign connection sets
  `SQLITE_LIMIT_LENGTH` to 8 MB, so no one value can be built larger, and
  `run_query` refuses a result of more than 16 MB of text in all. The read
  runs on `spawn_blocking`.
- `immutable` skips recovery and trusts the file not to change, so the three
  cases where that trust is wrong are refused rather than read wrongly: a WAL
  database whose `-wal` holds pages (committed rows an immutable read would not
  see, and reading them needs the `-shm`, which is a write); a hot rollback
  journal (only recovery, a write, makes the file whole); and a file whose size
  or modification time changed while it was read.

Where the file is: a path inside the vault is written vault-relative and
resolved like every vault path. A file outside it is written absolute and opens
only if it was picked with the dialog, on this Mac, for this vault — the
choices are kept in `sqlite-grants.json` in the app's config directory,
written whole or not at all (a sibling file renamed over it); a file that does
not parse is reported and left alone, never replaced by one holding only the
next grant. A
source note is text anyone could have written; without that rule one could
point at any database on the disk and copy it into the vault as notes.
For the same reason a source that reads a database outside the vault runs only
from `.atlas/sources` (A20-02): a grant is for the file, not for whichever note
names it, so a note written in user space must not be able to spend one.

## Consequences

- Every secret set before A19-01 is refused until it is given its sites; a
  source using one says so, and Settings shows it as sent nowhere.
- A service that redirects a token to another of its own hosts is stopped at
  the redirect; bind the secret to the host the redirect lands on and point
  the source there.
- A vault cloned to another Mac lists the secrets its sources name as "not set
  on this Mac", and a source outside the vault asks to be chosen again.
- Moving a vault gives it a new scope: its secrets have to be set again.
- Entitlements: the dev build reads and writes the login Keychain with none.
  A signed build under the Hardened Runtime should need none either for the
  legacy login keychain; a sandboxed one would need `keychain-access-groups`
  and the protected-data store instead. To be checked when the build is first
  signed — Atlas is neither signed nor sandboxed today.
- A source in user space that sends a secret, or reads a database outside the
  vault, stops refreshing until its note is moved into `.atlas/sources`
  (System → sources). The repo vault's own source, `Milestones`, is there
  already and reads a file inside the vault.
- A secret shorter than a few characters is struck from responses wherever it
  appears, which can mangle text. A secret that short is a mistake anyway.
