import { useMemo } from 'react';
import {
  calendarEndKey,
  thumbnailPropertyOf,
  ARTIFACT_KEYS,
  ARTIFACT_TYPE,
  createVaultPath,
  humanizeKey,
  toBoardRows,
  newNoteLabel,
  savedViewSummary,
  viewTabs,
  type BoardRow,
  type SavedViewSummary,
  type VaultPath,
} from '@atlas/domain';
import type { OpenNote, ThumbnailQueue, VaultFsPort } from '@atlas/application';
import {
  ArtifactCardFace,
  BoardView,
  CalendarNav,
  CalendarView,
  FeedView,
  GalleryView,
  LayoutMenu,
  GroupByPopover,
  SelectionBar,
  PropertiesPopover,
  ViewSaveControls,
  ListView,
  TableView,
  TimelineView,
  ViewToolbar,
  type CalendarNavigation,
  type CoverSource,
  type GroupFolds,
  type OverlaySlots,
  type ViewField,
  type ViewTabEditing,
} from '@atlas/ui';
import type { TabLanding } from '../types/use-type-views.ts';
import { remadeCover, useThumbnailSnapshot } from '../artifacts/use-thumbnails.ts';
import { PageGallery } from '../thumbnails/page-gallery.tsx';
import type { ThumbnailBackfill } from '../artifacts/use-thumbnail-backfill.ts';
import type { useSavedView } from '../query/use-saved-view.ts';
import type { useSqlView } from '../query/use-sql-view.ts';
import { localToday } from '../today.ts';
import { useMinuteNow } from './use-minute-now.ts';
import { schemaOf } from './table-schema.ts';
import type { ViewChoosing } from '../archive/use-view-choosing.ts';

type SavedView = ReturnType<typeof useSavedView>;

/** What a filter or a sort can name: the title, then what the type declares. */
function fieldsOf(view: SavedView): ViewField[] {
  const declared = view.type?.properties.map((def) => def.key) ?? view.query?.columns ?? [];
  const labels = schemaOf(view.type, '').labels;
  const kindOf = (key: string) => {
    const kind = view.type?.properties.find((def) => def.key === key)?.kind;
    return kind === undefined ? {} : { kind };
  };
  return [
    { key: 'title', label: 'Name' },
    ...declared
      .filter((key) => key !== 'title')
      .map((key) => ({ key, label: labels[key] ?? humanizeKey(key), ...kindOf(key) })),
  ];
}

/** The layouts the Group control is offered on: those that draw groups and sub-groups. */
const GROUPED_LAYOUTS: readonly string[] = ['table', 'board'];

/** Grouping, for a table or a board, and which properties show — after Sort in the toolbar. */
function ViewSettings({ view, popups }: { view: SavedView; popups: OverlaySlots | undefined }) {
  const fields = fieldsOf(view).filter((field) => field.key !== 'title');
  const labels = schemaOf(view.type, '').labels;
  return (
    <>
      {GROUPED_LAYOUTS.includes(view.display.layout) && (
        <GroupByPopover
          choices={view.groupChoices.map((choice) => ({
            ...choice,
            label: labels[choice.key] ?? humanizeKey(choice.key),
          }))}
          groupBy={view.display.groupBy}
          subGroupBy={view.display.subGroupBy}
          onChange={view.setGroupBy}
          onChangeSub={view.setSubGroupBy}
          // A board is its columns; a table can be flat.
          required={view.display.layout === 'board'}
          slot={popups?.('group')}
        />
      )}
      <PropertiesPopover
        fields={fields}
        columns={view.query?.columns ?? []}
        onChange={view.toggleColumn}
        onMove={view.moveColumn}
        slot={popups?.('properties')}
      />
    </>
  );
}

/** Adds a note of the view's type and opens it where the view was. */
function addAndOpen(view: SavedView, onOpenNote: (path: VaultPath) => void) {
  // A failed create is shown as the view's error by `addNote` itself.
  void view.addNote().then((path) => {
    if (path !== null) onOpenNote(path);
  });
}

