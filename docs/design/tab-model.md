# Tabs: domain model, workspace store and build order (UI v2 7a/7b, Performance 8)

Decision proposal for #303, #304 and #324. Read against `main` at `8f034450`.

## 1. Today

- **Layout:** `packages/domain/src/panes/pane-layout.ts`.
  - `PaneLayout { paths, focused }`, with `MAX_PANES = 2`.
  - Pure operations: open, split, close, focus and move.
  - The split is persisted as an unversioned `{ vault, paths, focused }`.
- **History:** `navigation-history.ts`.
  - 13 place kinds; `NavigationHistory { back, current, forward }`, capped at 50.
  - `pane-histories.ts` holds one history per pane.
- **App side:**
  - `use-panes.ts` keeps the layout and histories in `useState`. It persists to localStorage `atlas.panes`, one vault at a time.
  - `use-navigation.ts` records visits.
  - `main-view.ts` is a `useState<MainView>`; one page replaces every pane.
  - `main-route.tsx` picks the page from twelve booleans.
- **`app.tsx`** (2,164 lines) owns all of it: panes, main view, navigation, `openNote`, the panes JSX, `mainRoute({…})` with twelve prop bags, the active sidebar page, and the shortcuts.
- **Persisted today:** the split only. Histories are not persisted, and neither is the page over the panes.

## 2. The tab model (`packages/domain/src/panes/workspace.ts`, pure)

```ts
type TabId = string; // "t<n>" from Workspace.nextId: no randomness in the domain
interface Tab {
  readonly id: TabId;
  readonly pinned: boolean;
  readonly history: NavigationHistory;
}
interface Pane {
  readonly tabs: readonly Tab[];
  readonly active: TabId;
}
interface Workspace {
  readonly panes: readonly Pane[];
  readonly focused: number;
  readonly nextId: number;
  readonly closed: readonly Tab[]; // reopen stack, ≤10, not persisted
}
const tabPlace = (tab: Tab) => tab.history.current;
```

Pages (Today, Inbox, graph, a type…) are places, so `MainView` goes. `navigation-history.ts` is unchanged.

**Invariants:**

- 1 ≤ panes ≤ 2; every pane has at least one tab, and `active` names one of them.
- Ids are unique; `focused` names a pane.
- Closing the last tab of a split pane closes the pane. Closing the last tab of the only pane leaves one empty tab.
- Moving the last tab out of a pane collapses the split.
- Duplicate places are allowed.
- Pinned tabs sit first and can't be closed.
- No tab cap in the domain.

**Operations** (pure, `(ws, args) => ws`):

- Opening: `openInActiveTab`, `openInPane`, `openInNewTab` (⌘-click: placed after the active tab and activated), `newTab`.
- Closing: `closeTab` (activates the right neighbour, else the left; pushes onto `closed`), `reopenClosedTab`.
- Switching and ordering: `activateTab`, `nextTab`/`previousTab`, `activateNth` (⌘1–9, where 9 is the last tab), `reorderTab`, `moveTabToPane`.
- Panes: `splitWithTab`, `closePane`, `focusPane`.
- History: `goBack`, `goForward`, `visit`.
- Keeping tabs right after outside changes: `followMove`, `forgetNotes`.
- Pinning: `pinTab`, `unpinTab`.

_As built in 7a:_ names that would collide with the `pane-layout.ts` and `navigation-history.ts` exports in the same barrel carry their subject, the way `closeInPanes` and `followMoveInHistory` already do — `openInActiveTabOf` (a named pane), `closePaneInWorkspace`, `focusPaneInWorkspace`, `goBackInTab`, `goForwardInTab`, `followMoveInWorkspace`, `forgetNotesInWorkspace`. `visit` is `openInActiveTab`; `splitWithTab` splits with a copy of the active tab, and `openInSplit` is the ⌘⇧-click. `EMPTY_WORKSPACE`, `activePlace` and `activeTabOf` read the state. A tab on a deleted note empties and keeps its Back; a tab left with nothing at all closes, not onto the reopen stack.

**Undo:**

- Editor undo is TipTap's own history in editors that stay mounted while their tab is hidden. At most 4 per pane, evicted least-recently-shown first; autosave pauses while hidden and flushes on switch-away.
- Tab-action undo is `reopenClosedTab` (⌘⇧T).

**Persistence:**

- Format: versioned `{ version: 1, vault, focused, panes: [{ active, tabs: [{ id, pinned, history }] }] }`. It holds places only, each validated on read.
- The old format upgrades to one tab per pane.
- Stored in localStorage `atlas.workspace:<vaultKey>`, one key per vault.
- Not in vault settings, because the layout is per viewer and the vault syncs.
- No new host command.
- No secrets can appear, because a place has no field for one (ADR-0017).

