# Atlas — working notes

Local-first desktop app replacing Notion and Obsidian.

**`ENGINEERING.md` and this file are the authority for this repo.** `ENGINEERING.md`
holds the engineering rules — Clean Architecture, Clean Code, the testing bar, the
hand-off gate, and the agents — and this file adds repo-specific detail: stack,
commands, and the traps this codebase has. Together they **take precedence over
any user-level rules or agents** (`~/.claude/CLAUDE.md`, `~/.claude/agents/`),
which may hold a different standard on the machine you are running on (a work
laptop, for instance). If a user-level rule contradicts these files, these files
win. If this file ever appears to contradict `ENGINEERING.md`, `ENGINEERING.md`
wins and this file is the thing that is wrong.

## Use the agents

The specialised subagents in `.claude/agents/` (committed with the repo) are not
optional and not a fallback. Claude Code lets a project agent override a
user-level agent of the same name, so these are the ones that run here, whatever
`~/.claude/agents/` holds on this machine. **Delegate to the narrow agent rather
than doing the job ad hoc**, and spawn them wherever they fit — including several
in parallel when the work divides cleanly.

| Want to…                                 | Use                     |
| ---------------------------------------- | ----------------------- |
| Build a feature, refactor, phase of work | `coder`                 |
| Fix a reported bug or a failing test     | `bug-fixer`             |
| Review a diff, branch or PR              | `code-reviewer`         |
| Run the gate and report it faithfully    | `tester`                |
| Try to break what was just built         | `adversarial-tester`    |
| Raise coverage on an untested module     | `test-writer`           |
| Make a branch clean before review        | `linter`                |
| Apply review comments on a PR            | `pr-review-fixer`       |
| Write up a decision or a status page     | `documenter` (Notion) ¹ |

¹ `documenter` is not in this repo: it needs a Notion connector, and only James's
own `~/.claude/agents/` has it. Where it is absent, write ADRs in
`vault/docs/adr/` instead.

`coder`, `bug-fixer` and `pr-review-fixer` may change code. `code-reviewer`,
`tester` and `adversarial-tester` never do.

Each phase of `PLAN.md` is a `coder` task, and **every phase gets a
`code-reviewer` pass and an `adversarial-tester` pass before it is called done**.
Doing a whole phase inline, then reporting it green, is the failure mode this
section exists to prevent.

### Keep the guide, the API and the MCP in step

The app, its how-to guide, and its local API + MCP server describe one product.
They drift the moment a change lands in only one of them. So **every change that
reaches the user** — a feature, a behaviour fix, a renamed control, a new
property kind — gets two follow-up agents, spawned in parallel as soon as the
change is merged. Don't wait to be asked:

| Keeper         | Agent   | Owns                                                                                                       | Done when                                                                                                                                                                        |
| -------------- | ------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guide keeper   | `coder` | The Atlas Field Guide (`docs/guide/index.html`)                                                            | The guide describes what the app now does, in James's words, with nothing stale left in it. The coordinator then republishes it as a claude.ai artifact (see below).             |
| API/MCP keeper | `coder` | `packages/application/src/api` (routes + contract), `apps/mcp/src/tools`, `vault/docs/api/v1.md`, ADR-0016 | Anything the user can now do in the app can also be done or read through the API and an MCP tool, or the card says why not. Tests are added, and the API doc matches the routes. |

- The API/MCP keeper's work is code: it gets its own `code-reviewer` and
  `adversarial-tester` pass like any other change. The API is reachable by any
  local process, so every new route follows the rules in ADR-0016 and ADR-0017:
  it names its vault, never hands out a secret, and uses byte-preserving writes.
- A change that is internal only (a refactor, a test, a fix nobody can see)
  needs neither keeper. Say so in the hand-off rather than skipping it silently.
- A hand-off names both keepers' results: guide updated or not needed, and API/MCP
  updated or not needed.
- The guide's source is `docs/guide/index.html`, in the repo, so it is public:
  examples use fictional names only. It is a self-contained page (no build).
  Publish it as a claude.ai artifact from the account the session runs under;
  the first publish from a new account creates a new URL — tell James the URL
  and record it here. (The original personal-account copy is
  `claude.ai/artifact/QXvTge2zPuY5YS5g7QYveH`, last updated 2026-10-07.)

## Working with James

The maintainer is James Hoffman. These come from his feedback and hold on every
machine:

- **This repository is public.** Never put real names of his employer, its
  clients, vendors, coworkers or family into anything that is committed or
  posted — code, tests, fixtures, docs, ADRs, commit messages, issues or PR
  text. Use clearly fictional names (Larkspur Payroll, Mara Quill, Tobias Fenn)
  and `example.com` addresses. Real meetings and notes belong in his vault
  (a separate private repo), never here. This matters most on his work laptop,
  where work context is close at hand. A pre-publication scrub was needed once;
  the full private history lives in `jhoffman-dev/atlas-archive`.