/** Whether the view draws as a calendar, which is when its toolbar pages one. */
function isCalendar(view: SavedView): boolean {
  return view.display.layout === 'calendar' && view.display.dateKey !== null;
}

/**
 * The row under a view's title: its type's views as tabs — added, renamed,
 * copied, deleted and moved from there (ADR-0023) — then a calendar's
 * range and dates, Filter, Sort and "New <type>". Null for a note that is not a view.
 */
export function ViewHeadToolbar({
  view,
  note,
  savedViews,
  calendar,
  onOpenNote,
  onNewArtifact,
  backfill,
  popups,
  choosing,
  tabEditing,
}: {
  view: SavedView;
  note: OpenNote | null;
  savedViews: readonly SavedViewSummary[];
  /** A type's tabs' commands, opening what they make where this view is. */
  tabEditing: (landing: TabLanding) => ViewTabEditing | undefined;
  calendar: CalendarNavigation;
  onOpenNote: (path: VaultPath) => void;
  /** An artifact is saved from its link or its page, so a view of them asks with the dialog. */
  onNewArtifact: () => void;
  /** "Generate missing thumbnails", offered on a view of artifacts. */
  backfill: ThumbnailBackfill;
  /** Filter's and Sort's open state, held by the app's one-overlay rule. */
  popups: OverlaySlots | undefined;
  /** Select mode, offered on a table: its rows chosen to archive together. */
  choosing: ViewChoosing;
}) {
  const current = note === null ? null : savedViewSummary(note.path, note.properties);
  if (view.query === null || current === null) return null;
  const editing = tabEditing({ typeName: current.type, onOpenView: onOpenNote, current });

  return (
    <ViewToolbar
      tabs={viewTabs({ views: savedViews, current })}
      onOpenView={(path) => onOpenNote(createVaultPath(path))}
      {...(editing !== undefined && { tabEditing: editing })}
      fields={fieldsOf(view)}
      filters={view.query.filters}
      sorts={view.query.sorts}
      onChangeFilters={view.setFilters}
      onChangeSorts={view.setSorts}
      layout={
        <LayoutMenu
          choices={view.layouts}
          current={view.display.layout}
          onChoose={view.setLayout}
          slot={popups?.('layout')}
        />
      }
      settings={<ViewSettings view={view} popups={popups} />}
      {...(view.edited && {
        pending: (
          <ViewSaveControls
            suggestedName={`${current.title} copy`}
            error={view.saveAsError}
            onSave={view.save}
            onReset={view.reset}
            onSaveAs={(name) => {
              void view.saveAs(name).then((path) => {
                if (path !== null) onOpenNote(path);
              });
            }}
            slot={popups?.('save-as')}
          />
        ),
      })}
      controls={
        isCalendar(view) ? (
          <CalendarNav calendar={calendar} />
        ) : view.type?.name === ARTIFACT_TYPE ? (
          <BackfillButton backfill={backfill} />
        ) : undefined
      }
      newLabel={newNoteLabel(view.type?.label ?? view.query.type)}
      onNew={() =>
        view.type?.name === ARTIFACT_TYPE ? onNewArtifact() : addAndOpen(view, onOpenNote)
      }
      archived={{ included: view.includeArchived, onChange: view.setIncludeArchived }}
      {...(view.display.layout === 'table' && {
        selecting: { on: choosing.on, onChange: choosing.setOn },
      })}
      {...(popups !== undefined && { popups })}
    />
  );
}

/** Makes a thumbnail for each artifact that has a copy and none, saying how many are left. */
function BackfillButton({ backfill }: { backfill: ThumbnailBackfill }) {
  return (
    <>
      <button
        type="button"
        className="view-toolbar__button"
        disabled={backfill.left > 0}
        onClick={backfill.run}
      >
        {backfill.left > 0
          ? `Generating thumbnails… ${backfill.left} left`
          : 'Generate missing thumbnails'}
      </button>
      {backfill.report !== null && backfill.left === 0 && (
        <span className="view-toolbar__note" role="status">
          {backfill.report}
        </span>
      )}
    </>
  );
}

