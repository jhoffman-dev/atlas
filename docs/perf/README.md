# Response times (#217)

How long Atlas takes to answer, on a 2,000-note fixture vault, and what was
found slow. Filing from the Inbox and opening a note are held to a budget in
CI (`perf` job in `.github/workflows/gate.yml`): p95 under 250 ms for filing
and 750 ms for opening a note. CI's Linux runner measured 52 ms and 335 ms
p95 on the first run, about three times slower than the Mac for opening a note.

## Run it

| Command                          | Does                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm perf`                      | Builds, then times seven actions in WebKit. Writes `test-results/perf/latency.json` and prints the table. Fails over budget. |
| `pnpm perf:profile`              | The slow actions under Chromium's CPU profiler (unminified build). Writes `test-results/perf/profile-*.txt`.                 |
| `pnpm perf:vault <empty-folder>` | Writes the fixture vault to a folder, to open in `pnpm tauri:dev`. Refuses a folder that holds anything.                     |
| `PERF_FILINGS=20 pnpm perf`      | Files fewer Inbox items (default 50).                                                                                        |

## What is measured

- **Fixture** (`tools/perf/fixture-vault.ts`): 2,000 notes, seeded, fictional names — 637 waiting in the Inbox, 48 projects, 12 areas, 140 people, 420 tasks, 300 meetings, 443 notes.
- **Input → ready**: from the input event to the frame where the page is ready for the next action (`tools/perf/probe.ts`).
- **Longest frame**: the longest gap between two animation frames from the input until the work settled. WebKit has no Long Tasks API, so a blocked main thread shows as a late frame.
- **IPC before ready**: host commands sent between the input and ready — what the input path waited on.
- **Settled**: from the input until no host command has been in flight for 400 ms. Not waited for between filings: they are filed back to back, 250 ms apart, as a person working quickly would.

The harness runs the real built frontend against the e2e stand-in host
(`e2e/host.ts`). Limits:

- The stand-in lists no index manifest, so every index refresh re-reads all 2,000 notes. The real host refreshes only what changed. **Settled** and **Host ms** overstate background work; input → ready does not depend on them.
- Its `index_query` builds SQLite in memory per call (~400 ms here), which is why a task status takes ~0.4–0.8 s to settle. The Rust index answers in milliseconds.
- Machine: James's personal Mac, shared with other agents' test runs. Numbers move ±30% run to run; compare p50s, not single runs.

## Baseline and after (ms)

Baseline is `origin/main` at `8a6a5cf`; after is `feat/217-performance`. Same harness, same machine.

| Action                                     | Baseline p50 / p95 / max | After p50 / p95 / max | Longest frame | IPC before ready |
| ------------------------------------------ | ------------------------ | --------------------- | ------------- | ---------------- |
| File an Inbox item (next item interactive) | 3,184 / 3,989 / 4,257    | **6 / 36 / 51**       | 1,011 → 38    | 211 → 3          |
| Open a note                                | 37 / 55 / 55             | 38 / 54 / 54          | 19 → 22       | 3 → 3            |
| Switch panes                               | 12 / 19 / 19             | 8 / 25 / 25           | 25 → 20       | 2 → 2            |
| Edit a property (per key)                  | 9 / 13 / 13              | 7 / 20 / 20           | 101 → 27      | 1 → 1            |
| Change a task status                       | 89 / 93 / 93             | **13 / 46 / 46**      | 59 → 37       | 1 → 2            |
| Type in the editor (per key)               | 239 / 309 / 975          | **7 / 18 / 18**       | 350 → 19      | 0 → 0            |
| Open the Inbox (first row interactive)     | 135 / 171 / 171          | 125 / 164 / 164       | 27 → 110      | 8 → 8            |

All 50 filings land on disk after the run (checked by the spec), in about 15 s
behind the page on the stand-in host.

## Root causes, from the measurements

| Symptom                                      | Cause                                                                                                                                                                                                                                             | Fix                                                                                                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filing blocks the Inbox for 3–4 s            | `useInbox` disabled every row (`busy`) until the write, the move's link update (reading all 2,000 notes) and the row's removal were done: 211 host commands on the input path. Each `busy` flip redrew all 500 rows and their 30,000 `<option>`s. | The row leaves at once; writes run in a queue behind the page (Proposals' `useAnswerQueue`, #166), held by the window's close. A failure brings the row back with why. One re-read when the queue drains, not one per write. |
| Every row redrawn per filing and per re-read | New row objects on every index read; per-row closures; every picker subscribed to the vault's note names.                                                                                                                                         | Rows memoised; unchanged rows and choices kept as the same objects; triage actions stable; the Inbox picker (valued by path) no longer reads note names.                                                                     |
| Typing lags 240–400 ms a key; status 90 ms   | Each relation picker worked out the link to every option by searching all 2,000 paths (`noteNames.linkTo` → `resolveWikiLinkTarget`), on every render of the properties panel. 7.4 s of 7.4 s profiled while typing.                              | `noteNames` resolves through `createWikiLinkResolver` (indexed once) and caches each link.                                                                                                                                   |
| 500 ms of main thread per filing in the move | `retargetLinks` resolved every link in every note against the full path list, twice.                                                                                                                                                              | Resolvers indexed once per path list (`resolverOf`).                                                                                                                                                                         |
| Graph rebuild after every write              | `buildVaultGraph` resolved each relation by linear search.                                                                                                                                                                                        | Indexed resolver.                                                                                                                                                                                                            |

## Not fixed here

- **Opening the Inbox** stays ~130 ms: 500 rows × 60 options is 30,000 DOM nodes, and the sidebar's scroll-margin layout effect forces their layout. Virtualising the rows fixes it but changes #167's "every row can be reached" behaviour (its e2e counts 500 rendered rows) — a decision, filed as a follow-up.
- **The move's link update** still reads every note per filing (in the background now). #214 makes filing set a link instead of moving, which removes it.
- Heavy pure work off the main thread: the profiles show none left on these paths; parsing for the index already runs in a worker (#135).
