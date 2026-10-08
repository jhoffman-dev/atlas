import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  activeNotePaths,
  activeSidebarPage,
  createVaultPath,
  canClosePane,
  canSplit,
  favoriteValue,
  rankNoteSuggestions,
  linkFragment,
  resolveWikiLinkTarget,
  sidebarTreeRows,
  vaultInitial,
  FAVORITE_KEY,
  hasFullName,
  NAME_PLACEHOLDER,
  moveRefusal,
  noteNames,
  noteTitle,
  tagKey,
  ARTIFACT_KINDS,
  ARTIFACT_TYPE,
  claudeArtifactUrl,
  pastedArtifactCommands,
  SAVE_ARTIFACT_LINK,
  TYPE_ICONS,
  VAULT_ROOT,
  type EntryMove,
  type NavigationPlace,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import {
  createNoteChanges,
  createRefreshSpacing,
  createSourceRefresher,
  createTagRenames,
  findTaskTemplate,
  getAppInfo,
  setNoteProperty,
  viewSpecsFor,
  type ActivityStore,
  type WindowClosingPort,
  type ApiRouterDeps,
  type AppInfoPort,
  type ExternalLinkPort,
  type PageSnapshotPort,
} from '@atlas/application';
import {
  AppShell,
  ChatToggleProvider,
  SearchPalette,
  CapturePalette,
  DeleteDialog,
  lostUsesText,
  TemplateToNoteDialog,
  MovePicker,
  PaneFrame,
  Sidebar,
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
  type AppInfoState,
} from '@atlas/ui';
import { useVault, type VaultPorts } from './vault/use-vault.ts';
import { boundToVault, type OnHost } from './vault/bound-to-vault.ts';
import type { NotePorts } from './notes/use-note.ts';
import { useIndex, type IndexPorts } from './index/use-index.ts';
import { useVaultWatch } from './vault/use-vault-watch.ts';
import { useSearch } from './index/use-search.ts';
import { useCreateNote } from './notes/use-create-note.ts';
import { useTypes } from './types/use-types.ts';
import { useTypeRoute } from './types/use-type-route.ts';
import { useSidebarCatalog } from './sidebar/use-sidebar-catalog.ts';
import { browserSectionStore } from './sidebar/browser-section-store.ts';
import { createBrowserGroupFoldStore } from './query/browser-group-fold-store.ts';
import { useTemplates } from './types/use-templates.ts';
import { useOpenEditors } from './panes/open-editors.ts';
import { useStrandedEdits } from './notes/stranded-edits.ts';
import { browserStrandedStore } from './notes/browser-stranded-store.ts';
import { paneKey, usePanes } from './panes/use-panes.ts';
import { useFocusAfterArrange } from './panes/use-focus-after-arrange.ts';
import { useReveals } from './panes/use-reveals.ts';
import { useNavigation } from './panes/use-navigation.ts';
import { placeName } from './panes/place-name.ts';
import { browserPaneStore } from './panes/browser-pane-store.ts';
import { NotePaneContainer, type PaneContext } from './panes/note-pane-container.tsx';
import { browserThemeStore } from './theme/browser-theme-store.ts';
import { useVaultGraph } from './graph/use-vault-graph.ts';