/**
 * A gallery of artifacts: each card fronted with its thumbnail, 16:10, and
 * with its drawn front while one is being made or when there is none. A
 * thumbnail made again is loaded again (`remadeCover`).
 */
function ArtifactGallery({
  covers,
  thumbnails,
  ...gallery
}: Omit<Parameters<typeof GalleryView>[0], 'covers' | 'placeholder' | 'fronts'> & {
  covers: CoverSource;
  thumbnails: ThumbnailQueue;
}) {
  const queue = useThumbnailSnapshot(thumbnails);
  const shown = useMemo<CoverSource>(
    () => ({
      coverOf: (path) => {
        const cover = covers.coverOf(path);
        if (cover === null || queue.state(path)?.kind === 'generating') return null;
        return remadeCover(cover, queue.made(path));
      },
      load: covers.load,
    }),
    [covers, queue],
  );
  const face = (row: BoardRow) => {
    const kind = row.values[ARTIFACT_KEYS.kind];
    return (
      <ArtifactCardFace
        kind={typeof kind === 'string' ? kind : ''}
        title={row.title}
        generating={queue.state(row.path)?.kind === 'generating'}
      />
    );
  };
  return <GalleryView {...gallery} covers={shown} placeholder={face} fronts="screen" />;
}

/** Draws a saved view the way the view note asks for. */
export function ViewBody({
  view,
  calendar,
  onOpenNote,
  onFollowLink,
  onOpenTag,
  thumbnails,
  fs,
  choosing,
  folds,
}: {
  view: SavedView;
  /** Which of the view's groups and swimlanes are folded shut, remembered on this Mac. */
  folds: GroupFolds;
  /** What a calendar shows, changed from the toolbar. */
  calendar: CalendarNavigation;
  onOpenNote: (path: string) => void;
  /** Follows a `[[link]]` in a feed's bodies. */
  onFollowLink: (target: string) => void;
  /** Opens the tags page on a `#tag` in a feed's bodies. */
  onOpenTag?: (name: string) => void;
  /** Thumbnails being made, which a gallery shows. */
  thumbnails: ThumbnailQueue;
  /** Where the pictures of pages a gallery shows are read from. */
  fs: VaultFsPort;
  /** Select mode: while it is on, a table's rows lead with a box to choose them by. */
  choosing: ViewChoosing;
}) {
  const schema = schemaOf(view.type, view.query?.type ?? '');
  // Spread rather than passed, so a type with no done option draws no boxes.
  const ticks = view.ticks === undefined ? {} : { ticks: view.ticks };

  if (view.error !== null || view.result === null || view.display.layout === 'table') {
    const choose = choosing.on && view.display.layout === 'table';
    return (
      <>
        {choose && (
          <SelectionBar
            count={choosing.count}
            actions={choosing.actions}
            onClear={choosing.clear}
          />
        )}
        <TableView
          result={view.result}
          sorts={view.query?.sorts ?? []}
          error={view.error}
          schema={schema}
          onOpenNote={onOpenNote}
          onEditCell={view.editCell}
          onToggleSort={view.toggleSort}
          onNewNote={() => addAndOpen(view, onOpenNote)}
          hiddenColumns={view.hidden}
          {...ticks}
          {...(choose && { selection: choosing.selection })}
          {...(view.display.groupBy !== null && {
            grouping: {
              groups: view.groups,
              collapsed: folds.collapsed,
              onToggle: folds.onToggle,
              onNew: (chain) => {
                // A failed create is shown as the view's error by `addInGroup` itself.
                void view.addInGroup(chain).then((path) => {
                  if (path !== null) onOpenNote(path);
                });
              },
            },
          })}
        />
      </>
    );
  }

  const fields = view.fields;

  if (view.display.layout === 'board' && view.display.groupBy !== null) {
    return (
      <BoardView
        columns={view.columns}
        lanes={view.lanes}
        folds={folds}
        groupBy={view.display.groupBy}
        fields={fields}
        kinds={schema.kinds}
        onOpenNote={onOpenNote}
        onMoveCard={view.moveCard}
        onAddCard={view.addCard}
        {...ticks}
      />
    );
  }

  if (view.display.layout === 'calendar' && view.display.dateKey !== null) {
    return (
      <ViewCalendar
        view={view}
        dateKey={view.display.dateKey}
        calendar={calendar}
        kinds={schema.kinds}
        onOpenNote={onOpenNote}
        {...ticks}
      />
    );
  }

  if (view.display.layout === 'timeline' && view.display.startKey !== null) {
    return (
      <TimelineView
        rows={view.rows}
        startKey={view.display.startKey}
        endKey={view.display.endKey ?? view.display.startKey}
        today={localToday()}
        onOpenNote={onOpenNote}
        onReschedule={view.moveBar}
      />
    );
  }

  if (view.display.layout === 'feed') {
    return (
      <FeedView
        rows={view.rows}
        fields={fields}
        kinds={schema.kinds}
        bodies={view.previews.bodies}
        shown={view.previews.shown}
        onShowMore={view.previews.showMore}
        onOpenNote={onOpenNote}
        onFollowLink={onFollowLink}
        {...(onOpenTag !== undefined && { onOpenTag })}
        {...ticks}
      />
    );
  }

  if (view.display.layout === 'gallery') {
    const gallery = {
      rows: view.rows,
      fields,
      kinds: schema.kinds,
      onOpenNote,
      ...(view.display.groupBy !== null && { groups: view.columns }),
      ...ticks,
    };
    if (view.type?.name === ARTIFACT_TYPE) {
      return <ArtifactGallery {...gallery} covers={view.previews.covers} thumbnails={thumbnails} />;
    }
    return thumbnailPropertyOf(view.type) === null ? (
      <GalleryView {...gallery} covers={view.previews.covers} />
    ) : (
      <PageGallery
        {...gallery}
        covers={view.previews.covers}
        pages={view.previews.pages}
        thumbnails={thumbnails}
        fs={fs}
      />
    );
  }

  return (
    <ListView
      rows={view.rows}
      fields={fields}
      kinds={schema.kinds}
      onOpenNote={onOpenNote}
      {...ticks}
    />
  );
}

