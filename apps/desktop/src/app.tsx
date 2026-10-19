import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  activeNotePaths,
  activeTabOf,
  tabPlace,
  createVaultPath,
  favoriteValue,
  rankNoteSuggestions,
  readWikiLink,
  sidebarTreeRows,
  vaultInitial,
  FAVORITE_KEY,
  hasFullName,
  NAME_PLACEHOLDER,
  moveRefusal,
  noteNames,
  noteTitle,
  ownerNeededBy,
  tagKey,
  taskTypeOf,
  ARTIFACT_KINDS,
  ARTIFACT_TYPE,
  claudeArtifactUrl,
  pastedArtifactCommands,
  SAVE_ARTIFACT_LINK,
  TYPE_ICONS,
  VAULT_ROOT,
  type EntryMove,
  type GraphScope,
  type NavigationPlace,
  type PagePlace,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import {
  createNoteChanges,
  createOwnWrites,
  createRefreshSpacing,
  createSourceRefresher,
  createTagRenames,
  createToolboxes,
  findTaskTemplate,
  getAppInfo,
  setNoteProperty,
  readsTouchedByPaths,
  reportingIndexWrites,
  type VaultRead,
  type ActivityStore,
  type WindowClosingPort,
  type ApiRouterDeps,
  type AppInfoPort,
  type ExternalLinkPort,
  type GlobalCapturePort,
  type GoogleCalendarPort,
  type GranolaPort,
  type GranolaPullRecords,
  type PageSnapshotPort,
} from '@atlas/application';
import {
  AppShell,
  AsideToggleProvider,
  ChatToggleProvider,
  collapseFor,
  useSteadyCallback,
  CapturePalette,
  DeleteDialog,
  lostUsesText,
  TemplateToNoteDialog,
  MovePicker,
  IndexSettings,
  indexStatusText,
  SidebarFooter,
  SyncIndicator,
  OpenFromGitHubDialog,
  VaultHeader,
  VaultEmptyState,
  NewTypeDialog,
  NewViewDialog,
  NewArtifactDialog,
  NoteNamesProvider,
  Toast,
  type AppInfoState,
  type OpenHow,
} from '@atlas/ui';
import { useVault, type VaultPorts } from './vault/use-vault.ts';
import { boundToVault, type OnHost } from './vault/bound-to-vault.ts';
import type { NotePorts } from './notes/use-note.ts';
import { useIndex, type IndexPorts } from './index/use-index.ts';
import {
  useIndexFailure,
  useIndexKey,
  useIndexReady,
  useIndexRevision,
} from './index/index-status-store.ts';
import { openOnce } from './index/open-once.ts';
import { createWindowQueryClient } from './reads/query-client.ts';
import { createReadInvalidator } from './reads/read-invalidator.ts';
import { tellingOwnWrites } from './reads/telling-own-writes.ts';
import { useSqlViews } from './reads/use-sql-views.ts';
import { useVaultReads } from './reads/use-vault-reads.ts';
import { refreshAfterWatch } from './index/watched-paths.ts';
import { IndexProgressPill, LiveIndexSettings } from './index/index-progress.tsx';
import { useOutsideChanges } from './vault/use-outside-changes.ts';
import { useCreateNote } from './notes/use-create-note.ts';
import { useTypes } from './types/use-types.ts';
import { useTypeCommands } from './types/use-type-commands.ts';
import { useSidebarCatalog } from './sidebar/use-sidebar-catalog.ts';
import { browserSectionStore } from './sidebar/browser-section-store.ts';
import { createBrowserGroupFoldStore } from './query/browser-group-fold-store.ts';
import { createBrowserLinkedRangeStore } from './linked-pages/browser-linked-range-store.ts';
import { useTemplates } from './types/use-templates.ts';
import { useOpenEditors } from './panes/open-editors.ts';
import { useStrandedEdits } from './notes/stranded-edits.ts';
import { browserStrandedStore } from './notes/browser-stranded-store.ts';
import { placeName } from './panes/place-name.ts';
import type { PaneContext } from './panes/note-pane-container.tsx';
import type { TypePageMode } from './types/type-page.tsx';
import { createRevealStore } from './panes/reveals.ts';
import { ActiveSidebar } from './workspace/active-sidebar.tsx';
import { browserWorkspaceStore } from './workspace/browser-workspace-store.ts';
import { followLink, openNote as openNotePlace } from './workspace/open-place.ts';
import { PanesContainer } from './workspace/panes-container.tsx';
import {
  closeActiveTab,
  openPlace,
  usePageShown,
  closeNotes as closeNotesIn,
  createWorkspaceStore,
  focusedNotePath,
  followMove as followMoveIn,
  goBack,
  goForward,
  keepNotes,
  loadVault,
  newTabIn,
  nextTab,
  previousTab,
  activateNthTab,
  reopenClosedTab,
  toggleSplit as toggleSplitIn,
  workspaceNow,
} from './workspace/workspace-store.ts';
import {
  WorkspaceStoresProvider,
  WorkspaceWiringProvider,
  type WorkspaceStores,
} from './workspace/workspace-wiring.tsx';
import { browserThemeStore } from './theme/browser-theme-store.ts';
import { useVaultGraph } from './graph/use-vault-graph.ts';

import { localClock, localTimeZone, localToday } from './today.ts';
import { cryptoRng } from './random.ts';
import type { Overlay } from './overlay.ts';
import {
  createOverlayStore,
  hideOverlay as hideIn,
  overlayNow,
  showOverlay as showIn,
  useWindowOverlay,
} from './overlay-store.ts';
import { SearchPaletteSlot } from './search-palette-slot.tsx';
import { movingEditorsIn, openNotesIn } from './panes/open-notes.ts';
import { useVaultEntries, type VaultEntryPorts } from './vault/use-vault-entries.ts';
import { useLocalApi, type LocalApiPorts } from './api/use-local-api.ts';
import { useApiHost } from './api/use-api-host.ts';
import { createAutomationRelay } from './api/automation-relay.ts';
import { createMoveRelay } from './api/move-relay.ts';
import { SettingsPanel } from './settings/settings-panel.tsx';
import {
  GlobalCaptureSettings,
  GoogleCalendarSettingsCard,
  GranolaSettingsCard,
  ImageSettingsPanel,
  ProfileSettingsCard,
  QuickAddSettingsCard,
  SecretsSettingsCard,
  SyncSettingsCard,
  settingsSectionLinks,
} from './settings/settings-sections.ts';
import { browserImagePlacementStore } from './notes/browser-image-placement-store.ts';
import { useTickMemory } from './query/tick-memory.ts';
import { useViewDrafts } from './query/use-view-drafts.ts';
import { useNewView } from './query/use-new-view.ts';
import { createBrowserTypeTabStore } from './types/browser-type-tab-store.ts';
import { useTypeViews } from './types/use-type-views.ts';
import { paletteEditTypeOffers, runPaletteEditTypeCommand } from './types/palette-edit-type.ts';
import { useTemplatesPage } from './templates/use-templates-page.ts';
import { answersWrittenOrGivenUp, useAnswersWrittenBeforeClose } from './proposals/answer-queue.ts';
import { useNewArtifact } from './artifacts/use-new-artifact.ts';
import { useThumbnailQueue, useThumbnailsNow } from './artifacts/use-thumbnails.ts';
import { createQueryTextStore, queryTextOf } from './query/query-text-store.ts';
import { AppNotices } from './app-notices.tsx';
import { browserActivitySeenStore } from './activity/browser-activity-seen-store.ts';
import { useActivity } from './activity/use-activity.ts';
import { useActivityLog, useNoticeActivity } from './activity/use-activity-log.ts';
import { usePeople } from './people/use-people.ts';
import { useAppShortcuts } from './app-shortcuts.ts';
import { AsideContainer } from './aside/aside-container.tsx';
import {
  createAsideStore,
  hideAside,
  asideShown as asideShownNow,
  loadVaultAside,
  setAsideFolded,
  toggleAside as toggleAsideIn,
  toggleClaude,
  useAsideShown,
  useClaudeAsked,
  useClaudeShown,
} from './aside/aside-store.ts';
import { browserAsideStore } from './aside/browser-aside-store.ts';
import { ClaudeSeatProvider } from './aside/claude-seat.tsx';
import { createShownNotes } from './aside/shown-notes.ts';
import { useAsideCollapsed } from './aside/use-aside-collapsed.ts';
import { browserFabStore } from './quick-add/browser-fab-store.ts';
import { QuickAdd } from './quick-add/quick-add.tsx';
import type { GlobalCaptureStore } from './global-capture/browser-global-capture-store.ts';
import { useGlobalCapture } from './global-capture/use-global-capture.ts';
import type { SourcePorts } from './sources/source-ports.ts';
import { useGoogleCalendar } from './settings/use-google-calendar.ts';
import { useGranola } from './settings/use-granola.ts';
import { useGranolaPull } from './granola/use-granola-pull.ts';
import { useSecrets } from './settings/use-secrets.ts';
import { useQuickAdd } from './quick-add/use-quick-add.ts';
import { useQuickAddSetting } from './quick-add/use-quick-add-setting.ts';
import { useSidebarOrder } from './sidebar/use-sidebar-order.ts';
import { useVaultTags } from './tags/use-vault-tags.ts';
import { useArchive } from './archive/use-archive.ts';
import { useInboxWaiting } from './inbox/use-inbox-waiting.ts';
import { createPendingWrites } from './workspace/pending-writes.ts';
import { createPageHoldsByVault } from './workspace/page-holds.ts';
import { askToEdit, createTypeModeStore } from './types/type-mode-store.ts';
import { useBuiltInTypes } from './types/use-built-in-types.ts';
import { useBlockType } from './timeblocks/use-block-type.ts';
import { useTaskMigration } from './gtd/use-task-migration.ts';
import { useParaMigration } from './para/use-para-migration.ts';
import { useVaultTidy } from './vault/use-vault-tidy.ts';
import { useMeetingCleanup } from './meetings/use-meeting-cleanup.ts';
import { useMeetingProjects } from './meetings/use-meeting-projects.ts';
import { useAutomations } from './automations/use-automations.ts';
import { useMeetingImport } from './meetings/use-meeting-import.ts';
import { archiveCommand, withCommandBeforeDelete } from './archive/archive-menu.ts';
import { paletteArchiveCommands, runPaletteArchiveCommand } from './archive/palette-archive.ts';
import { ChatPane, ClaudeSettingsCard } from './chat/chat-pane.tsx';
import { useProfileSetting } from './profile/use-profile-setting.ts';
import { useSelfEmailsSetting } from './profile/use-self-emails-setting.ts';
import { settingsUnreadable, vaultOwnerKnown } from './profile/vault-owner-known.ts';
import { useSettingsPause } from './profile/use-settings-pause.ts';
import { automationsScheduled } from './automations/automations-scheduled.ts';
import { browserChatSettingsStore } from './chat/chat-settings-store.ts';
import { claudeStepPorts } from './chat/claude-step-ports.ts';
import { chatWindowOf } from './chat/chat-window.ts';
import { useChat, type ChatPorts } from './chat/use-chat.ts';
import { closingInStages } from './activity/closing-stages.ts';
import { useSync, type SyncHostPorts } from './sync/use-sync.ts';
import { useOpenFromGitHub } from './sync/use-open-from-github.ts';
import { syncConflictNotice, syncIndicatorBadge } from './sync/sync-view.ts';
import { browserClipboard } from './settings/clipboard.ts';

