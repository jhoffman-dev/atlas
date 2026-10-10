import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ARTIFACT_KEYS,
  archiveRefusal,
  createVaultPath,
  isArchivedPath,
  isFavorite,
  deleteRefusal,
  isMovable,
  isTemplateNote,
  messageWithoutPaths,
  templateNameOf,
  templateUses,
  noteLinks,
  noteTitle,
  NO_LINKS,
  writeFailedReport,
  type NoteSuggestion,
  type TagSuggestion,
  type QueryViewSummary,
  type SavedViewSummary,
  type SidebarEntry,
  type VaultGraph,
  type VaultPath,
} from '@atlas/domain';
import type {
  ActivityLog,
  DefinedType,
  ExternalLinkPort,
  IndexPort,
  OpenNotes,
  SourceRefresher,
  ThumbnailQueue,
  VaultFsPort,
} from '@atlas/application';
import {
  ThumbnailValue,
  ArtifactViewer,
  CustomizeToggle,
  DashboardView,
  NotePane,
  WidgetEditor,
  SourcePanel,
  useCalendarNav,
  type CalendarNavigation,
  type GroupFolds,
  type GroupFoldStore,
  type NotePeople,
  type NoteReveal,
  type PaneArrangement,
  type TemplateNotice,
  type ViewTabEditing,
} from '@atlas/ui';
import { useNote, type NotePorts } from '../notes/use-note.ts';
import { useUnlinkedMentions } from '../graph/use-unlinked-mentions.ts';
import { useImages } from '../notes/use-images.ts';
import { useBookmarks } from '../notes/use-bookmarks.ts';
import { useEmbedImage } from '../notes/use-embed-image.ts';
import { useBlockPicking, useTransclusions } from '../notes/use-block-links.ts';
import { cryptoRng } from '../random.ts';
import { webviewImageProbe } from '../notes/webview-image-probe.ts';
import { browserImagePlacementStore } from '../notes/browser-image-placement-store.ts';
import { useNoteProperties } from '../types/use-note-properties.ts';
import { useAddProperty } from '../types/use-add-property.ts';
import { useCreateRelated } from '../types/use-create-related.ts';
import type { TabLanding } from '../types/use-type-views.ts';
import { useDashboard } from '../dashboard/use-dashboard.ts';
import { useDashboardEditing } from '../dashboard/use-dashboard-editing.ts';
import { useSavedView } from '../query/use-saved-view.ts';
import type { ViewDrafts } from '../query/use-view-drafts.ts';
import { useSource } from '../sources/use-source.ts';
import type { SourcePorts } from '../sources/source-ports.ts';
import { useArtifactCopy, type ArtifactCopyView } from '../artifacts/use-artifact-copy.ts';
import { useThumbnailBackfill } from '../artifacts/use-thumbnail-backfill.ts';
import { usePageThumbnail, type PageThumbnailView } from '../thumbnails/use-page-thumbnail.ts';
import { SqlViewBody, ViewBody, ViewHeadToolbar } from './view-body.tsx';
import { useSqlView } from '../query/use-sql-view.ts';
import { useQueryView, type QueryViewState } from '../query/use-query-view.ts';
import { QueryViewBody } from './query-view-body.tsx';
import { useQueryBlocks } from '../query/use-query-blocks.ts';
import { pageHeading } from './page-heading.ts';
import { localClock, localNow, localToday } from '../today.ts';
import type { OpenEditors } from './open-editors.ts';
import type { StrandedEdits } from '../notes/stranded-edits.ts';
import type { ArchiveCommands } from '../archive/use-archive.ts';
import { useViewChoosing, type ViewChoosing } from '../archive/use-view-choosing.ts';
import type { TickMemory } from '../query/tick-memory.ts';
import { useGroupFolds } from '../query/use-group-folds.ts';

/**
 * Everything a pane needs that is the same in every pane.
 *
 * The ports and the vault-wide facts are shared; what makes one pane different
 * from another is only the note it holds.
 */