import { localClock, localToday } from './today.ts';
import {
  closeOverlay,
  openOverlay,
  pageMenuOverlay,
  panePopupOverlay,
  type Overlay,
} from './overlay.ts';
import { movingEditorsIn, openNotesIn } from './panes/open-notes.ts';
import { useVaultEntries, type VaultEntryPorts } from './vault/use-vault-entries.ts';
import { useLocalApi, type LocalApiPorts } from './api/use-local-api.ts';
import { useApiHost } from './api/use-api-host.ts';
import { createAutomationRelay } from './api/automation-relay.ts';
import { createMoveRelay } from './api/move-relay.ts';
import { SettingsPanel } from './settings/settings-panel.tsx';
import { ImageSettingsPanel } from './settings/image-settings-panel.tsx';
import { browserImagePlacementStore } from './notes/browser-image-placement-store.ts';
import { useTickMemory } from './query/tick-memory.ts';
import { useViewDrafts } from './query/use-view-drafts.ts';
import { useNewView } from './query/use-new-view.ts';
import { createBrowserTypeTabStore } from './types/browser-type-tab-store.ts';
import { typeTabsShown } from './types/type-tabs.ts';
import { useTypeViews } from './types/use-type-views.ts';
import { paletteEditTypeOffers, runPaletteEditTypeCommand } from './types/palette-edit-type.ts';
import { useTemplatesPage } from './templates/use-templates-page.ts';
import { useNewArtifact } from './artifacts/use-new-artifact.ts';
import { useThumbnailQueue, useThumbnailsNow } from './artifacts/use-thumbnails.ts';
import { useQueryPage } from './query/use-query-page.ts';
import { mainRoute } from './main-route.tsx';
import { AppNotices } from './app-notices.tsx';
import { browserActivitySeenStore } from './activity/browser-activity-seen-store.ts';
import { useActivity } from './activity/use-activity.ts';
import { useActivityLog, useNoticeActivity } from './activity/use-activity-log.ts';
import { usePeople } from './people/use-people.ts';
import { useAppShortcuts } from './app-shortcuts.ts';
import { useMainView } from './main-view.ts';
import { browserFabStore } from './quick-add/browser-fab-store.ts';
import { QuickAdd } from './quick-add/quick-add.tsx';
import { QuickAddSettingsCard } from './quick-add/quick-add-settings-card.tsx';
import type { SourcePorts } from './sources/source-ports.ts';
import { SecretsSettingsCard } from './settings/secrets-settings-card.tsx';
import { useSecrets } from './settings/use-secrets.ts';
import { useQuickAdd } from './quick-add/use-quick-add.ts';
import { useQuickAddSetting } from './quick-add/use-quick-add-setting.ts';
import { useSidebarOrder } from './sidebar/use-sidebar-order.ts';
import { useVaultTags } from './tags/use-vault-tags.ts';
import { useArchive } from './archive/use-archive.ts';
import { useAutomations } from './automations/use-automations.ts';
import { archiveCommand, withCommandBeforeDelete } from './archive/archive-menu.ts';
import { paletteArchiveCommands, runPaletteArchiveCommand } from './archive/palette-archive.ts';
import { ChatPane, ClaudeSettingsCard } from './chat/chat-pane.tsx';
import { ProfileSettingsCard } from './profile/profile-settings-card.tsx';
import { useProfileSetting } from './profile/use-profile-setting.ts';
import { browserChatSettingsStore } from './chat/chat-settings-store.ts';
import { chatWindowOf } from './chat/chat-window.ts';
import { useChat, type ChatPorts } from './chat/use-chat.ts';
import { closingInStages } from './activity/closing-stages.ts';
import { useSync, type SyncHostPorts } from './sync/use-sync.ts';
import { useOpenFromGitHub } from './sync/use-open-from-github.ts';
import { SyncSettingsCard } from './sync/sync-settings-card.tsx';
import { syncConflictNotice, syncIndicatorBadge } from './sync/sync-view.ts';
import { browserClipboard } from './settings/clipboard.ts';

const OPEN_TEMPLATES = 'open-templates';