const OPEN_TEMPLATES = 'open-templates';
const OPEN_TERMS = 'open-terms';
const OPEN_INBOX = 'open-inbox';
const OPEN_REVIEW = 'open-review';
const OPEN_TODAY = 'open-today';

/** What the search palette can do besides find notes. */
const PALETTE_COMMANDS = [
  { id: 'new-query', label: 'New query', keywords: ['sql'] },
  { id: 'new-view', label: 'New view' },
  { id: 'new-artifact', label: 'New artifact', keywords: ['claude', 'save', 'link', 'html'] },
  { id: OPEN_TEMPLATES, label: 'Templates', keywords: ['template', 'edit templates'] },
  { id: OPEN_TERMS, label: 'Terms', keywords: ['glossary', 'spelling', 'vocabulary', 'aliases'] },
  {
    id: OPEN_INBOX,
    label: 'Inbox',
    keywords: ['process', 'file', 'proposals', 'accept', 'reject', 'suggestions', 'claude'],
  },
  { id: OPEN_REVIEW, label: 'Weekly review', keywords: ['review', 'gtd', 'week'] },
  {
    id: OPEN_TODAY,
    label: 'Today',
    keywords: ['overdue', 'due', 'next actions', 'waiting', 'plan', 'day', 'gtd'],
  },
] as const;

/** The kinds an artifact can be, as the New artifact dialog offers them. */
const ARTIFACT_KIND_CHOICES = ARTIFACT_KINDS.map((kind) => ({
  value: kind,
  label: kind.charAt(0).toUpperCase() + kind.slice(1),
}));

/** What the search palette offers for a query before any command it names. */
const paletteOffers = (query: string) => pastedArtifactCommands(query);

export { localToday };

/**
 * Where focus goes when an overlay closes and what opened it has gone: the
 * note being edited, or else the tree — somewhere a keyboard can carry on
 * from, rather than `<body>`.
 */
function focusFallback(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('.pane--focused [contenteditable="true"]') ??
    document.querySelector<HTMLElement>('[role="tree"] [tabindex="0"]')
  );
}

/** The window, with its one query cache (ADR-0040): every whole-vault read below is kept in it. */
export function App(props: ComponentProps<typeof AppWindow>) {
  const [client] = useState(createWindowQueryClient);
  return (
    <QueryClientProvider client={client}>
      <AppWindow {...props} />
    </QueryClientProvider>
  );
}