export interface PaneContext {
  /** The vault the panes' notes are in, which their unsaved work belongs to. */
  readonly vault: string | null;
  readonly notes: NotePorts;
  readonly index: IndexPort;
  readonly sources: SourcePorts;
  /** The window's one source refresher, which the local API shares. */
  readonly sourceRefresher: SourceRefresher;
  /** Opens an artifact's link in the browser. */
  readonly links: ExternalLinkPort;
  /** Opens New artifact, where a view of artifacts would make a blank note. */
  readonly newArtifact: () => void;
  /** Artifact thumbnails being made, which the gallery and the note both show. */
  readonly thumbnails: ThumbnailQueue;
  readonly types: readonly DefinedType[];
  readonly notePaths: readonly VaultPath[];
  /** Changes when the index does, so views and widgets refresh. */
  readonly indexKey: string;
  /** Re-reads the tree and the index, after this pane wrote something. */
  readonly onChanged: () => void;
  /** Re-reads the types as well, after this pane wrote a type file. */
  readonly onTypeSaved: () => void;
  readonly suggestNotes: (query: string) => NoteSuggestion[];
  /** Tags offered after `#`. */
  readonly suggestTags: (query: string) => readonly TagSuggestion[];
  /** Who `@` offers, and which links draw as a person's chip. */
  readonly people: NotePeople;
  /** Opens the tags page on a tag, by its name as written. */
  readonly openTag: (name: string) => void;
  readonly editors: OpenEditors;
  /** Work a closed pane could not write, kept until its note is opened again. */
  readonly stranded: StrandedEdits;
  /** Where a save the pane gave up on is said (U-28). */
  readonly activity: ActivityLog;
  /** Every saved view and the type it lists, for a view's tabs. */
  readonly savedViews: readonly SavedViewSummary[];
  /** What a type's tabs can do, opening what they make where they are (ADR-0023). */
  readonly typeTabs: (landing: TabLanding) => ViewTabEditing | undefined;
  /** Every saved Atlas query, for a query view's tabs (ADR-0019). */
  readonly queryViews: readonly QueryViewSummary[];
  /** Every dashboard, which a query view can be added to. */
  readonly dashboards: readonly SidebarEntry[];
  /** What ticked notes' statuses were, shared by every pane for the session. */
  readonly tickMemory: TickMemory;
  /** Which groups of each view are folded shut, remembered on this Mac. */
  readonly groupFolds: GroupFoldStore;
  /** Every note and connection, which each note's links are read from; null until read. */
  readonly graph: VaultGraph | null;
  /** The panes as a write from outside them reaches them — linking a mention. */
  readonly openNotes: OpenNotes;
  /** Every view note's path, SQL views included, so a new view's name is checked against them. */
  readonly viewPaths: readonly string[];
  /** Every view's unsaved toolbar changes, kept while the app is open. */
  readonly viewDrafts: ViewDrafts;
  /** Puts notes in the Archive and takes them out: a page's menu, a view's chosen rows. */
  readonly archive: ArchiveCommands;
  /** Tells the person a link could not be made or followed, and why. */
  readonly onLinkProblem: (message: string) => void;
  /** A template's own ways to be renamed, deleted and made a note, and the page listing them all (ADR-0026). */
  readonly templateCommands: TemplateCommands;
}

/** What a pane showing a template does instead of what it does to a note. */
export interface TemplateCommands {
  readonly onOpenTemplates: () => void;
  readonly rename: (args: { path: VaultPath; name: string }) => void;
  readonly askDelete: (path: VaultPath) => void;
  readonly askMoveToNotes: (path: VaultPath) => void;
}

/**
 * One pane: a note, and everything derived from it.
 *
 * Every hook here answers a question about *this* pane's note, which is why
 * they live together in a component rather than in the app around it — two
 * panes are two of these, and nothing else has to know that.
 */