## 3. The store (Performance 8)

`apps/desktop/src/workspace/workspace-store.ts` follows the shape of `overlay-store.ts`.

- **State:** `{ vault, workspace, paneKeys }`.
- **Actions** are module functions:
  - `openPlace(store, place, { how: 'here'|'new-tab'|'split' })`
  - `closeTab`, `activateTab`, `goBack`, `splitPane`, `closePane`, `focusPane`, `followMove`, `closeNotes`
  - `loadVault`, which runs in the same event as the location change, not in an effect (R14-01).

**Selectors:**

- `usePaneKeys`, `useFocusedPane`
- `usePaneTabs(pane)`, `useActivePlace(pane)` (reference-stable)
- `useTabHistory`, `useFocusedPlace` (the sidebar's active mark)
- `workspaceNow(store)` for shortcuts

Switching tabs redraws only the strip and one pane's content.

**Containers:** `PanesContainer → PaneContainer → TabStripContainer + PaneContentContainer`.

- A note place renders `NotePaneContainer`, keyed by tab id; up to 3 more stay mounted while hidden.
- Any other place renders the page component.

**Leaves `app.tsx`:**

- the panes, main view and navigation hooks
- `openNote` and `followLinkInPane`
- the panes JSX and `mainRoute`, in PR B
- the active-page arguments
- the shortcut callbacks

The old pane modules are deleted once nothing reads them.

## 4. Build order

**7a, now** (after #332 lands). Additive only:

- `workspace.ts` and `remember-workspace.ts`, each with tests
- `activeSidebarPageOf`
- `tab-strip.tsx`: tablist/tab roles, ×, +, middle-click, ←/→, a `focused` prop
- a gallery specimen and `tabs.css`

It doesn't touch `app.tsx` or the pane hooks.

**Perf 8 + 7b** are one lane with one builder, in two stacked PRs:

- **PR A:** the workspace store, containers, tabs wired, ⌘-click / ⌘⇧-click, per-tab back/forward, hidden mounted editors, persistence and restore, the shortcuts (⌘T, ⌘W, ⌃Tab, ⌘1–9, ⌘⇧T), budgets lowered, and `tabs.spec.ts`. Page places still render through the `mainRoute` bag, handed down by a context.
- **PR B ("pages are tabs"):** per-kind page containers own their hooks. `main-view.ts`, `main-route.tsx`, `pane-layout.ts` and `pane-histories.ts` are deleted. Performance 9 (#325) follows.

**Overlap:**

- 7a touches nothing that 3b, 4, 9 or 10 touch.
- A and B collide with #283 only in `app.tsx`.
- B re-plumbs page props, so it merges after 3b.

## 5. Open questions (recommended defaults)

1. **Tab limit (Q7):** no cap. Tabs shrink to 120px, then the strip scrolls. At most 4 mounted editors per pane; the fifth-oldest is flushed and unmounted, and its undo resets.
2. **Click routing:**
   - A plain click on a place already open in a tab of the focused pane activates that tab; otherwise it replaces the active tab.
   - ⌘-click opens a new tab beside the active one and activates it.
   - ⌘⇧-click splits.
3. **Restore on launch:** tabs, the active tab, the focused pane and each tab's back/forward. Hidden editors don't mount until they are visited.
4. **History** is per tab. ⌘[ / ⌘] act on the focused pane's active tab, and a closed tab's history comes back with ⌘⇧T.
5. **Pinned tabs:** reserved in the format and the model, not built yet.

Assumed from #303: Q8 (pages become tabs) and Q21 (the shortcuts; ⌘W never closes the window).

## 6. Budgets and tests

- **Should roughly halve in PR A:**
  - "Click a sidebar note" (11/357)
  - "Switch notes" (11/389)
- **New budgeted actions:** "Switch tabs", "Open in a new tab", "Split the window", "Close a pane", "Focus the other pane".
- **Hold:**
  - the idle budgets stay 0/0, with a dirty hidden tab open
  - "One autosave and its watcher echo" is at risk from hidden editors and must not rise
- **Render-count tests:**
  - Switching tabs draws only the strip and the shown tab's content; `App`, `AppShell`, `VaultTree` and the other pane draw 0.
  - Focusing pane 2 draws only the `PaneFrame`s.
  - ⌘[ draws nothing in pane 2.
  - A sidebar open draws `App` and `AppShell` 0.
  - With a fake clock, a switch-away flushes with exactly one write.
- **E2e:** `tabs.spec.ts`, plus the split, navigation and editing specs held per tab.