function AppWindow({
  appInfo,
  vault: vaultPorts,
  notes: notePorts,
  index: indexPorts,
  sources,
  links,
  snapshot,
  api,
  chat: chatPorts,
  activity: activityPorts,
  sync: syncPorts,
  googleCalendar,
  granola: granolaPorts,
  globalCapture: globalCapturePorts,
}: {
  appInfo: AppInfoPort;
  vault: OnHost<VaultPorts>;
  notes: OnHost<NotePorts>;
  index: OnHost<IndexPorts>;
  /** Feeds, SQLite files and the secrets feeds send. */
  sources: SourcePorts;
  /** Opens an artifact's link in the browser. */
  links: ExternalLinkPort;
  /** Pictures an artifact's saved copy for its thumbnail. */
  snapshot: PageSnapshotPort;
  api: LocalApiPorts;
  /** Claude, through Claude Code or an API key (ADR-0021). */
  chat: ChatPorts;
  /** Where each vault's Activity log is kept, on this Mac (U-28), and the window's close, to write it first. */
  activity: { store: ActivityStore; closing: WindowClosingPort };
  /** The Mac's own git and gh, for syncing the vault through GitHub (U-29). */
  sync: SyncHostPorts;
  /** Google Calendar, signed in to by the host, which keeps the tokens (ADR-0030). */
  googleCalendar: GoogleCalendarPort;
  /** Granola, through the host, which keeps the key (ADR-0034), and this Mac's record of each vault's pulls. */
  granola: { port: GranolaPort; records: GranolaPullRecords };
  /** The shortcut that opens quick capture from any app, registered by the host (#81). */
  globalCapture: { port: GlobalCapturePort; store: GlobalCaptureStore };
}) {
  const [app, setApp] = useState<AppInfoState>({ kind: 'loading' });
  // The last sync runs before the Activity log's final write, so its line is kept.
  const closing = useMemo(() => closingInStages(activityPorts.closing), [activityPorts.closing]);
  const editors = useOpenEditors();
  // The tabs and panes, and where each tab was asked to scroll to (ADR-0040).
  const [workspace] = useState(() => createWorkspaceStore({ remembered: browserWorkspaceStore }));
  const [reveals] = useState(createRevealStore);
  // The right sidebar (#306): remembered per vault as the tabs are, read in the same event.
  const [asideStore] = useState(() => createAsideStore({ remembered: browserAsideStore }));
  const [shownNotes] = useState(createShownNotes);
  // Set once the sync hook below exists: a switch waits for a sync under way,
  // whose remaining steps would otherwise be refused half-done (U-29).
  const settleSync = useRef<() => Promise<void>>(() => Promise.resolve());
  // The Inbox and Proposals tabs hold their background writes here: a switch
  // waits for the clarifications and answers still being written behind those
  // pages, which the host would refuse once another vault is open (#217, #166).
  const [pendingWrites] = useState(createPendingWrites);
  const leaveVault = useCallback(async () => {
    await editors.flushAll();
    await answersWrittenOrGivenUp(pendingWrites.drained());
    await settleSync.current();
  }, [editors, pendingWrites]);
  // So is the window's close, whatever tab those pages are in, or were.
  useAnswersWrittenBeforeClose(pendingWrites, closing.writes);
  // Every pane's unsaved work is written before the host moves to another vault,
  // while its paths still mean the vault it was typed in.
  // Choosing and listing a vault come before there is one to bind writes to,
  // and need none: useVault is handed no way to write.
  const choosing = useMemo(() => boundToVault(vaultPorts, null), [vaultPorts]);
  const {
    location,
    rows,
    notePaths,
    notesListedFor,
    error,
    chooseVault,
    showVault,
    toggleDirectory,
    expandDirectory,
    forgetDirectory,
    isExpanded,
    reload,
  } = useVault(choosing, {
    beforeSwitch: leaveVault,
    // In the same event as the location: the tabs' paths mean this vault (R14-01).
    onSwitched: (next) => {
      loadVault(workspace, next.absolutePath);
      loadVaultAside(asideStore, next.absolutePath);
    },
  });
  const vaultKey = location?.absolutePath ?? null;
  const tickMemory = useTickMemory(vaultKey);
  const [groupFolds] = useState(createBrowserGroupFoldStore);
  const [linkedRanges] = useState(createBrowserLinkedRangeStore);
  // One Activity log for the window; each use case records where it gives up (A28-01).
  const activityLog = useActivityLog({
    store: activityPorts.store,
    vaultKey,
    closing: closing.last,
  });
  // One feed for the window: every refresh of the index says here which notes changed (P28-03).
  const [noteChanges] = useState(() =>
    createNoteChanges({
      onError: (cause) => console.error('A note change could not be handled:', cause),
    }),
  );
  // Everything below writes through these, so a write that finishes after a
  // switch is refused instead of landing in the vault opened next.
  // What the app itself wrote, so the watcher's report of it is not refreshed for twice (#254).
  // The window's whole-vault reads, read again when what they are made from changes (#259).
  const queryClient = useQueryClient();
  const [reads] = useState(() => createReadInvalidator({ client: queryClient }));
  // The app's own writes also tell the reads of the folders they land in: the
  // watcher's echo of a template written here is left out.
  const [ownWrites] = useState(() =>
    tellingOwnWrites(createOwnWrites({ clock: localClock }), ({ vault, path }) =>
      reads.invalidate(vault, readsTouchedByPaths([path])),
    ),
  );
  const vault = useMemo(
    () => boundToVault(vaultPorts, vaultKey, ownWrites),
    [vaultPorts, vaultKey, ownWrites],
  );
  const notes = useMemo(
    () => boundToVault(notePorts, vaultKey, ownWrites),
    [notePorts, vaultKey, ownWrites],
  );
  // Opened once per vault: a new vault gets a new opening (#238). Each write
  // says which of the graph and the tags it changed, read again when the
  // index next has news for its readers (#259).
  const index = useMemo(() => {
    const bound = boundToVault(indexPorts, vaultKey, ownWrites);
    const opened = openOnce(bound.index);
    if (vaultKey === null) return { ...bound, index: opened };
    const report = (facets: Iterable<VaultRead>) => reads.invalidateWithIndex(vaultKey, facets);
    const stale = () => reads.waitingFor(vaultKey);
    return { ...bound, index: reportingIndexWrites({ index: opened, report, stale }) };
  }, [indexPorts, vaultKey, ownWrites, reads]);
  /** The note the person is working in, read as it is needed: the window is not drawn for a switch. */
  const focusedNote = useCallback(() => focusedNotePath(workspaceNow(workspace)), [workspace]);
  // What the query tab is writing, read by the chat for the window it opens on.
  const [queryText] = useState(createQueryTextStore);
  /** The focused tab's query text while that tab shows the query page, else null. */
  const focusedQueryText = useCallback(() => {
    const tab = activeTabOf(workspaceNow(workspace));
    return tabPlace(tab)?.kind === 'query' ? (queryTextOf(queryText, tab.id) ?? '') : null;
  }, [workspace, queryText]);
  const {
    status: indexStatus,
    store: indexStore,
    progress: indexProgress,
    rebuild,
    refresh,
    catchUp: catchUpIndex,
    settled: indexSettled,
  } = useIndex({
    ports: index,
    vaultKey: location?.absolutePath ?? null,
    activity: activityLog,
    changes: noteChanges,
    ownWrites,
  });
  useVaultReads({ reads, changes: noteChanges, index: indexStore, vaultKey });
  const indexReady = useIndexReady(indexStore, vaultKey);
  const indexFailedWith = useIndexFailure(indexStore, vaultKey);

  // Anything that edits the vault from outside — Obsidian, a sync client — should
  // show up here without a restart. The echo of the app's own writes is left
  // out: the app refreshed when it wrote (#254). Quiet when every path left is
  // a note the index holds: it moves the index only when the refresh found
  // something. Anything else is not in the index, so only a loud refresh tells
  // its readers.
  useOutsideChanges({
    watch: vault.watch,
    vaultKey: location?.absolutePath ?? null,
    fs: vault.fs,
    ownWrites,
    settled: indexSettled,
    onChange: (paths) => {
      if (vaultKey !== null) reads.invalidate(vaultKey, readsTouchedByPaths(paths));
      void reload();
      void refresh(refreshAfterWatch(paths));
    },
  });
  // Everything derived from the index re-runs when this changes: backlinks,
  // saved views and dashboard widgets. It moves only with the revision (#238).
  const indexKey = useIndexKey(indexStore, vaultKey);
  const {
    types,
    failure: typesFailure,
    reload: reloadTypes,
  } = useTypes({
    fs: vault.fs,
    markdown: notes.markdown,
    vaultKey: location?.absolutePath ?? null,
  });

  /** Re-reads the tree and the index, after something wrote to the vault. */
  const onChanged = useCallback(() => {
    void reload();
    void refresh();
  }, [reload, refresh]);
  const typesChanged = useCallback(() => {
    onChanged();
    reloadTypes();
  }, [onChanged, reloadTypes]);
  // PARA's types are written into a vault that lacks them as it opens (P30-01).
  const typesOffer = useBuiltInTypes({
    fs: vault.fs,
    markdown: notes.markdown,
    vaultKey,
    activity: activityLog,
    onChanged: typesChanged,
  });
  // Timeblocks are notes of the Block type, written once a vault's tasks follow GTD (P31-01).
  useBlockType({
    fs: vault.fs,
    markdown: notes.markdown,
    vaultKey,
    types,
    activity: activityLog,
    onChanged: typesChanged,
  });

  // Sync through GitHub (U-29): pulls on open, on its schedule, and before the window closes.
  const sync = useSync({
    host: syncPorts,
    fs: vault.fs,
    markdown: notes.markdown,
    vaultKey,
    changeKey: indexKey,
    clock: localClock,
    activity: activityLog,
    flushAll: editors.flushAll,
    closing: closing.first,
    onPulled: onChanged,
  });
  useEffect(() => {
    settleSync.current = sync.settle;
  }, [sync.settle]);
  // Granola's meetings (ADR-0034): on open once sync has pulled, every 15 minutes, and on Sync now.
  const granolaPull = useGranolaPull({
    granola: granolaPorts.port,
    records: granolaPorts.records,
    fs: vault.fs,
    markdown: notes.markdown,
    index: index.index,
    vaultKey,
    syncedThisSession: sync.syncedThisSession,
    syncPulls: sync.syncPulls,
    catchUpIndex,
    clock: localClock,
    activity: activityLog,
    onWrote: onChanged,
  });

  const thumbnails = useThumbnailQueue({ notes, snapshot, editors, types, onChanged });
  const thumbnailsNow = useThumbnailsNow(thumbnails);
  // One of each for the whole window: the panes and the API share the refresher,
  // so a source is never refreshed twice at once.
  const sourceRefresher = useMemo(
    () => createSourceRefresher({ activity: activityLog }),
    [activityLog],
  );
  // The tags page and the API rename tags through one queue per vault.
  const tagRenames = useMemo(() => createTagRenames(), []);
  const refreshSpacing = useMemo(() => createRefreshSpacing(), []);
  const apiHost = useApiHost({ vault: location, indexReady });
  // An archive from another tool moves notes; the panes follow through this,
  // pointed at `followEntryMove` below, so the API's deps stay put.
  const apiMoves = useMemo(() => createMoveRelay(), []);
  // What the automation runner, made further down, holds: read by the API's automations routes.
  const apiAutomations = useMemo(() => createAutomationRelay(), []);
  const apiDeps = useMemo<ApiRouterDeps>(
    () => ({
      host: apiHost,
      appInfo,
      clock: localClock,
      // Unbound: the router binds each request to the vault open as it arrives.
      fs: vaultPorts.fs,
      markdown: notePorts.markdown,
      index: indexPorts.index,
      openNotes: openNotesIn(editors),
      movingNotes: movingEditorsIn(editors, apiMoves.follow),
      // The queue of the vault open as each request arrives.
      thumbnails: thumbnailsNow,
      // Feeds and SQLite files only: the API never reaches the secret store.
      sources: { http: sources.http, sqlite: sources.sqlite },
      imagePlacement: () => browserImagePlacementStore.read(),
      sourceRefresher,
      tagRenames,
      refreshSpacing,
      newUploadId: () => crypto.randomUUID(),
      rng: cryptoRng,
      automationClock: apiAutomations.clock,
      activity: activityLog,
      googleCalendar,
      timeZone: localTimeZone,
    }),
    [
      apiHost,
      appInfo,
      vaultPorts.fs,
      notePorts.markdown,
      indexPorts.index,
      editors,
      apiMoves.follow,
      thumbnailsNow,
      sources.http,
      sources.sqlite,
      sourceRefresher,
      tagRenames,
      refreshSpacing,
      apiAutomations.clock,
      activityLog,
      googleCalendar,
    ],
  );
  // A write from another tool shows up the way one made here does.
  useLocalApi({ bridge: api.bridge, deps: apiDeps, onWrote: onChanged });
  // One toolbox construction for the chat and for a rule's Claude step (P29-03).
  const toolboxes = useMemo(
    () =>
      createToolboxes({
        api: apiDeps,
        markdown: notePorts.markdown,
        newId: () => crypto.randomUUID(),
      }),
    [apiDeps, notePorts.markdown],
  );

  const indexRevision = useIndexRevision(indexStore);
  useSqlViews({ index: index.index, types, ready: indexReady, revision: indexRevision });

  const paletteCommandsFor = useSteadyCallback((focused: NavigationPlace | null) => [
    ...PALETTE_COMMANDS,
    ...paletteArchiveCommands(focused?.kind === 'note' ? focused.path : null),
  ]);
  const paletteOffersFor = useCallback(
    (query: string) => [...paletteOffers(query), ...paletteEditTypeOffers(types, query)],
    [types],
  );
  // One overlay at a time; the rule is `openOverlay` and `closeOverlay`. The
  // search palette draws itself from the store, so ⌘K does not draw the window.
  const [overlays] = useState(createOverlayStore);
  const overlay = useWindowOverlay(overlays);
  const showOverlay = useCallback((requested: Overlay) => showIn(overlays, requested), [overlays]);
  const hideOverlay = useCallback((closing: Overlay) => hideIn(overlays, closing), [overlays]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Pressed from another app with no vault open: capture has no Inbox to land in.
  const [captureWantedVault, setCaptureWantedVault] = useState(false);
  const globalCapture = useGlobalCapture({
    ...globalCapturePorts,
    pressed: () => {
      setCaptureWantedVault(location === null);
      if (location !== null) showOverlay('capture');
    },
  });
  const captureNeedsVault =
    captureWantedVault && location === null
      ? 'Quick capture needs a vault: open one, and what you capture lands in its Inbox.'
      : null;

  const [favoriteError, setFavoriteError] = useState<string | null>(null);

  const { catalog, sidebarTypes, quick } = useSidebarCatalog({
    fs: vault.fs,
    markdown: notes.markdown,
    index: index.index,
    types,
    notePaths,
    vaultKey: location?.absolutePath ?? null,
    indexReady,
  });

  // A page is a tab that reads its own hooks (tab-model.md, PR B). The window
  // keeps three things alive only while a page shows, and is drawn as each flips.
  const inboxShown = usePageShown(workspace, 'inbox');
  const activityShown = usePageShown(workspace, 'activity');
  const automationsShown = usePageShown(workspace, 'automations');
  /** Opens a page in the focused pane's active tab. */
  const openPage = useCallback(
    (place: PagePlace) => openPlace(workspace, place, 'here'),
    [workspace],
  );
  // A type opened to be edited: the ask names the tab it lands in, whose mode it is.
  const [typeModes] = useState(createTypeModeStore);
  const openType = useCallback(
    (name: string, mode: TypePageMode = 'notes') => {
      openPage({ kind: 'type', name });
      if (mode === 'edit') {
        askToEdit(typeModes, { tabId: activeTabOf(workspaceNow(workspace)).id, name });
      }
    },
    [openPage, typeModes, workspace],
  );
  // What the pages hold in flight, per vault: shared by every tab on a page, kept across a switch and back.
  const [holdsByVault] = useState(createPageHoldsByVault);
  const openGraph = useCallback(
    (scope: GraphScope) => openPage({ kind: 'graph', scope }),
    [openPage],
  );
  const openQuery = useCallback(() => openPage({ kind: 'query' }), [openPage]);
  const openTags = useCallback((tag: string | null) => openPage({ kind: 'tags', tag }), [openPage]);
  const openArchive = useCallback(() => openPage({ kind: 'archive' }), [openPage]);
  const openInbox = useCallback(() => openPage({ kind: 'inbox' }), [openPage]);
  const activity = useActivity({
    log: activityLog,
    vaultKey,
    open: activityShown,
    seen: browserActivitySeenStore,
    clock: localClock,
  });
  const vaultGraph = useVaultGraph({ index: index.index, vaultKey, ready: indexReady });
  const vaultTags = useVaultTags({ index: index.index, vaultKey, ready: indexReady });
  const openTag = useCallback((name: string) => openTags(tagKey(name)), [openTags]);
  // Every relation is shown by the names in the same copy the graph reads.
  const names = useMemo(
    () => noteNames(vaultGraph.kind === 'ready' ? vaultGraph.graph.nodes : null),
    [vaultGraph],
  );

  const nameOfPlace = useCallback(
    (place: NavigationPlace) =>
      placeName(place, {
        titleOf: (path) =>
          (vaultGraph.kind === 'ready'
            ? vaultGraph.graph.nodes.find((node) => node.path === path)?.title
            : undefined) ?? noteTitle(path),
        typeLabelOf: (name) => types.find((type) => type.name === name)?.label ?? name,
        tagNameOf: (key) =>
          (vaultTags.state.kind === 'ready'
            ? vaultTags.state.counts.find((tag) => tag.key === key)?.name
            : undefined) ?? key,
      }),
    [vaultGraph, types, vaultTags.state],
  );
  // Steady, and the stores never change: the frames and strips read these and
  // are not drawn when the window is (tab-model.md §6).
  // Tabs remembered from the last launch may name notes deleted since: once
  // this vault's notes are listed, those tabs open on nothing (#346 attack).
  useEffect(() => {
    if (notesListedFor !== null && notesListedFor === vaultKey) keepNotes(workspace, notePaths);
  }, [workspace, notesListedFor, vaultKey, notePaths]);
  const nameOf = useSteadyCallback(nameOfPlace);
  const workspaceStores = useMemo<WorkspaceStores>(
    () => ({ store: workspace, reveals, overlays, nameOf, aside: asideStore, shown: shownNotes }),
    [workspace, reveals, overlays, nameOf, asideStore, shownNotes],
  );
  /** Opens a note from outside the panes — the sidebar, search, a new note — where the click asked. */
  const openNote = useCallback(
    (path: VaultPath, how: OpenHow = 'here') => openNotePlace(workspace, path, how),
    [workspace],
  );

  const viewDrafts = useViewDrafts(vaultKey);
  // Every path a new view's name is checked against: the views folder's files, lifted views included.
  const viewPaths = catalog.takenViewPaths;

  const stranded = useStrandedEdits({
    store: browserStrandedStore,
    vaultKey: location?.absolutePath ?? null,
    now: Date.now,
  });

  const { onTypeSaved, newType, newNoteOfType } = useTypeCommands({
    ports: { fs: vault.fs, markdown: notes.markdown },
    types,
    notePaths,
    onChanged,
    reloadTypes,
    onTypeCreated: (created) => {
      hideOverlay('new-type');
      openType(created.name, 'edit');
    },
    onNoteCreated: openNote,
  });

  const newView = useNewView({
    fs: vault.fs,
    markdown: notes.markdown,
    types,
    viewPaths,
    activity: activityLog,
    onCreated: (path) => {
      hideOverlay('new-view');
      onChanged();
      openNote(path);
    },
  });
  const newArtifact = useNewArtifact({
    thumbnails,
    fs: vault.fs,
    markdown: notes.markdown,
    index: index.index,
    clock: localClock,
    indexKey,
    activity: activityLog,
    onCreated: (path) => {
      hideOverlay('new-artifact');
      onChanged();
      openNote(path);
    },
  });
  const { start: startArtifact } = newArtifact;
  const startNewArtifact = useCallback(
    (url = '') => {
      startArtifact(url);
      showOverlay('new-artifact');
    },
    [startArtifact, showOverlay],
  );

  const startNewView = useCallback(
    (type: string | null) => {
      newView.start(type);
      showOverlay('new-view');
    },
    [newView, showOverlay],
  );

  const profileSetting = useProfileSetting({
    fs: vault.fs,
    markdown: notes.markdown,
    vaultKey,
    activity: activityLog,
  });
  const selfEmailsSetting = useSelfEmailsSetting({
    fs: vault.fs,
    markdown: notes.markdown,
    index: index.index,
    vaultKey,
    changeKey: indexKey,
    indexReady,
    activity: activityLog,
  });
  // What a rule's Claude step reaches (P29-03), with the owner's name as their profile holds it (P29-05)
  // and their addresses as the vault's settings hold them (#173).
  const ownerName = profileSetting.profile === 'unknown' ? null : profileSetting.profile.name;
  const ownerEmails = selfEmailsSetting.emails;
  // Whether both were read, so nothing that asks who the owner is acts on a stand-in: an unreadable settings note is not known.
  const ownerKnown = vaultOwnerKnown(profileSetting, selfEmailsSetting);
  // Meanwhile the import and the automations are held: said on the Inbox and, once each way, in Activity.
  const settingsProblem = settingsUnreadable(profileSetting);
  useSettingsPause({ unreadable: settingsProblem, vaultKey, activity: activityLog });
  const claudeStep = useMemo(
    () =>
      claudeStepPorts({
        ports: chatPorts,
        store: browserChatSettingsStore,
        toolboxes,
        vault: () => vaultKey,
        selfName: () => ownerName,
        selfEmails: () => ownerEmails,
      }),
    [chatPorts, toolboxes, vaultKey, ownerName, ownerEmails],
  );
  // The aside folds where the window is too narrow for it beside the left
  // sidebar (collapse.ts). Asking for it there — ⌘J, the bar's button, ⌥⌘\ —
  // hides the left sidebar instead, where that makes room (not under 796px,
  // where the aside folds on its own: the sidebar then stays), so Claude is
  // reachable in a 1000px window; ⌘\ brings the sidebar back. The store is
  // told as the window folds it, so the toggle's pressed state, each note's
  // body and every ask read what is on screen, not what is remembered.
  const asideCollapsed = useAsideCollapsed({ sidebarOpen });
  useEffect(() => setAsideFolded(asideStore, asideCollapsed), [asideStore, asideCollapsed]);
  const roomForAside = useCallback(() => {
    const width = window.innerWidth;
    const folds = (open: boolean) => collapseFor({ width, sidebarOpen: open }).aside;
    if (folds(true) && !folds(false)) setSidebarOpen(false);
  }, []);
  // An ask opens the aside whatever the store holds: the window's answer to
  // the room just made arrives after this event, so `folded` still says folded.
  const askForAside = useCallback(
    (show: (store: typeof asideStore) => void) => {
      roomForAside();
      show(asideStore);
    },
    [asideStore, roomForAside],
  );
  // The chat's seat is the aside's Claude tab (plan question 4): ⌘J brings the aside up on it.
  const claudeShown = useClaudeShown(asideStore);
  const claudeAsked = useClaudeAsked(asideStore);
  const chatSeat = useMemo(
    () => ({
      open: claudeShown,
      asked: claudeAsked,
      toggle: () => (claudeShown ? hideAside(asideStore) : askForAside(toggleClaude)),
      close: () => hideAside(asideStore),
    }),
    [claudeShown, claudeAsked, asideStore, askForAside],
  );
  const chat = useChat({
    ports: chatPorts,
    store: browserChatSettingsStore,
    seat: chatSeat,
    vault: {
      api: apiDeps,
      fs: location === null ? null : vault.fs,
      markdown: notes.markdown,
      openNotes: openNotesIn(editors),
      toolboxes,
      notePaths,
      vaultKey,
      onChanged,
    },
    // The focused tab's query, while it is on the query page; else the note it shows, or nothing.
    window: chatWindowOf({ query: focusedQueryText(), focused: focusedNote() }),
    clipboard: browserClipboard,
    settingsOpen: overlay === 'settings',
    activity: activityLog,
    profile: profileSetting.profile,
  });
  // The chat follows the note being worked in, and the query being written,
  // while it is open: a switch of note or a keystroke in the query draws the
  // window again then, and only then, since the chat's window is read from a
  // render. Shut, neither costs the window anything.
  const [, windowMoved] = useReducer((drawn: number) => drawn + 1, 0);
  useEffect(() => {
    if (!chat.open) return;
    const stopNotes = workspace.subscribe((state, before) => {
      const was = activeTabOf(before.workspace);
      const now = activeTabOf(state.workspace);
      if (
        was.id !== now.id ||
        tabPlace(was)?.kind !== tabPlace(now)?.kind ||
        focusedNotePath(state.workspace) !== focusedNotePath(before.workspace)
      ) {
        windowMoved();
      }
    });
    const stopQuery = queryText.subscribe(windowMoved);
    return () => {
      stopNotes();
      stopQuery();
    };
  }, [chat.open, workspace, queryText]);

  const favoritePaths = useMemo(
    () => new Set(catalog.favorites.map((entry) => entry.path)),
    [catalog],
  );

  /**
   * Stars a note, or unstars it, by writing the property into the file.
   *
   * A note open in a pane is written through that pane's own save: writing the
   * same file underneath it would move the file on while the editor still held
   * the modification time it read, and the next save would be refused.
   */
  const toggleFavorite = useCallback(
    (path: VaultPath) => {
      const value = favoriteValue(!favoritePaths.has(path));
      setFavoriteError(null);

      editors
        .setPropertiesIfOpen({ path, values: { [FAVORITE_KEY]: value } })
        .then((takenByAPane) => {
          if (takenByAPane) return;
          return setNoteProperty({
            fs: vault.fs,
            markdown: notes.markdown,
            path,
            key: FAVORITE_KEY,
            value,
            today: localToday(),
          }).then(() => reload());
        })
        .then(() => void refresh())
        .catch((cause: unknown) =>
          setFavoriteError(cause instanceof Error ? cause.message : String(cause)),
        );
    },
    [favoritePaths, editors, vault.fs, notes.markdown, reload, refresh],
  );

  const {
    templates,
    listed: templatesListed,
    contentsOf,
  } = useTemplates({
    fs: vault.fs,
    vaultKey: location?.absolutePath ?? null,
  });

  // Held from one render to the next: `createNoteIn` is built on it and is one
  // of the ports every vault use-case is handed. A new one each render gave
  // them all new ports each render, and whatever reads when its ports change
  // (the Inbox's proposals) then read the vault again, drew, and read again,
  // without end — which kept the window too busy to place a click (#140).
  const openCreated = useCallback(
    (path: VaultPath) => {
      void reload();
      openNote(path);
      void refresh();
    },
    [reload, openNote, refresh],
  );
  const {
    createNewNote,
    createNoteIn,
    createFromTemplate,
    captureNote,
    openDailyNote: openOrMakeDailyNote,
    error: createError,
  } = useCreateNote({
    fs: vault.fs,
    markdown: notes.markdown,
    notePaths,
    beside: focusedNote,
    templates,
    contentsOf,
    onCreated: openCreated,
  });

  // A note or folder moved in the app takes with it the panes showing it, the
  // unsaved edits of a view under it, and what its ticks remembered.
  const followEntryMove = useCallback(
    (move: EntryMove) => {
      followMoveIn(workspace, move);
      viewDrafts.follow(move);
      tickMemory.follow(move);
    },
    [workspace, viewDrafts, tickMemory],
  );
  useEffect(() => apiMoves.point(followEntryMove), [apiMoves, followEntryMove]);

  // A deleted note takes with it the panes showing it and, for a view, its
  // unsaved edits — or a new view made under its name would wear them.
  const closeDeleted = useCallback(
    (gone: readonly VaultPath[]) => {
      closeNotesIn(workspace, gone);
      viewDrafts.forget(gone);
    },
    [workspace, viewDrafts],
  );

  const entryPorts = useMemo<VaultEntryPorts>(
    () => ({
      fs: vault.fs,
      index: index.index,
      editors: movingEditorsIn(editors, followEntryMove),
      tree: { reload, expandDirectory, forgetDirectory, isExpanded },
      closeNotes: closeDeleted,
      refresh: () => void refresh(),
      createNoteIn,
      overlay: { show: showOverlay, hide: hideOverlay },
    }),
    [
      vault.fs,
      index.index,
      editors,
      followEntryMove,
      reload,
      expandDirectory,
      forgetDirectory,
      isExpanded,
      closeDeleted,
      refresh,
      createNoteIn,
      showOverlay,
      hideOverlay,
    ],
  );
  const entries = useVaultEntries(entryPorts, notePaths);
  const templatesPage = useTemplatesPage({
    ports: {
      fs: vault.fs,
      markdown: notes.markdown,
      editors: entryPorts.editors,
      closeNotes: entryPorts.closeNotes,
      overlay: { show: showOverlay, hide: hideOverlay },
    },
    types,
    listed: templatesListed,
    onChanged,
    onOpen: openNote,
  });
  const { editTypeTemplate, askDelete: askDeleteTemplate, askMoveToNotes } = templatesPage;
  const onRenameTemplate = templatesPage.page.onRename;
  const templateCommands = useMemo(
    () => ({
      onOpenTemplates: () => openPage({ kind: 'templates' }),
      rename: onRenameTemplate,
      askDelete: askDeleteTemplate,
      askMoveToNotes,
    }),
    [openPage, onRenameTemplate, askDeleteTemplate, askMoveToNotes],
  );
  const [typeTabStore] = useState(createBrowserTypeTabStore);
  const typeViews = useTypeViews({
    ports: { fs: vault.fs, markdown: notes.markdown, editors },
    types,
    savedViews: catalog.savedViews,
    viewPaths,
    vaultKey,
    store: typeTabStore,
    onChanged,
    onOpenType: openType,
    onEditTemplate: editTypeTemplate,
    askDelete: entries.askDelete,
  });
  const { landing: typeLanding, remember: rememberTypeTab } = typeViews;
  /** A type in the sidebar opens on its views — the last one open, else the first — or its table. */
  const openTypePage = useCallback(
    (name: string) => {
      const view = typeLanding(name);
      if (view === null) openType(name, 'notes');
      else openNote(view);
    },
    [typeLanding, openType, openNote],
  );
  // Whichever of a type's views the person is in is the one its type opens on next.
  useEffect(
    () =>
      workspace.subscribe((state) => {
        const path = focusedNotePath(state.workspace);
        if (path !== null) rememberTypeTab(path);
      }),
    [workspace, rememberTypeTab],
  );

  const archivePorts = useMemo(
    () => ({ ...entryPorts, markdown: notes.markdown }),
    [entryPorts, notes.markdown],
  );
  /** Re-reads the tree and the index after a write; settles once the index holds it. */
  const settleArchive = useCallback(() => {
    const refreshed = refresh();
    void reload();
    return refreshed;
  }, [refresh, reload]);
  // Meetings that n8n commits arrive by pull: each is checked, deduplicated and marked (P28-04).
  useMeetingImport({
    changes: noteChanges,
    ports: archivePorts,
    clock: localClock,
    activity: activityLog,
    vaultKey,
    // Only the Mac that runs the automations writes into meeting files (U-29),
    // and only on fresh sync state (ADR-0035 part 4).
    active: sync.automationsHere,
    indexReady,
    selfName: ownerName,
    selfEmails: ownerEmails,
    ownerKnown,
    pulledFiles: sync.pulledFiles,
    onWritten: settleArchive,
  });
  const archive = useArchive({
    ports: archivePorts,
    clock: localClock,
    notePaths,
    indexKey,
    onSettled: settleArchive,
    offerLinks: entries.offerLinks,
  });
  const archiveCommands = archive.commands;
  // Moving the tasks to GTD's statuses, previewed from the Inbox page (P30-02).
  const taskMigration = useTaskMigration({
    ports: archivePorts,
    vaultKey,
    indexReady,
    open: inboxShown,
    activity: activityLog,
    onChanged: typesChanged,
  });
  // Moving Area and Resource notes onto the one Project type, previewed from the Inbox page (#213).
  const paraMigration = useParaMigration({
    ports: archivePorts,
    vaultKey,
    indexReady,
    open: inboxShown,
    activity: activityLog,
    onChanged: typesChanged,
  });
  // Moving loose notes and old meetings to their home folders, once, previewed there too (#214).
  const vaultTidy = useVaultTidy({
    ports: archivePorts,
    vaultKey,
    indexReady,
    open: inboxShown,
    activity: activityLog,
    onChanged: settleArchive,
  });
  // The tasks meetings made that today's rules would not have, offered to archive there too (#226).
  const cleanupPorts = useMemo(
    () => ({ ...archivePorts, index: index.index }),
    [archivePorts, index.index],
  );
  const cleanupOwner = useMemo(
    () => (ownerKnown ? { selfName: ownerName, selfEmails: ownerEmails } : null),
    [ownerKnown, ownerName, ownerEmails],
  );
  const meetingCleanup = useMeetingCleanup({
    ports: cleanupPorts,
    owner: cleanupOwner,
    vaultKey,
    indexReady,
    open: inboxShown,
    activity: activityLog,
    onChanged: settleArchive,
    onOpenTask: (path) => openNote(createVaultPath(path)),
  });
  // Filing the meetings with no project as their series is, previewed there too (#227).
  const meetingProjects = useMeetingProjects({
    ports: archivePorts,
    vaultKey,
    indexReady,
    open: inboxShown,
    owner: { selfName: ownerName, selfEmails: ownerEmails },
    activity: activityLog,
    onChanged: settleArchive,
  });
  // The Today page and the weekly review show in the sidebar once the vault has tasks.
  const tasksShown = taskTypeOf(types) !== null;
  const todayView = quick.find((view) => view.id === 'today')?.entry ?? null;
  const inboxView = quick.find((view) => view.id === 'inbox')?.entry ?? null;
  // One Inbox: its count is what waits to be filed and the proposals waiting
  // for an answer, read by the window whatever tab the page is in.
  const waiting = useInboxWaiting({
    index: index.index,
    fs: vault.fs,
    markdown: notes.markdown,
    vaultKey,
    indexReady,
    types,
  });
  // As with Today, no row that opens nothing: the Inbox shows once the vault
  // has an Inbox view or something waits in it.
  const inboxRowShown = inboxView !== null || (waiting ?? 0) > 0;
  const automationPorts = useMemo(
    () => ({ ...archivePorts, types, notePaths, claude: claudeStep }),
    [archivePorts, types, notePaths, claudeStep],
  );
  const automations = useAutomations({
    ports: automationPorts,
    clock: localClock,
    vaultKey,
    indexKey,
    indexReady,
    activity: activityLog,
    onSettled: settleArchive,
    live: automationsShown,
    // A synced vault runs its automations on one Mac only (U-29), once it and the owner are known.
    scheduled: automationsScheduled({
      automationsHere: sync.automationsHere,
      macKnown: sync.thisMac !== null && sync.settings !== null,
      ownerKnown,
    }),
    // A rule a note sets off hears of it here (P29-01).
    changes: noteChanges,
    // Its Claude step runs only on fresh sync state (ADR-0035 part 4).
    pulledFiles: sync.pulledFiles,
  });
  const { watchingSince: automationsSince, pauses: automationPauses } = automations;
  useEffect(
    () =>
      apiAutomations.point({
        vault: vaultKey,
        watchingSince: automationsSince,
        pauses: automationPauses,
      }),
    [apiAutomations, vaultKey, automationsSince, automationPauses],
  );
  const treeMenuFor = useCallback(
    (entry: VaultEntry) =>
      withCommandBeforeDelete(
        entries.menuFor(entry),
        archiveCommand({ entry, notePaths, commands: archiveCommands }),
      ),
    [entries, notePaths, archiveCommands],
  );

  /** Renames a note from its page head; every pane showing it follows. */
  const renamePaneNote = useCallback(
    ({ path, name }: { path: VaultPath; name: string }) =>
      entries.rename({ path, kind: 'file' }, name),
    [entries],
  );

  const captureTemplate = useMemo(() => findTaskTemplate(templates), [templates]);

  const quickAddSetting = useQuickAddSetting({
    fs: vault.fs,
    markdown: notes.markdown,
    vaultKey,
    activity: activityLog,
  });
  const sidebarOrder = useSidebarOrder({
    fs: vault.fs,
    markdown: notes.markdown,
    vaultKey,
    activity: activityLog,
  });
  const secrets = useSecrets({
    store: sources.secrets,
    fs: vault.fs,
    markdown: notes.markdown,
    index: index.index,
    vault: vaultKey,
    changeKey: indexKey,
    active: overlay === 'settings',
  });
  const googleCalendarSetting = useGoogleCalendar({
    port: googleCalendar,
    fs: vault.fs,
    markdown: notes.markdown,
    vault: vaultKey,
    active: overlay === 'settings',
    activity: activityLog,
  });
  const granolaSetting = useGranola({
    port: granolaPorts.port,
    pull: granolaPull,
    vault: vaultKey,
    links,
    fs: vault.fs,
    markdown: notes.markdown,
  });
  const quickAddPorts = useMemo(
    () => ({ fs: vault.fs, markdown: notes.markdown, index: index.index, store: browserFabStore }),
    [vault.fs, notes.markdown, index.index],
  );
  const quickAdd = useQuickAdd({
    ports: quickAddPorts,
    setting: quickAddSetting,
    types,
    templates,
    contentsOf,
    notePaths,
    beside: focusedNote,
    overlay: { show: showOverlay, hide: hideOverlay },
    onCreated: ({ path, open }) => {
      onChanged();
      if (open) openNote(path);
    },
  });

  const captureTask = useCallback(
    async (name: string) => {
      const path = await captureNote(name, captureTemplate);
      if (path !== null) openNote(path);
    },
    [captureNote, captureTemplate, openNote],
  );

  /** Today's note, made on demand — where and from what is `ensureDailyNote`'s to say. */
  const openDailyNote = useCallback(async () => {
    const path = await openOrMakeDailyNote(localToday());
    if (path !== null) openNote(path);
  }, [openOrMakeDailyNote, openNote]);

  const [linkError, setLinkError] = useState<string | null>(null);

  const peoplePorts = useMemo(
    () => ({ fs: vault.fs, markdown: notes.markdown, index: index.index }),
    [vault.fs, notes.markdown, index.index],
  );
  const vaultPeople = usePeople({
    ports: peoplePorts,
    indexKey,
    ready: indexReady,
    notePaths,
    types,
    templates,
    onCreated: onChanged,
  });

  // Archived notes are not offered for `[[`; a link to one still opens it.
  const notesInUse = useMemo(() => activeNotePaths(notePaths), [notePaths]);
  const suggestNotes = useCallback(
    (query: string) => rankNoteSuggestions(query, notesInUse, { linkable: notePaths }),
    [notesInUse, notePaths],
  );

  /** Follows a wiki link in the pane it was clicked in — a link opens where you are reading. */
  const followLinkInPane = useCallback(
    (link: { pane: number; target: string; heading?: string | null }) =>
      followLink({ store: workspace, reveals, notePaths, onProblem: setLinkError }, link),
    [workspace, reveals, notePaths],
  );
  /** Opens the line a proposal cites — `[[2026-10-01 Standup#^t0003]]` — in the focused pane. */
  const followSource = useCallback(
    (link: string) => {
      const read = readWikiLink(link.trim());
      if (read === null) {
        setLinkError(`${link} is not a link to a note`);
        return;
      }
      followLinkInPane({
        pane: workspaceNow(workspace).focused,
        target: read.target,
        heading: read.heading,
      });
    },
    [followLinkInPane, workspace],
  );

  const paneOpenNotes = useMemo(() => openNotesIn(editors), [editors]);
  const paneContext: PaneContext = useMemo(
    () => ({
      vault: vaultKey,
      notes,
      index: index.index,
      sources,
      sourceRefresher,
      links,
      newArtifact: startNewArtifact,
      thumbnails,
      types,
      notePaths,
      indexKey,
      onChanged,
      changes: noteChanges,
      onTypeSaved,
      suggestNotes,
      suggestTags: vaultTags.suggest,
      people: vaultPeople.people,
      openTag,
      editors,
      stranded,
      activity: activityLog,
      savedViews: catalog.savedViews,
      typeTabs: typeViews.editingFor,
      queryViews: catalog.queryViews,
      dashboards: catalog.dashboards,
      tickMemory,
      groupFolds,
      linkedRanges,
      graph: vaultGraph.kind === 'ready' ? vaultGraph.graph : null,
      openNotes: paneOpenNotes,
      viewPaths,
      viewDrafts,
      archive: archiveCommands,
      onLinkProblem: setLinkError,
      templateCommands,
    }),
    [
      vaultKey,
      notes,
      index.index,
      sources,
      sourceRefresher,
      links,
      startNewArtifact,
      thumbnails,
      types,
      notePaths,
      indexKey,
      onChanged,
      noteChanges,
      onTypeSaved,
      suggestNotes,
      vaultTags.suggest,
      vaultPeople.people,
      openTag,
      editors,
      stranded,
      activityLog,
      catalog.savedViews,
      typeViews.editingFor,
      catalog.queryViews,
      catalog.dashboards,
      tickMemory,
      groupFolds,
      linkedRanges,
      vaultGraph,
      paneOpenNotes,
      viewPaths,
      viewDrafts,
      archiveCommands,
      templateCommands,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    getAppInfo({ appInfo })
      .then((info) => {
        if (!cancelled) setApp({ kind: 'ready', info });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setApp({ kind: 'failed', message: String(cause) });
      });
    return () => {
      cancelled = true;
    };
  }, [appInfo]);

  useAppShortcuts({
    // Read at the key press: the window is not drawn again as ⌘K opens.
    overlay: () => overlayNow(overlays),
    // The editors are registered under their tabs: the focused pane's shown one saves.
    save: () => editors.savePane(activeTabOf(workspaceNow(workspace)).id),
    newNote: () => void createNewNote(),
    toggleSidebar: () => setSidebarOpen((was) => !was),
    toggleSplit: () => toggleSplitIn(workspace),
    dailyNote: () => void openDailyNote(),
    quickAdd: quickAdd.start,
    back: () => goBack(workspace),
    forward: () => goForward(workspace),
    show: showOverlay,
    toggleChat: chat.toggle,
    toggleAside: () =>
      asideShownNow(asideStore.getState()) ? hideAside(asideStore) : askForAside(toggleAsideIn),
    tabs: {
      newTab: () => newTabIn(workspace, workspaceNow(workspace).focused),
      closeTab: () => closeActiveTab(workspace),
      nextTab: () => nextTab(workspace),
      previousTab: () => previousTab(workspace),
      nthTab: (n) => activateNthTab(workspace, n),
      reopenClosedTab: () => reopenClosedTab(workspace),
    },
  });

  const treeRows = useMemo(() => sidebarTreeRows(rows), [rows]);
  const toggleSidebar = useCallback(() => setSidebarOpen((was) => !was), []);
  const asideShown = useAsideShown(asideStore);
  const asideToggle = useMemo(
    () => ({
      shown: asideShown,
      onToggle: () => (asideShown ? hideAside(asideStore) : askForAside(toggleAsideIn)),
    }),
    [asideShown, asideStore, askForAside],
  );
  const rowPorts = useMemo(() => ({ pane: paneContext, openNote }), [paneContext, openNote]);

  const syncBadge = syncIndicatorBadge(sync);
  const fromGitHub = useOpenFromGitHub({
    folders: syncPorts.folders,
    store: choosing.store,
    openVault: vaultKey,
    beforeSwitch: leaveVault,
    showVault,
    onDone: () => hideOverlay('open-from-github'),
  });

  const noticeMessages = [
    error,
    typesFailure,
    linkError,
    vaultPeople.error,
    createError,
    entries.notice,
    archive.notice,
    favoriteError,
    typeViews.error,
    newNoteOfType.error,
    templatesPage.notice,
    sidebarOrder.unreadable,
  ];
  const indexFailure = location !== null ? indexFailedWith : null;
  const sidebarOrderFailure =
    sidebarOrder.problem === null
      ? null
      : `The sidebar's order could not be saved: ${sidebarOrder.problem}`;
  // A red notice is where a use case gave up, so it is kept in the Activity log
  // once each time it appears. The index's failure is not: syncIndex records
  // it. Nor is the sidebar's order, whose setting records it. Nor is the offer
  // to update links, which is a question, not a failure; edits kept for later
  // are a warning.
  useNoticeActivity({ errors: noticeMessages, warnings: [stranded.notice] }, activityLog);
  const notices = (
    <AppNotices
      messages={[
        ...noticeMessages,
        sidebarOrderFailure,
        indexFailure,
        captureNeedsVault,
        syncConflictNotice(sync.phase),
      ]}
      links={entries.links}
      stranded={stranded}
    />
  );
  // Steady, so the palette is not drawn again with the window while it is shut (#261).
  const runPaletteCommand = useSteadyCallback((id: string, query: string) => {
    const pasted = claudeArtifactUrl(query) ?? '';
    if (
      runPaletteArchiveCommand(id, {
        focused: focusedNote(),
        commands: archiveCommands,
        openArchive,
      })
    ) {
      return;
    }
    if (
      runPaletteEditTypeCommand(id, {
        editType: (name) => openType(name, 'edit'),
        editTemplate: editTypeTemplate,
      })
    ) {
      return;
    }
    if (id === OPEN_TEMPLATES) openPage({ kind: 'templates' });
    else if (id === OPEN_TERMS) openPage({ kind: 'terms' });
    else if (id === OPEN_INBOX) openInbox();
    else if (id === OPEN_REVIEW) openPage({ kind: 'review' });
    else if (id === OPEN_TODAY) openPage({ kind: 'today' });
    else if (id === 'new-query') openQuery();
    else if (id === 'new-artifact') startNewArtifact();
    else if (id === SAVE_ARTIFACT_LINK) startNewArtifact(pasted);
    else startNewView(null);
  });
  const openPaletteHit = useSteadyCallback((path: string) => openNote(createVaultPath(path)));

  const granolaToast = granolaPull.toast !== null && (
    <Toast
      key={granolaPull.toastShown}
      message={granolaPull.toast}
      onDismiss={granolaPull.dismissToast}
    />
  );

  return (
    <NoteNamesProvider value={names}>
      <ChatToggleProvider
        value={location === null ? null : { open: chat.open, onToggle: chat.toggle }}
      >
        <AppShell
          sidebarOpen={sidebarOpen}
          asideOpen={asideShown}
          // Every page carries its own way back in its bar; only the empty
          // state, which has no page, needs the shell's.
          {...(location === null && { onShowSidebar: toggleSidebar })}
          sidebar={
            <>
              {location !== null && (
                <>
                  <VaultHeader
                    vaultName={location.name}
                    vaultInitial={vaultInitial(location.name)}
                    templates={templates}
                    onChooseVault={chooseVault}
                    onOpenFromGitHub={() => showOverlay('open-from-github')}
                    onNewNote={() => void createNewNote()}
                    onNewFromTemplate={(path) => void createFromTemplate(path)}
                    onDailyNote={() => void openDailyNote()}
                    onNewArtifact={() => startNewArtifact()}
                    onHideSidebar={toggleSidebar}
                    menuOpen={overlay === 'new-note-menu'}
                    onMenuOpenChange={(open) =>
                      open ? showOverlay('new-note-menu') : hideOverlay('new-note-menu')
                    }
                  />
                  <ActiveSidebar
                    store={workspace}
                    viewOwner={typeViews.ownerOf}
                    favorites={catalog.favorites}
                    types={sidebarTypes}
                    views={catalog.views}
                    dashboards={catalog.dashboards}
                    quick={quick}
                    tree={{
                      rows: treeRows,
                      onToggleDirectory: toggleDirectory,
                      onOpenArchive: openArchive,
                      editing: {
                        menuFor: treeMenuFor,
                        menuOpen: overlay === 'tree-menu',
                        onMenuOpenChange: (open) =>
                          open ? showOverlay('tree-menu') : hideOverlay('tree-menu'),
                        renaming: entries.renaming,
                        onRename: ({ entry, name }) => entries.rename(entry, name),
                        onCancelRename: entries.cancelRename,
                        canDrop: ({ entry, folder }) => moveRefusal(entry, folder) === null,
                        onDrop: ({ entry, folder }) => entries.moveInto(entry, folder),
                      },
                      create: {
                        label: 'New in Pages',
                        items: [
                          {
                            label: 'New note',
                            onSelect: () => entries.newNoteIn(VAULT_ROOT),
                            movesFocus: true,
                          },
                          {
                            label: 'New folder',
                            onSelect: () => entries.newFolderIn(VAULT_ROOT),
                            movesFocus: true,
                          },
                        ],
                        open: overlay === 'pages-menu',
                        onOpenChange: (open) =>
                          open ? showOverlay('pages-menu') : hideOverlay('pages-menu'),
                      },
                    }}
                    sectionStore={browserSectionStore}
                    sectionOrder={sidebarOrder.order}
                    onSearch={() => showOverlay('search')}
                    onOpenGraph={() => openGraph({ kind: 'vault' })}
                    onOpenTags={() => openTags(null)}
                    onOpenAutomations={() => openPage({ kind: 'automations' })}
                    activity={{
                      onOpen: () => openPage({ kind: 'activity' }),
                      unseenErrors: activity.unseenErrors,
                    }}
                    onOpen={openNote}
                    onOpenTemplates={() => openPage({ kind: 'templates' })}
                    onOpenTerms={() => openPage({ kind: 'terms' })}
                    {...(inboxRowShown && { inbox: { onOpen: openInbox, count: waiting } })}
                    {...(tasksShown && { onOpenReview: () => openPage({ kind: 'review' }) })}
                    {...(tasksShown && { onOpenToday: () => openPage({ kind: 'today' }) })}
                    onOpenType={openTypePage}
                    onEditType={(name) => openType(name, 'edit')}
                    onEditTemplate={editTypeTemplate}
                    onNewType={() => {
                      newType.reset();
                      showOverlay('new-type');
                    }}
                    viewsCreate={{
                      label: 'New in Views',
                      items: [
                        { label: 'New view', onSelect: () => startNewView(null), movesFocus: true },
                        { label: 'New query', onSelect: openQuery, movesFocus: true },
                      ],
                      open: overlay === 'views-menu',
                      onOpenChange: (open) =>
                        open ? showOverlay('views-menu') : hideOverlay('views-menu'),
                    }}
                    onToggleFavorite={toggleFavorite}
                  />
                </>
              )}
              <SidebarFooter
                themeStore={browserThemeStore}
                onOpenSettings={() => showOverlay('settings')}
                sync={
                  syncBadge !== null && (
                    <SyncIndicator badge={syncBadge} onOpen={() => showOverlay('settings')} />
                  )
                }
              />
            </>
          }
          notices={
            <>
              {notices}
              {granolaToast}
            </>
          }
          main={
            location === null ? (
              <VaultEmptyState
                onChooseVault={chooseVault}
                onOpenFromGitHub={() => showOverlay('open-from-github')}
              />
            ) : null
          }
          panes={
            location === null ? null : (
              <WorkspaceStoresProvider value={workspaceStores}>
                <WorkspaceWiringProvider
                  value={{
                    ...workspaceStores,
                    pane: paneContext,
                    onShowSidebar: sidebarOpen ? null : toggleSidebar,
                    note: {
                      onRename: renamePaneNote,
                      onToggleFavorite: toggleFavorite,
                      onMoveTo: (target) => entries.askMove({ path: target, kind: 'file' }),
                      onDelete: (target) => entries.askDelete({ path: target, kind: 'file' }),
                      onShowInGraph: (target) =>
                        openGraph({ kind: 'note', path: target, depth: 1 }),
                    },
                    pages: {
                      ports: archivePorts,
                      indexReady,
                      onSettled: settleArchive,
                      openNote,
                      openPage,
                      holds: holdsByVault.of(location.absolutePath),
                      today: {
                        view:
                          todayView === null
                            ? null
                            : { title: todayView.title, onOpen: () => openNote(todayView.path) },
                        onOpenDailyNote: () => void openDailyNote(),
                      },
                      inbox: {
                        closing: closing.writes,
                        pendingWrites,
                        onOpenSource: followSource,
                        typesOffer:
                          typesOffer === null
                            ? null
                            : {
                                lines: typesOffer.lines,
                                onAccept: () => void typesOffer.accept(),
                                onDismiss: typesOffer.dismiss,
                              },
                        taskMigration,
                        paraMigration,
                        vaultTidy,
                        meetingCleanup,
                        settingsUnreadable:
                          settingsProblem === null
                            ? null
                            : {
                                problem: settingsProblem,
                                onOpenSettings: () => showOverlay('settings'),
                              },
                        ownerUnknown:
                          ownerKnown &&
                          automations.listing !== null &&
                          ownerNeededBy(
                            automations.listing.automations.map(({ rule }) => rule),
                            { selfName: ownerName, selfEmails: ownerEmails, people: [] },
                          )
                            ? { onOpenSettings: () => showOverlay('settings') }
                            : null,
                        meetingProjects,
                        view:
                          inboxView === null
                            ? null
                            : { title: inboxView.title, onOpen: () => openNote(inboxView.path) },
                      },
                      templates: templatesPage.page,
                      terms: { templates },
                      activity: { activity },
                      automations: { automations, ports: automationPorts },
                      graph: { state: vaultGraph },
                      query: { text: queryText },
                      tags: {
                        tags: vaultTags.state,
                        renames: tagRenames.forVault(location.absolutePath),
                      },
                      type: {
                        editAsked: typeModes,
                        onNotes: openTypePage,
                        // An artifact is saved from its link or its page, not made blank.
                        onNewNote: (type) =>
                          type.name === ARTIFACT_TYPE
                            ? startNewArtifact()
                            : newNoteOfType.create(type),
                        onDelete: (path) => entries.askDelete({ path, kind: 'file' }),
                        onEditTemplate: (type) => editTypeTemplate(type.name),
                      },
                    },
                  }}
                >
                  {/* Keyed by vault: its editors, and what each pane keeps mounted, are that vault's (R14-01). */}
                  <AsideToggleProvider value={asideToggle}>
                    <PanesContainer key={vaultKey ?? ''} />
                  </AsideToggleProvider>
                </WorkspaceWiringProvider>
              </WorkspaceStoresProvider>
            )
          }
          aside={
            location === null ? null : (
              // The same stores the panes read; the chat reaches only its own tab.
              <WorkspaceStoresProvider value={workspaceStores}>
                <ClaudeSeatProvider
                  value={
                    chat.open && (
                      <ChatPane
                        chat={chat}
                        onFollowLink={(target) =>
                          followLinkInPane({ pane: workspaceNow(workspace).focused, target })
                        }
                        loadImage={noImages}
                        nameHint={
                          profileSetting.profile !== 'unknown' &&
                          !hasFullName(profileSetting.profile)
                            ? {
                                placeholder: NAME_PLACEHOLDER,
                                onSetName: () => showOverlay('settings'),
                              }
                            : null
                        }
                      />
                    )
                  }
                >
                  <AsideContainer rows={rowPorts} />
                </ClaudeSeatProvider>
              </WorkspaceStoresProvider>
            )
          }
          status={location === null ? null : indexStatusText(indexStatus)}
          floating={
            location === null ? null : (
              <>
                <IndexProgressPill status={indexStatus} progress={indexProgress} />
                <QuickAdd
                  quickAdd={quickAdd}
                  overlay={{ current: overlay, show: showOverlay, hide: hideOverlay }}
                  onOpen={openNote}
                />
              </>
            )
          }
          overlay={
            overlay === 'settings' ? (
              <SettingsPanel
                ports={api}
                themeStore={browserThemeStore}
                activity={activityLog}
                sections={settingsSectionLinks({ vaultOpen: location !== null })}
                onClose={() => hideOverlay('settings')}
                fallbackFocus={focusFallback}
              >
                {location !== null && (
                  <ProfileSettingsCard setting={profileSetting} emails={selfEmailsSetting} />
                )}
                {location === null ? (
                  <IndexSettings index={null} app={app} onRebuild={() => void rebuild()} />
                ) : (
                  <LiveIndexSettings
                    index={indexStatus}
                    progress={indexProgress}
                    app={app}
                    onRebuild={() => void rebuild()}
                  />
                )}
                <ImageSettingsPanel store={browserImagePlacementStore} />
                <GlobalCaptureSettings
                  view={globalCapture.status}
                  onChange={globalCapture.change}
                />
                {location !== null && (
                  <QuickAddSettingsCard setting={quickAddSetting} types={types} />
                )}
                {location !== null && <SecretsSettingsCard setting={secrets} />}
                {location !== null && (
                  <GoogleCalendarSettingsCard setting={googleCalendarSetting} />
                )}
                {location !== null && <GranolaSettingsCard setting={granolaSetting} />}
                <ClaudeSettingsCard chat={chat} />
                {location !== null && <SyncSettingsCard sync={sync} vaultName={location.name} />}
              </SettingsPanel>
            ) : overlay === 'move-picker' && entries.picker !== null ? (
              <MovePicker
                subject={entries.picker.subject}
                destinations={entries.picker.destinations}
                onPick={entries.picker.pick}
                onClose={entries.picker.close}
                fallbackFocus={focusFallback}
              />
            ) : overlay === 'delete-dialog' && entries.question !== null ? (
              <DeleteDialog
                subject={entries.question.subject}
                onConfirm={entries.question.confirm}
                onClose={entries.question.close}
                fallbackFocus={focusFallback}
              />
            ) : overlay === 'template-delete' && templatesPage.question !== null ? (
              <DeleteDialog
                subject={{
                  name: templatesPage.question.name,
                  kind: 'note',
                  notes: 0,
                  otherFiles: null,
                  unsaved: templatesPage.question.unsaved ? [templatesPage.question.name] : [],
                  consequence: lostUsesText(templatesPage.question.lost),
                }}
                onConfirm={templatesPage.question.confirm}
                onClose={templatesPage.question.close}
                fallbackFocus={focusFallback}
              />
            ) : overlay === 'template-to-note' && templatesPage.question !== null ? (
              <TemplateToNoteDialog
                name={templatesPage.question.name}
                consequence={lostUsesText(templatesPage.question.lost)}
                unsaved={templatesPage.question.unsaved}
                onConfirm={templatesPage.question.confirm}
                onClose={templatesPage.question.close}
                fallbackFocus={focusFallback}
              />
            ) : overlay === 'open-from-github' ? (
              <OpenFromGitHubDialog
                busy={fromGitHub.busy}
                problem={fromGitHub.problem}
                onOpen={fromGitHub.open}
                onClose={() => {
                  fromGitHub.reset();
                  hideOverlay('open-from-github');
                }}
                fallbackFocus={focusFallback}
              />
            ) : overlay === 'new-type' ? (
              <NewTypeDialog
                icons={TYPE_ICONS}
                error={newType.error}
                onCreate={newType.create}
                onClose={() => hideOverlay('new-type')}
                fallbackFocus={focusFallback}
              />
            ) : overlay === 'new-view' ? (
              <NewViewDialog
                request={newView.request}
                types={newView.typeChoices}
                layouts={newView.layoutChoices}
                problems={newView.problems}
                onChange={newView.change}
                onCreate={newView.create}
                onClose={() => hideOverlay('new-view')}
                fallbackFocus={focusFallback}
              />
            ) : overlay === 'new-artifact' ? (
              <NewArtifactDialog
                draft={newArtifact.draft}
                kinds={ARTIFACT_KIND_CHOICES}
                projects={newArtifact.projects}
                error={newArtifact.error}
                saving={newArtifact.saving}
                onChange={newArtifact.change}
                onCreate={() => void newArtifact.create()}
                onClose={() => hideOverlay('new-artifact')}
                fallbackFocus={focusFallback}
              />
            ) : overlay === 'capture' ? (
              <CapturePalette
                destination={
                  captureTemplate === null ? 'a blank note' : `a ${captureTemplate.name}`
                }
                onCapture={(name) => void captureTask(name)}
                onClose={() => hideOverlay('capture')}
                fallbackFocus={focusFallback}
              />
            ) : (
              <SearchPaletteSlot
                store={overlays}
                workspace={workspace}
                index={index.index}
                commandsFor={paletteCommandsFor}
                offerFor={paletteOffersFor}
                changeKey={indexKey}
                onCommand={runPaletteCommand}
                onPick={openPaletteHit}
                fallbackFocus={focusFallback}
              />
            )
          }
        />
      </ChatToggleProvider>
    </NoteNamesProvider>
  );
}

/**
 * Pictures in a proposed change are drawn as their alt text: the chat shows
 * what would change, and a picture's bytes are the note's to load, not the
 * chat's.
 */
const noImages = async (): Promise<string | null> => null;