export function NotePaneContainer({
  paneId,
  path,
  context,
  onOpenNote,
  onFollowLink,
  reveal = null,
  onRename,
  onToggleFavorite,
  onMoveTo,
  onDelete,
  onShowInGraph,
  arrangement,
}: {
  paneId: number;
  path: VaultPath | null;
  context: PaneContext;
  /** Opens a note in this pane — a backlink, a table row, a board card. */
  onOpenNote: (path: VaultPath) => void;
  /** Opens the note a link names, at the heading or block it names when it does. */
  onFollowLink: (target: string, heading?: string | null) => void;
  /** A block or heading of this pane's note to bring into view: where a followed link pointed. */
  reveal?: NoteReveal | null;
  onRename: (args: { path: VaultPath; name: string }) => void;
  onToggleFavorite: (path: VaultPath) => void;
  /** Offered in the page's menu when the page can be moved. */
  onMoveTo?: (path: VaultPath) => void;
  /** Offered in the page's menu when the page can be deleted. */
  onDelete?: (path: VaultPath) => void;
  /** Opens the graph around a note, from its page's menu. */
  onShowInGraph?: (path: VaultPath) => void;
  /** Splitting, closing and the page menu's open state, which the app owns. */
  arrangement: PaneArrangement;
}) {
  const { notes, index, sources, types, notePaths, indexKey, onChanged, editors, savedViews } =
    context;

  const note = usePaneNote({ paneId, path, context });
  const links = useNoteLinks({ context, path });
  const linkCheck = useMemo(
    () => ({ fs: notes.fs, markdown: notes.markdown, notePaths }),
    [notes.fs, notes.markdown, notePaths],
  );
  const noteProperties = useNoteProperties({ note: note.open, types, index, links: linkCheck });
  const addProperty = useAddProperty({
    fs: notes.fs,
    markdown: notes.markdown,
    typeName: noteProperties.typeName,
    types,
    setProperty: note.setProperty,
    rememberKind: noteProperties.rememberKind,
    onTypeSaved: context.onTypeSaved,
  });
  const createRelated = useCreateRelated({
    fs: notes.fs,
    markdown: notes.markdown,
    types,
    notePaths,
    beside: path,
    onChanged,
  });
  const dashboard = useDashboard({ note: note.open, index, types, notePaths, indexKey });
  const dashboardEditing = useDashboardEditing({
    note: note.open,
    isDashboard: dashboard.results !== null,
    ports: notes,
    index,
    types,
    notePaths,
    savedViews,
    editors,
    activity: context.activity,
    onChanged,
    editorSlot: arrangement.popups?.('widget-editor'),
  });
  const savedView = useSavedView({
    note: note.open,
    index,
    fs: notes.fs,
    markdown: notes.markdown,
    types,
    notePaths,
    indexKey,
    onChanged,
    editors,
    tickMemory: context.tickMemory,
    drafts: context.viewDrafts,
    viewPaths: context.viewPaths,
    activity: context.activity,
  });
  const sqlView = useSqlView({ note: note.open, index, indexKey });
  const folds = useGroupFolds({
    store: context.groupFolds,
    view: `${context.vault ?? ''}\u0000${path ?? ''}`,
  });
  const queryView = useQueryView({
    folds,
    note: note.open,
    ports: { index, fs: notes.fs, markdown: notes.markdown, editors, activity: context.activity },
    types,
    notePaths,
    indexKey,
    queryViews: context.queryViews,
    dashboards: context.dashboards,
    viewPaths: context.viewPaths,
    onChanged,
    onOpenNote: (target) => onOpenNote(createVaultPath(target)),
  });
  const choosing = useViewChoosing({ viewKey: path ?? '', commands: context.archive });
  // Held here, above both, because the toolbar pages the range the body draws.
  const calendar = useCalendarNav({
    today: localToday(),
    resetKey: path,
    range: savedView.display.calendarRange,
    onRange: savedView.setCalendarRange,
  });
  const source = useSource({
    note: note.open,
    fs: notes.fs,
    markdown: notes.markdown,
    index,
    sources,
    refresher: context.sourceRefresher,
    vaultRoot: context.vault,
    setProperty: note.setProperty,
    onChanged,
  });
  const artifact = useArtifactCopy({
    note: note.open,
    fs: notes.fs,
    clock: localClock,
    links: context.links,
    thumbnails: context.thumbnails,
    setProperties: note.setProperties,
    activity: context.activity,
    onChanged,
  });
  const pageThumbnail = usePageThumbnail({
    note: note.open,
    type: types.find((candidate) => candidate.name === noteProperties.typeName),
    thumbnails: context.thumbnails,
    ports: {
      fs: notes.fs,
      probe: webviewImageProbe,
      placement: browserImagePlacementStore,
      now: localNow,
      onSaved: onChanged,
    },
    setProperties: note.setProperties,
  });
  const loadImage = useImages({ fs: notes.fs, notePath: path });
  const bookmarks = useBookmarks({
    fs: notes.fs,
    markdown: notes.markdown,
    index,
    notePath: path,
    notePaths,
    types,
    revision: indexKey,
  });
  const transclusions = useTransclusions({
    fs: notes.fs,
    markdown: notes.markdown,
    index,
    notePath: path,
    notePaths,
    revision: indexKey,
  });
  const queries = useQueryBlocks({
    index,
    types,
    notePaths,
    notePath: path,
    revision: indexKey,
    onOpenNote: (target) => onOpenNote(createVaultPath(target)),
  });
  const picking = useBlockPicking({
    fs: notes.fs,
    markdown: notes.markdown,
    index,
    notePath: path,
    notePaths,
    openNotes: context.openNotes,
    rng: cryptoRng,
    onChanged,
    onRefused: context.onLinkProblem,
  });
  const embedImage = useEmbedImage({
    ports: {
      fs: notes.fs,
      probe: webviewImageProbe,
      placement: browserImagePlacementStore,
      now: localNow,
      onSaved: onChanged,
      activity: context.activity,
    },
    notePath: path,
  });
  const backfill = useThumbnailBackfill({
    thumbnails: context.thumbnails,
    index,
    fs: notes.fs,
    markdown: notes.markdown,
  });
  const openTarget = (target: string) => onOpenNote(createVaultPath(target));
  const pageKey = usePageKey(path, note.open);
  const template = templateNoticeFor(path, context);

  return (
    <NotePane
      key={pageKey}
      state={note.state}
      heading={
        note.open === null
          ? null
          : pageHeading({
              note: note.open,
              typeName: noteProperties.typeName,
              sql: savedView.result?.sql ?? sqlView.sql,
            })
      }
      arrangement={arrangement}
      onChange={note.changeDoc}
      onSave={note.save}
      onFollowLink={onFollowLink}
      suggestNotes={context.suggestNotes}
      suggestTags={context.suggestTags}
      people={context.people}
      bookmarks={bookmarks}
      transclusions={transclusions}
      {...(queries !== undefined && { queries })}
      picking={picking}
      reveal={reveal}
      onOpenTag={context.openTag}
      links={links.links}
      mentions={links.mentions.state}
      onFindMentions={links.mentions.find}
      onLinkMention={links.mentions.link}
      onOpenNote={onOpenNote}
      loadImage={loadImage}
      {...(embedImage !== undefined && { embedImage })}
      typeName={noteProperties.typeName}
      properties={noteProperties.rows}
      propertyKeys={noteProperties.keys}
      relationChoices={noteProperties.relationChoices}
      typeLabel={noteProperties.typeLabel}
      relationTargets={noteProperties.relationTargets}
      customPropertyValues={{
        ...(artifact !== null && { [ARTIFACT_KEYS.cover]: thumbnailValue(artifact, loadImage) }),
        ...(pageThumbnail !== null && {
          [pageThumbnail.key]: pageThumbnailValue(pageThumbnail, loadImage),
        }),
      }}
      onChangeProperty={note.setProperty}
      onAddProperty={addProperty}
      onCreateRelated={createRelated}
      onRename={(name) => {
        if (path === null) return;
        // A template is renamed as a template, never through the note's own flow.
        if (template !== null) context.templateCommands.rename({ path, name });
        else onRename({ path, name });
      }}
      {...(template !== null && { template })}
      {...(onMoveTo !== undefined &&
        path !== null &&
        template === null &&
        isMovable({ path, kind: 'file' }) && { onMoveTo: () => onMoveTo(path) })}
      {...(path !== null &&
        template !== null && { onDelete: () => context.templateCommands.askDelete(path) })}
      {...(onDelete !== undefined &&
        path !== null &&
        template === null &&
        deleteRefusal({ path, kind: 'file' }) === null && { onDelete: () => onDelete(path) })}
      {...archiveItems(context.archive, path)}
      {...(onShowInGraph !== undefined &&
        path !== null &&
        template === null && { onShowInGraph: () => onShowInGraph(path) })}
      onOverwrite={note.overwrite}
      onDiscard={note.discard}
      favorite={note.open !== null && isFavorite(note.open.properties)}
      onToggleFavorite={() => {
        if (path !== null) onToggleFavorite(path);
      }}
      aside={artifactAside(artifact, path)}
      // A template is edited as text, whatever it makes: the Dashboard
      // template's widgets are its frontmatter, not a dashboard to arrange.
      body={
        template !== null
          ? undefined
          : paneBody({
              source,
              dashboard: { ...dashboard, ...dashboardEditing },
              savedView,
              sqlView,
              queryView,
              calendar,
              arrangement,
              openTarget,
              followLink: onFollowLink,
              openTag: context.openTag,
              thumbnails: context.thumbnails,
              fs: notes.fs,
              choosing,
              folds,
            })
      }
      {...(template === null &&
        dashboardEditing.toggle !== null && {
          actions: <CustomizeToggle {...dashboardEditing.toggle} />,
        })}
      toolbar={
        template === null && (
          <ViewHeadToolbar
            view={savedView}
            note={note.open}
            savedViews={savedViews}
            calendar={calendar}
            onOpenNote={onOpenNote}
            onNewArtifact={context.newArtifact}
            backfill={backfill}
            popups={arrangement.popups}
            choosing={choosing}
            tabEditing={context.typeTabs}
          />
        )
      }
    />
  );
}