/** What the search palette can do besides find notes. */
const PALETTE_COMMANDS = [
  { id: 'new-query', label: 'New query', keywords: ['sql'] },
  { id: 'new-view', label: 'New view' },
  { id: 'new-artifact', label: 'New artifact', keywords: ['claude', 'save', 'link', 'html'] },
  { id: OPEN_TEMPLATES, label: 'Templates', keywords: ['template', 'edit templates'] },
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

export function App({
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
}) {
  const [app, setApp] = useState<AppInfoState>({ kind: 'loading' });
  // The last sync runs before the Activity log's final write, so its line is kept.
  const closing = useMemo(() => closingInStages(activityPorts.closing), [activityPorts.closing]);
  const editors = useOpenEditors();
  // Set once the sync hook below exists: a switch waits for a sync under way,
  // whose remaining steps would otherwise be refused half-done (U-29).
  const settleSync = useRef<() => Promise<void>>(() => Promise.resolve());
  const leaveVault = useCallback(async () => {
    await editors.flushAll();
    await settleSync.current();
  }, [editors]);
  // Every pane's unsaved work is written before the host moves to another vault,
  // while its paths still mean the vault it was typed in.
  // Choosing and listing a vault come before there is one to bind writes to,
  // and need none: useVault is handed no way to write.
  const choosing = useMemo(() => boundToVault(vaultPorts, null), [vaultPorts]);
  const {
    location,
    rows,
    notePaths,
    error,
    chooseVault,
    showVault,
    toggleDirectory,
    expandDirectory,
    forgetDirectory,
    isExpanded,
    reload,
  } = useVault(choosing, { beforeSwitch: leaveVault });
  const vaultKey = location?.absolutePath ?? null;
  const tickMemory = useTickMemory(vaultKey);
  const [groupFolds] = useState(createBrowserGroupFoldStore);
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
  const vault = useMemo(() => boundToVault(vaultPorts, vaultKey), [vaultPorts, vaultKey]);
  const notes = useMemo(() => boundToVault(notePorts, vaultKey), [notePorts, vaultKey]);
  const index = useMemo(() => boundToVault(indexPorts, vaultKey), [indexPorts, vaultKey]);
  const panes = usePanes({ store: browserPaneStore, vaultKey: location?.absolutePath ?? null });
  const { openInFocusedPane, openInPane, openBeside, followMove, closeNotes, toggleSplit } = panes;
  useFocusAfterArrange(panes.layout.paths.length);
  /** The note the person is working in, which is where the next open lands. */
  const focusedPath = panes.layout.paths[panes.layout.focused] ?? null;
  const {
    status: indexStatus,
    rebuild,
    refresh,
  } = useIndex({
    ports: index,
    vaultKey: location?.absolutePath ?? null,
    activity: activityLog,
    changes: noteChanges,
  });

  // Anything that edits the vault from outside — Obsidian, a sync client — should
  // show up here without a restart.
  useVaultWatch({
    watch: vault.watch,
    vaultKey: location?.absolutePath ?? null,
    onChange: () => {
      void reload();
      void refresh();
    },
  });
  // Everything derived from the index re-runs when this changes: backlinks,
  // saved views and dashboard widgets.
  const indexKey =
    indexStatus.kind === 'ready' ? `ready:${indexStatus.revision}` : indexStatus.kind;
  const { types, reload: reloadTypes } = useTypes({
    fs: vault.fs,
    markdown: notes.markdown,
    vaultKey: location?.absolutePath ?? null,
    changeKey: indexKey,
  });

  /** Re-reads the tree and the index, after something wrote to the vault. */
  const onChanged = useCallback(() => {
    void reload();
    void refresh();
  }, [reload, refresh]);

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
  const apiHost = useApiHost({ vault: location, indexReady: indexStatus.kind === 'ready' });
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
      automationClock: apiAutomations.clock,
      activity: activityLog,
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
    ],
  );
  // A write from another tool shows up the way one made here does.
  useLocalApi({ bridge: api.bridge, deps: apiDeps, onWrote: onChanged });

  // The SQL view behind each type is rebuilt whenever the definitions change, so
  // adding a property to a type makes a column appear.
  useEffect(() => {
    if (types.length === 0) return;
    void index.index.rebuildViews(viewSpecsFor(types)).catch(() => {
      // A view that cannot be built shows as a failing query rather than here.
    });
  }, [index.index, types]);

  const paletteCommands = useMemo(
    () => [...PALETTE_COMMANDS, ...paletteArchiveCommands(focusedPath)],
    [focusedPath],
  );
  const paletteOffersFor = useCallback(
    (query: string) => [...paletteOffers(query), ...paletteEditTypeOffers(types, query)],
    [types],
  );
  const search = useSearch({
    index: index.index,
    commands: paletteCommands,
    offerFor: paletteOffersFor,
  });
  // One overlay at a time; the rule is `openOverlay` and `closeOverlay`.
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const showOverlay = useCallback(
    (requested: Overlay) => setOverlay((current) => openOverlay(current, requested)),
    [],
  );
  const hideOverlay = useCallback(
    (closing: Overlay) => setOverlay((current) => closeOverlay(current, closing)),
    [],
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [favoriteError, setFavoriteError] = useState<string | null>(null);

  const { catalog, sidebarTypes, quick } = useSidebarCatalog({
    fs: vault.fs,
    markdown: notes.markdown,
    index: index.index,
    types,
    vaultKey: location?.absolutePath ?? null,
    changeKey: indexKey,
  });

  /** The page open over the panes, if any: a type's, the graph, or the query page. */
  const main = useMainView();
  const {
    openTypeName,
    typeMode,
    graphScope,
    queryOpen,
    tagsTag,
    archiveOpen,
    automationsOpen,
    activityOpen,
    templatesOpen,
  } = main;
  const activity = useActivity({
    log: activityLog,
    vaultKey,
    open: activityOpen,
    seen: browserActivitySeenStore,
    clock: localClock,
  });
  const { showPanes, openType, openGraph, openQuery, openTags, openArchive } = main;
  const vaultGraph = useVaultGraph({
    index: index.index,
    indexKey,
    ready: indexStatus.kind === 'ready',
  });
  const vaultTags = useVaultTags({
    index: index.index,
    indexKey,
    ready: indexStatus.kind === 'ready',
  });
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
  const navigation = useNavigation({
    panes,
    mainView: main.view,
    open: main,
    nameOf: nameOfPlace,
  });

  /** Opens a note from outside the panes: the sidebar, search, a new note. */
  const openNote = useCallback(
    (path: VaultPath) => {
      showPanes();
      openInFocusedPane(path);
    },
    [showPanes, openInFocusedPane],
  );

  const viewDrafts = useViewDrafts(vaultKey);
  // Every path a new view's name is checked against: the views folder's files, lifted views included.
  const viewPaths = catalog.takenViewPaths;

  const stranded = useStrandedEdits({
    store: browserStrandedStore,
    vaultKey: location?.absolutePath ?? null,
    now: Date.now,
  });

  const typeRoute = useTypeRoute({
    ports: { fs: vault.fs, markdown: notes.markdown, index: index.index, editors },
    types,
    typeName: openTypeName,
    indexKey,
    notePaths,
    onChanged,
    reloadTypes,
    onTypeCreated: (created) => {
      hideOverlay('new-type');
      openType(created.name, 'edit');
    },
    onNoteCreated: openNote,
  });
  const { table: typeTable, onTypeSaved, newType, newNoteOfType } = typeRoute;

  const newView = useNewView({
    fs: vault.fs,
    markdown: notes.markdown,
    types,
    viewPaths,
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

  const query = useQueryPage({
    ports: { index: index.index, fs: vault.fs, markdown: notes.markdown, editors },
    open: queryOpen,
    indexKey,
    viewPaths,
    dashboards: catalog.dashboards,
    onSavedView: openNote,
    onChanged,
    types,
    notePaths,
    onOpenNote: (path) => openNote(createVaultPath(path)),
  });

  const profileSetting = useProfileSetting({
    fs: vault.fs,
    markdown: notes.markdown,
    vaultKey,
    changeKey: indexKey,
  });
  const chat = useChat({
    ports: chatPorts,
    store: browserChatSettingsStore,
    vault: {
      api: apiDeps,
      fs: location === null ? null : vault.fs,
      markdown: notes.markdown,
      openNotes: openNotesIn(editors),
      notePaths,
      vaultKey,
      onChanged,
    },
    window: chatWindowOf({
      query: queryOpen ? (query.language === 'atlas' ? query.atlas.composer.text : '') : null,
      otherPage:
        openTypeName !== null || graphScope !== null || tagsTag !== undefined || archiveOpen,
      focused: focusedPath,
    }),
    clipboard: browserClipboard,
    settingsOpen: overlay === 'settings',
    activity: activityLog,
    profile: profileSetting.profile,
  });

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
          }).then(() => reload());
        })
        .then(() => void refresh())
        .catch((cause: unknown) =>
          setFavoriteError(cause instanceof Error ? cause.message : String(cause)),
        );
    },
    [favoritePaths, editors, vault.fs, notes.markdown, reload, refresh],
  );

  const { templates, contentsOf } = useTemplates({
    fs: vault.fs,
    vaultKey: location?.absolutePath ?? null,
    changeKey: indexKey,
  });

  const {
    createNewNote,
    createNoteIn,
    createFromTemplate,
    createNamedNote,
    openDailyNote: openOrMakeDailyNote,
    error: createError,
  } = useCreateNote({
    fs: vault.fs,
    markdown: notes.markdown,
    notePaths,
    beside: focusedPath,
    templates,
    contentsOf,
    onCreated: (path) => {
      void reload();
      openNote(path);
      void refresh();
    },
  });

  // A note or folder moved in the app takes with it the panes showing it, the
  // unsaved edits of a view under it, and what its ticks remembered.
  const followEntryMove = useCallback(
    (move: EntryMove) => {
      followMove(move);
      viewDrafts.follow(move);
      tickMemory.follow(move);
    },
    [followMove, viewDrafts, tickMemory],
  );
  useEffect(() => apiMoves.point(followEntryMove), [apiMoves, followEntryMove]);

  // A deleted note takes with it the panes showing it and, for a view, its
  // unsaved edits — or a new view made under its name would wear them.
  const closeDeleted = useCallback(
    (gone: readonly VaultPath[]) => {
      closeNotes(gone);
      viewDrafts.forget(gone);
    },
    [closeNotes, viewDrafts],
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
    vaultKey,
    changeKey: indexKey,
    onChanged,
    onOpen: openNote,
  });
  const { editTypeTemplate, askDelete: askDeleteTemplate, askMoveToNotes } = templatesPage;
  const onRenameTemplate = templatesPage.page.onRename;
  const templateCommands = useMemo(
    () => ({
      onOpenTemplates: main.openTemplates,
      rename: onRenameTemplate,
      askDelete: askDeleteTemplate,
      askMoveToNotes,
    }),
    [main.openTemplates, onRenameTemplate, askDeleteTemplate, askMoveToNotes],
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
  useEffect(() => {
    if (focusedPath !== null) rememberTypeTab(focusedPath);
  }, [focusedPath, rememberTypeTab]);

  const archivePorts = useMemo(
    () => ({ ...entryPorts, markdown: notes.markdown }),
    [entryPorts, notes.markdown],
  );
  const settleArchive = useCallback(() => {
    void refresh();
    void reload();
  }, [refresh, reload]);
  const archive = useArchive({
    ports: archivePorts,
    clock: localClock,
    notePaths,
    indexKey,
    open: archiveOpen,
    onSettled: settleArchive,
    offerLinks: entries.offerLinks,
  });
  const archiveCommands = archive.commands;
  const automationPorts = useMemo(
    () => ({ ...archivePorts, types, notePaths }),
    [archivePorts, types, notePaths],
  );
  const automations = useAutomations({
    ports: automationPorts,
    clock: localClock,
    vaultKey,
    indexKey,
    indexReady: indexStatus.kind === 'ready',
    activity: activityLog,
    onSettled: settleArchive,
    live: automationsOpen,
    // A synced vault runs its automations on one Mac only (U-29).
    scheduled: sync.automationsHere,
    // A rule a note sets off hears of it here (P29-01).
    changes: noteChanges,
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
    changeKey: indexKey,
  });
  const sidebarOrder = useSidebarOrder({
    fs: vault.fs,
    markdown: notes.markdown,
    vaultKey,
    changeKey: indexKey,
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
    beside: focusedPath,
    overlay: { show: showOverlay, hide: hideOverlay },
    onCreated: ({ path, open }) => {
      onChanged();
      if (open) openNote(path);
    },
  });

  const captureTask = useCallback(
    async (name: string) => {
      const path = await createNamedNote(name, captureTemplate);
      if (path !== null) openNote(path);
    },
    [createNamedNote, captureTemplate, openNote],
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
    ready: indexStatus.kind === 'ready',
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

  /**
   * Follows a wiki link in the pane it was clicked in, never the other one.
   *
   * This is the rule the card is about: a link opens where you are reading, so
   * the note beside it is still there to be read against.
   */
  const reveals = useReveals();
  const followLinkInPane = useCallback(
    ({
      pane,
      target,
      heading = null,
    }: {
      pane: number;
      target: string;
      heading?: string | null;
    }) => {
      // `[[Note#^id]]` and `[[Note#Heading]]` open the note there (P26-03);
      // `[[#^id]]`, naming no note, is a place in the note it is in.
      const fragment = heading === null ? null : linkFragment({ heading });
      const here = panes.layout.paths[pane] ?? null;
      const resolved =
        target.trim() === '' && fragment !== null ? here : resolveWikiLinkTarget(target, notePaths);
      if (resolved === null) {
        setLinkError(`No note called "${target}"`);
        return;
      }
      setLinkError(null);
      showPanes();
      openInPane({ pane, path: resolved });
      if (fragment !== null) reveals.request({ pane, path: resolved, fragment });
    },
    [notePaths, openInPane, showPanes, panes.layout.paths, reveals],
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
    overlay,
    // The editors are registered under the panes' keys, not their places.
    save: () => editors.savePane(paneKey(panes.keys, 0)),
    newNote: () => void createNewNote(),
    toggleSidebar: () => setSidebarOpen((was) => !was),
    toggleSplit,
    dailyNote: () => void openDailyNote(),
    quickAdd: quickAdd.start,
    back: navigation.back,
    forward: navigation.forward,
    show: showOverlay,
    toggleChat: chat.toggle,
  });

  const treeRows = useMemo(() => sidebarTreeRows(rows), [rows]);
  const toggleSidebar = useCallback(() => setSidebarOpen((was) => !was), []);

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
    linkError,
    vaultPeople.error,
    createError,
    entries.notice,
    archive.notice,
    favoriteError,
    typeViews.error,
    newNoteOfType.error,
    templatesPage.notice,
    sidebarOrder.problem === null
      ? null
      : `The sidebar's order could not be saved: ${sidebarOrder.problem}`,
    sidebarOrder.unreadable,
  ];
  const indexFailure =
    location !== null && indexStatus.kind === 'failed' ? indexStatus.message : null;
  // A red notice is where a use case gave up, so it is kept in the Activity log
  // once each time it appears. The index's failure is not: syncIndex records
  // it. Nor is the offer to update links, which is a question, not a failure;
  // edits kept for later are a warning.
  useNoticeActivity({ errors: noticeMessages, warnings: [stranded.notice] }, activityLog);
  const notices = (
    <AppNotices
      messages={[...noticeMessages, indexFailure, syncConflictNotice(sync.phase)]}
      links={entries.links}
      stranded={stranded}
    />
  );

  return (
    <NoteNamesProvider value={names}>
      <ChatToggleProvider
        value={location === null ? null : { open: chat.open, onToggle: chat.toggle }}
      >
        <AppShell
          sidebarOpen={sidebarOpen}
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
                  <Sidebar
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
                    active={activeSidebarPage({
                      layout: panes.layout,
                      openTypeName,
                      graphOpen: graphScope !== null,
                      tagsOpen: tagsTag !== undefined,
                      archiveOpen,
                      automationsOpen,
                      activityOpen,
                      templatesOpen,
                      viewOwner: typeViews.ownerOf,
                    })}
                    sectionStore={browserSectionStore}
                    sectionOrder={sidebarOrder.order}
                    onSearch={() => showOverlay('search')}
                    onOpenGraph={() => openGraph({ kind: 'vault' })}
                    onOpenTags={() => openTags(null)}
                    onOpenAutomations={main.openAutomations}
                    activity={{
                      onOpen: main.openActivity,
                      unseenErrors: activity.unseenErrors,
                    }}
                    onOpen={openNote}
                    onOpenTemplates={main.openTemplates}
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
          notices={notices}
          main={
            location === null ? (
              <VaultEmptyState
                onChooseVault={chooseVault}
                onOpenFromGitHub={() => showOverlay('open-from-github')}
              />
            ) : (
              mainRoute({
                graph: {
                  state: vaultGraph,
                  scope: graphScope,
                  types,
                  onScopeChange: openGraph,
                  onOpen: (path, { split }) => {
                    showPanes();
                    if (split) openBeside(path);
                    else openInFocusedPane(path);
                  },
                },
                type: {
                  table: typeTable,
                  types,
                  mode: typeMode,
                  onModeChange: (mode) =>
                    mode === 'notes' && openTypeName !== null
                      ? openTypePage(openTypeName)
                      : main.setTypeMode(mode),
                  ports: {
                    fs: vault.fs,
                    markdown: notes.markdown,
                    index: index.index,
                    openNotes: editors,
                  },
                  onSaved: onTypeSaved,
                  onOpenNote: openNote,
                  // An artifact is saved from its link or its page, not made blank.
                  onNewNote: (type) =>
                    type.name === ARTIFACT_TYPE ? startNewArtifact() : newNoteOfType.create(type),
                  tabs: typeTable.type === null ? [] : typeTabsShown(catalog, typeTable.type),
                  tabEditing:
                    openTypeName === null
                      ? undefined
                      : typeViews.editingFor({ typeName: openTypeName, onOpenView: openNote }),
                  onOpenView: openNote,
                  onDelete: (path) => entries.askDelete({ path, kind: 'file' }),
                  onEditTemplate: (type) => editTypeTemplate(type.name),
                },
                query: {
                  open: queryOpen,
                  screen: {
                    query,
                    onOpenNote: openNote,
                    popups: (name) => ({
                      open: overlay === `query-${name}`,
                      onOpenChange: (open) =>
                        open ? showOverlay(`query-${name}`) : hideOverlay(`query-${name}`),
                    }),
                  },
                },
                tags: {
                  selected: tagsTag,
                  screen: {
                    ports: {
                      index: index.index,
                      fs: vault.fs,
                      markdown: notes.markdown,
                      editors: entryPorts.editors,
                      renames: tagRenames.forVault(location.absolutePath),
                    },
                    tags: vaultTags.state,
                    indexKey,
                    onChanged,
                    onSelect: openTags,
                    onOpenNote: openNote,
                  },
                },
                archive: {
                  open: archiveOpen,
                  page: {
                    contents: archive.page.contents,
                    error: archive.page.error,
                    search: archive.page.search,
                    onSearch: archive.page.setSearch,
                    selection: archive.page.choosing.selection,
                    onClearSelection: archive.page.choosing.clear,
                    onOpen: openNote,
                    onUnarchive: archive.page.unarchive,
                    busy: archiveCommands.busy,
                  },
                },
                automations: {
                  open: automationsOpen,
                  screen: {
                    automations,
                    ports: automationPorts,
                    clock: localClock,
                    indexKey,
                    activity: activityLog,
                    onOpenNote: openNote,
                  },
                },
                activity: {
                  open: activityOpen,
                  screen: {
                    activity,
                    clock: localClock,
                    onOpenSubject: (subject) =>
                      subject.kind === 'rule' ? main.openAutomations() : openNote(subject.path),
                  },
                },
                templates: { open: templatesOpen, page: templatesPage.page },
                ...(!sidebarOpen && { onShowSidebar: toggleSidebar }),
                history: navigation.historyFor(panes.layout.focused),
              })
            )
          }
          panes={
            location === null
              ? []
              : panes.layout.paths.map((path, pane) => (
                  <PaneFrame
                    key={paneKey(panes.keys, pane)}
                    label={`Pane ${pane + 1}`}
                    focused={pane === panes.layout.focused}
                    onFocus={() => panes.focus(pane)}
                  >
                    <NotePaneContainer
                      paneId={paneKey(panes.keys, pane)}
                      path={path}
                      context={paneContext}
                      onOpenNote={(target) => openInPane({ pane, path: target })}
                      onFollowLink={(target, heading) =>
                        followLinkInPane({ pane, target, heading: heading ?? null })
                      }
                      reveal={reveals.revealFor(pane, path)}
                      onRename={renamePaneNote}
                      onToggleFavorite={toggleFavorite}
                      onMoveTo={(target) => entries.askMove({ path: target, kind: 'file' })}
                      onDelete={(target) => entries.askDelete({ path: target, kind: 'file' })}
                      onShowInGraph={(target) =>
                        openGraph({ kind: 'note', path: target, depth: 1 })
                      }
                      arrangement={{
                        // Which of these a pane offers is the domain's rule; the
                        // bar draws a button and a menu item for each it is given.
                        ...(canSplit(panes.layout) && { onSplit: () => panes.split(pane) }),
                        ...(canClosePane(panes.layout) && { onClose: () => panes.close(pane) }),
                        // The shortcut closes the focused pane, so only its Close names it.
                        closesFromShortcut: pane === panes.layout.focused,
                        // The way back to a hidden sidebar sits where it went: the
                        // first pane's top-left corner.
                        ...(pane === 0 && !sidebarOpen && { onShowSidebar: toggleSidebar }),
                        history: navigation.historyFor(pane),
                        menuOpen: overlay === pageMenuOverlay(pane),
                        onMenuOpenChange: (open) =>
                          open
                            ? showOverlay(pageMenuOverlay(pane))
                            : hideOverlay(pageMenuOverlay(pane)),
                        popups: (name) => ({
                          open: overlay === panePopupOverlay(pane, name),
                          onOpenChange: (open) =>
                            open
                              ? showOverlay(panePopupOverlay(pane, name))
                              : hideOverlay(panePopupOverlay(pane, name)),
                        }),
                      }}
                    />
                  </PaneFrame>
                ))
          }
          aside={
            location !== null && chat.open ? (
              <ChatPane
                chat={chat}
                onFollowLink={(target) => followLinkInPane({ pane: panes.layout.focused, target })}
                loadImage={noImages}
                nameHint={
                  profileSetting.profile !== 'unknown' && !hasFullName(profileSetting.profile)
                    ? { placeholder: NAME_PLACEHOLDER, onSetName: () => showOverlay('settings') }
                    : null
                }
              />
            ) : null
          }
          status={location === null ? null : indexStatusText(indexStatus)}
          floating={
            location === null ? null : (
              <QuickAdd
                quickAdd={quickAdd}
                overlay={{ current: overlay, show: showOverlay, hide: hideOverlay }}
                onOpen={openNote}
              />
            )
          }
          overlay={
            overlay === 'settings' ? (
              <SettingsPanel
                ports={api}
                onClose={() => hideOverlay('settings')}
                fallbackFocus={focusFallback}
              >
                {location !== null && <ProfileSettingsCard setting={profileSetting} />}
                <IndexSettings
                  index={location === null ? null : indexStatus}
                  app={app}
                  onRebuild={() => void rebuild()}
                />
                <ImageSettingsPanel store={browserImagePlacementStore} />
                {location !== null && (
                  <QuickAddSettingsCard setting={quickAddSetting} types={types} />
                )}
                {location !== null && <SecretsSettingsCard setting={secrets} />}
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
            ) : overlay === 'search' ? (
              <SearchPalette
                query={search.query}
                commands={search.commands}
                archived={{ included: search.includeArchived, onChange: search.setIncludeArchived }}
                onCommand={(id) => {
                  const pasted = claudeArtifactUrl(search.query) ?? '';
                  hideOverlay('search');
                  search.reset();
                  if (
                    runPaletteArchiveCommand(id, {
                      focused: focusedPath,
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
                  if (id === OPEN_TEMPLATES) main.openTemplates();
                  else if (id === 'new-query') openQuery();
                  else if (id === 'new-artifact') startNewArtifact();
                  else if (id === SAVE_ARTIFACT_LINK) startNewArtifact(pasted);
                  else startNewView(null);
                }}
                hits={search.hits}
                selected={search.selected}
                onQuery={search.setQuery}
                onMove={search.move}
                onPick={(path) => {
                  openNote(createVaultPath(path));
                  hideOverlay('search');
                  search.reset();
                }}
                onClose={() => {
                  hideOverlay('search');
                  search.reset();
                }}
                fallbackFocus={focusFallback}
              />
            ) : null
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