- **Two machines, one repo.** He works from a personal Mac and a work laptop.
  Before starting, `git pull`; claim an issue by assigning it to yourself
  (`gh issue edit <n> --add-assignee @me`) and skip issues already assigned or
  with an open PR. Changes reach `main` through a pull request (a ruleset
  requires it; the admin bypass is for the coordinator's merges, not a habit).

- **Never guess his first name** from "jhoffman". It is James; if a name is
  needed and unknown, write `[Your name]`. (Claude has invented "Jordan" before.)
- **Delegate to the agents by default, and in parallel** where the work divides —
  see "Use the agents". Doing a job ad hoc is a correction he has made.
- **Stage exact paths.** Never `git add <folder>` where the app edits the tree —
  `vault/` is changed by the running app, its automations and sync. Check
  `git status --porcelain <folder>` and add only the files you changed; treat an
  unexpected deletion or move as the app's doing. A folder add once committed an
  archive automation's moves of 128 cards as deletions.
- **Every hand-off says whether the app needs a restart, and the command.** He
  runs `pnpm tauri:dev` from the main checkout: frontend changes show live, Rust
  changes rebuild and relaunch, dependency changes need a stop,
  `pnpm install`, and a rerun.
- **Merge flow.** Each agent works in its own worktree on its own branch. Merge
  with `git merge --no-ff`, then check `git diff --stat <branch> main` is empty
  so nothing was dropped (if `main` had moved, it shows only `main`'s own
  changes). If `main` moved while the branch was out, run the gate
  on the combined `main` before calling it done.

## Before starting any work, read the issues

Tasks live in **GitHub Issues** on `jhoffman-dev/atlas`, so every machine
and every Claude Code account works from the same list:

```sh
gh issue list -R jhoffman-dev/atlas                   # open work
gh issue list -R jhoffman-dev/atlas --label next      # do these first
gh issue view <n> -R jhoffman-dev/atlas               # the whole card
```

- **`from-james`** — James asked for it; it takes priority over the phase plan.
- **`next`** — do this next. **`backlog`** — pick it up when it fits, and say why
  you did or did not.
- **`follow-up`** — left over from a review or fix. **`feature`** — new capability.

Keep the issues current as you work: comment what you did, close an issue only when
its work is merged and pushed, and file new work (review findings, follow-ups) as
new issues rather than notes in a reply. An issue left open after its work landed
is a lie about the state of the project.

`vault/tasks/` holds the **history** of the board up to 2026-09-29 (done and archived
cards, read-only); don't add cards there. Its ids (`P<phase>-<nn>`, `U-<nn>`, `A…`)
are what older commits and ADRs refer to.

## Commands

```sh
pnpm tauri:dev       # run the app
pnpm gate            # format, typecheck, lint, tests + coverage, build, rust lint + tests
pnpm e2e             # Playwright in WebKit
pnpm design:refs     # render design/target mockups to design/out/refs (design/README.md)
pnpm shots           # screenshot the built app's surfaces to design/out/shots
pnpm design:compare  # mockup beside app, per surface, at design/out/compare/index.html
```

**The e2e suite runs against `dist`, not against your source.** `pnpm e2e` now
builds first for exactly this reason. If you ever run `playwright test` directly,
build first or you are testing the previous bundle — which can fail code that
works, and pass code that does not.

**Check CI by commit, never by "the latest run".** A run is not registered the
instant a push returns, so `gh run list --limit 1` will happily hand back the
_previous_ run and its conclusion. This has already caused a phase to be reported
as green when it was red.

```sh
gh run list --commit "$(git rev-parse HEAD)" --limit 1 --json status,conclusion
```

**Read a red run's annotation before explaining it.** A job that fails in ten
seconds without running a step is not a code failure — in September 2026 it was
GitHub billing, and a commit message confidently blamed a Node version first.

```sh
gh api "repos/{owner}/{repo}/check-runs/<job-id>/annotations" -q '.[].message'
```

Each checkout serves its e2e build on its own port, derived from its path (see
`playwright.config.ts`), so suites in two worktrees can run at the same time.
`E2E_PORT` overrides it.

Rust lives in `~/.cargo`; the npm scripts put it on PATH themselves.

## Shape of the code

Dependencies point inward, and ESLint enforces it — each layer has a
`no-restricted-imports` zone in `eslint.config.js`.

| Where                  | What belongs there                                |
| ---------------------- | ------------------------------------------------- |
| `packages/domain`      | The rules. Pure, no I/O, no clock, no randomness. |
| `packages/application` | Use-cases and the ports they need.                |
| `packages/adapters`    | Tauri IPC, markdown, the index. Thin translators. |
| `packages/ui`          | React components. No business rules.              |
| `apps/desktop`         | The composition root, plus `src-tauri` (Rust).    |

**Rust reads files, watches them, and runs SQL. It decides nothing** — see
`vault/docs/adr/0005-the-index-decides-nothing.md`, and
`0014-the-host-walks-the-vault-and-is-told-what-to-skip.md` for the one nuance:
Rust prunes directories it is _handed_ by the domain, which is obeying a rule
rather than having one. A rule that exists in both Rust
and TypeScript will drift, and the version the user sees is the TypeScript one.

## Things that will bite

- **Markdown saves are byte-preserving** (ADR-0003). An untouched block is written
  back from its original bytes. If you change how a block serializes, check the
  round-trip corpus in `packages/adapters/src/markdown`.
- **Anything that is not markdown needs a serializer handler** (ADR-0004). Left as
  text, remark escapes it: `[[Note]]` becomes `\[\[Note]]` the moment its paragraph
  is edited.
- **The index is derived and disposable.** Never store anything in it that is not
  already in the files.
- After `pnpm build`, **force a Rust rebuild** if only the frontend changed —
  `touch src-tauri/src/lib.rs` — or the binary keeps the old bundle embedded.
- **Prove every new assertion can fail.** Mutate the code, watch the test go red,
  restore. This project has shipped at least six that could not: one counted
  buttons in a container that always holds one; one asserted absence without
  first asserting the locator matched anything; one measured a 44px switch when
  the 114px control was what overlapped; one used only equal donut slices, which
  hid a moved contract because two halves are π either way.
- **A test that passes alone and fails under load is asserting on a moment
  rather than a state.** Wait for the condition (`expect.poll`, the `expectFile`
  helper in `e2e/host.ts`) instead of reading once.
- **Do not reimplement a card an agent is still working on.** Cancel it or wait.
  It has been done once here; the work was duplicated and the coordinator's copy
  was quietly worse.
- Plan and phases: `PLAN.md`. Decisions: `vault/docs/adr/`.