/** "Archive" for a note that can be archived, "Unarchive" for one that is. */
function archiveItems(
  commands: ArchiveCommands,
  path: VaultPath | null,
): { onArchive?: () => void; onUnarchive?: () => void } {
  if (path === null || commands.busy) return {};
  if (isArchivedPath(path)) return { onUnarchive: () => commands.unarchive([path]) };
  return archiveRefusal(path) === null ? { onArchive: () => commands.archive([path]) } : {};
}

/** An artifact's saved copy, under its properties; nothing for any other note. */
function artifactAside(artifact: ArtifactCopyView | null, path: VaultPath | null): ReactNode {
  if (artifact === null || path === null) return null;
  return (
    <ArtifactViewer
      title={noteTitle(path)}
      url={artifact.url}
      copy={artifact.copy}
      adding={artifact.adding}
      error={artifact.error}
      onOpenLink={artifact.openLink}
      onReload={artifact.reload}
      onAddCopy={artifact.addCopy}
      thumbnail={{
        generating: artifact.thumbnail.generating,
        onRegenerate: artifact.thumbnail.regenerate,
      }}
    />
  );
}

/** An artifact's Thumbnail row: the picture, and Regenerate and Clear. */
function thumbnailValue(
  artifact: ArtifactCopyView,
  load: (src: string) => Promise<string | null>,
): (id: string) => ReactNode {
  const { thumbnail } = artifact;
  return function thumbnailRow(id) {
    return (
      <ThumbnailValue
        id={id}
        cover={thumbnail.cover}
        shown={thumbnail.shown}
        generating={thumbnail.generating}
        failure={thumbnail.failure}
        canGenerate={thumbnail.canGenerate}
        load={load}
        onRegenerate={thumbnail.regenerate}
        onClear={thumbnail.clear}
      />
    );
  };
}