/** A view as a calendar, with the clock's now line kept to the minute. */
function ViewCalendar({
  view,
  dateKey,
  calendar,
  kinds,
  ticks,
  onOpenNote,
}: {
  view: SavedView;
  dateKey: string;
  calendar: CalendarNavigation;
  kinds: ReturnType<typeof schemaOf>['kinds'];
  ticks?: NonNullable<SavedView['ticks']>;
  onOpenNote: (path: string) => void;
}) {
  const now = useMinuteNow();
  const { startKey, endKey } = view.display;
  return (
    <CalendarView
      rows={view.rows}
      dateKey={dateKey}
      endKey={calendarEndKey({ dateKey, startKey, endKey })}
      calendar={calendar}
      today={localToday()}
      now={now}
      fields={view.fields}
      kinds={kinds}
      onOpenNote={onOpenNote}
      onReschedule={view.reschedule}
      onCreate={view.addOnDate}
      {...(ticks !== undefined && { ticks })}
    />
  );
}

/**
 * Draws a SQL view's result: read-only, as a table, or as a list when its rows
 * name notes. A heading sorts what came back.
 */
export function SqlViewBody({
  view,
  onOpenNote,
}: {
  view: ReturnType<typeof useSqlView>;
  onOpenNote: (path: string) => void;
}) {
  const named = view.result?.columns.includes('path') === true;
  const open = (path: string) => {
    if (named) onOpenNote(path);
  };
  if (view.layout === 'list' && view.result !== null && named) {
    const rows = toBoardRows({ columns: view.result.columns, rows: view.result.rows });
    return <ListView rows={rows} fields={view.result.columns} onOpenNote={open} />;
  }
  return (
    <TableView
      result={view.result}
      sorts={view.sorts}
      error={view.error}
      onOpenNote={open}
      onToggleSort={view.toggleSort}
    />
  );
}