/** A note's Thumbnail row: the picture of its page or the one it chose, and what to do with it. */
function pageThumbnailValue(
  thumbnail: PageThumbnailView,
  load: (src: string) => Promise<string | null>,
): (id: string) => ReactNode {
  return function pageThumbnailRow(id) {
    return (
      <ThumbnailValue
        id={id}
        cover={thumbnail.shown}
        shown={thumbnail.shown}
        generating={thumbnail.generating}
        failure={thumbnail.failure}
        canGenerate
        load={load}
        onRegenerate={thumbnail.regenerate}
        regenerateDiscards={thumbnail.discards}
        onClear={thumbnail.clear}
        onChoose={thumbnail.choose}
        clearable={!thumbnail.cleared}
        emptyLabel={thumbnail.cleared ? 'None' : 'None yet'}
      />
    );
  };
}

/** What the pane's note is linked with, both ways, and the notes that name it without a link. */
function useNoteLinks({ context, path }: { context: PaneContext; path: VaultPath | null }) {
  const { graph, index, notes, openNotes, indexKey, onChanged } = context;
  const links = useMemo(
    () => (graph === null || path === null ? NO_LINKS : noteLinks(graph, path)),
    [graph, path],
  );
  const title =
    path === null
      ? ''
      : (graph?.nodes.find((node) => node.path === path)?.title ?? noteTitle(path));
  const ports = useMemo(
    () => ({ index, fs: notes.fs, markdown: notes.markdown, openNotes }),
    [index, notes.fs, notes.markdown, openNotes],
  );
  const mentions = useUnlinkedMentions({
    ports,
    note: path === null ? null : { path, title },
    links,
    indexKey,
    onChanged,
  });
  return { links, mentions };
}

/**
 * The pane's note, registered with the other panes so a write made elsewhere —
 * a board card moved, a table cell edited — can reach this editor.
 */
function usePaneNote({
  paneId,
  path,
  context,
}: {
  paneId: number;
  path: VaultPath | null;
  context: PaneContext;
}) {
  const { editors, stranded } = context;
  const note = useNote({
    ports: context.notes,
    vault: context.vault,
    path,
    onSaved: (saved) => editors.reloadOthers({ paneId, path: saved }),
    onStranded: stranded.keep,
    recoverStranded: stranded.take,
    settleStranded: stranded.settle,
    onSaveFailed: ({ path: failed, cause }) => {
      // The vault the pane is in: a save refused after a switch is still that vault's.
      if (context.vault === null) return;
      const problem = messageWithoutPaths(cause);
      context.activity
        .inVault(context.vault)
        .record(writeFailedReport({ write: 'save', path: failed, problem }));
    },
  });

  /**
   * This pane's editor as it stands now.
   *
   * The registration below must not be rewritten on every keystroke, so what is
   * registered reads through this rather than closing over one render.
   */
  const live = useRef(note);
  useEffect(() => {
    live.current = note;
  });

  useEffect(() => {
    if (path === null) return;
    editors.register(paneId, {
      path,
      setProperties: (changes) => live.current.setProperties(changes),
      save: () => live.current.save(),
      flush: () => live.current.flush(),
      reload: () => live.current.reload(),
      isDirty: () => live.current.dirty,
      repoint: (to) => live.current.repoint(to),
      abandon: () => live.current.abandon(),
    });
    return () => editors.register(paneId, null);
  }, [editors, paneId, path]);

  return note;
}

/**
 * Which page the pane is showing, as React's key for it.
 *
 * The path, except across a move: a note re-pointed under the pane already
 * holds its new path when the pane is handed it, and is the same page — the
 * editor, its cursor and whatever the "…" menu revealed stay as they were. A
 * note opened fresh is still holding the old one, and gets a fresh page.
 */
function usePageKey(path: VaultPath | null, open: { readonly path: VaultPath } | null): string {
  const [key, setKey] = useState(path ?? 'none');
  const wanted = path === null || open?.path !== path ? (path ?? 'none') : key;
  // Kept from one render to the next, the way React stores what an earlier
  // render saw: set during render, so the page is never drawn under a stale key.
  if (wanted !== key) setKey(wanted);
  return wanted;
}

/** What a page draws instead of the editor: a source, a dashboard or a view; nothing for prose. */
function paneBody({
  source,
  dashboard,
  savedView,
  sqlView,
  queryView,
  calendar,
  arrangement,
  openTarget,
  followLink,
  openTag,
  thumbnails,
  fs,
  choosing,
  folds,
}: {
  source: ReturnType<typeof useSource>;
  dashboard: ReturnType<typeof useDashboard> & ReturnType<typeof useDashboardEditing>;
  savedView: ReturnType<typeof useSavedView>;
  sqlView: ReturnType<typeof useSqlView>;
  queryView: QueryViewState | null;
  calendar: CalendarNavigation;
  arrangement: PaneArrangement;
  openTarget: (target: string) => void;
  /** Follows a `[[link]]` in a feed's bodies, as one in the editor is followed. */
  followLink: (target: string) => void;
  /** Opens the tags page on a `#tag` in a feed's bodies. */
  openTag: (name: string) => void;
  thumbnails: ThumbnailQueue;
  fs: VaultFsPort;
  choosing: ViewChoosing;
  folds: GroupFolds;
}): ReactNode {
  if (source.source !== null) {
    return (
      <SourcePanel
        source={source.source}
        report={source.report}
        refreshing={source.refreshing}
        onRefresh={source.refresh}
        secrets={source.secrets}
        outsideVault={source.outsideVault}
        {...(source.chooseFile !== null && { onChooseFile: source.chooseFile })}
        fileProblem={source.fileProblem}
      />
    );
  }
  if (dashboard.results !== null) {
    return (
      <>
        <DashboardView
          results={dashboard.results}
          onOpenNote={openTarget}
          {...(arrangement.popups !== undefined && { popups: arrangement.popups })}
          {...(dashboard.editing !== undefined && { editing: dashboard.editing })}
        />
        {dashboard.sheet !== null && <WidgetEditor {...dashboard.sheet} />}
      </>
    );
  }
  if (sqlView.sql !== null) return <SqlViewBody view={sqlView} onOpenNote={openTarget} />;
  if (queryView !== null) {
    return (
      <QueryViewBody
        view={queryView}
        onOpenView={openTarget}
        {...(arrangement.popups !== undefined && { popups: arrangement.popups })}
      />
    );
  }
  if (savedView.query === null) return undefined;
  return (
    <ViewBody
      view={savedView}
      calendar={calendar}
      onOpenNote={openTarget}
      onFollowLink={followLink}
      onOpenTag={openTag}
      thumbnails={thumbnails}
      fs={fs}
      choosing={choosing}
      folds={folds}
    />
  );
}

/**
 * The band a template's page wears, or null for anything else: what the
 * template is used for, read from its name and the vault's types.
 */
function templateNoticeFor(path: VaultPath | null, context: PaneContext): TemplateNotice | null {
  if (path === null || !isTemplateNote(path)) return null;
  return {
    uses: templateUses(templateNameOf(path), context.types),
    onOpenTemplates: context.templateCommands.onOpenTemplates,
    onMoveToNotes: () => context.templateCommands.askMoveToNotes(path),
  };
}
