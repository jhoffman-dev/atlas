import { memo, useRef, type DragEvent, type KeyboardEvent } from 'react';
import {
  hasComment,
  HIGHLIGHT_HUES,
  highlightColor,
  highlightPlace,
  isHighlightFiltered,
  NO_HIGHLIGHT_FILTER,
  withToggled,
  type ChangedWithin,
  type CommentFilter,
  type HighlightChoices,
  type HighlightEntry,
  type HighlightFilter,
  type VaultPath,
} from '@dfai/domain';
import { ChoiceSelect } from '../choice-select.tsx';
import { Icon } from '../icon.tsx';
import { blockEmbedTransfer } from '../editor/embed-transfer.ts';
import { openHowFrom, type OpenHow } from '../open-how.ts';
import { PageBar, type PageHistory } from '../page-bar.tsx';
import { HiddenTitle } from '../page-head.tsx';
import { ROW_SCROLLER_MARK, RowScrollerContext } from '../row-scroller.ts';
import {
  ChipToggles,
  ClearFilters,
  FilterSelect,
  ResearchNotice,
  shownCount,
  type ResearchListState,
} from './research-filters.tsx';
import { ResearchRows, type RowPlace } from './research-rows.tsx';

export interface HighlightsPageProps {
  readonly state: ResearchListState<HighlightEntry>;
  readonly choices: HighlightChoices;
  readonly filter: HighlightFilter;
  readonly onFilter: (filter: HighlightFilter) => void;
  /** Opens a highlight's place: its literature note, at its block. */
  readonly onOpen: (path: VaultPath, block: string, how: OpenHow) => void;
  /** What to write inside `![[…]]` so an embed opens the source note: asked as a row is dragged. */
  readonly linkTargetOf: (path: VaultPath) => string;
  /** Puts a highlight's embed, `![[Source#^id]]`, on the clipboard: for the keyboard, where a row cannot be dragged. */
  readonly onCopyEmbed: (embed: string) => void;
  readonly onShowSidebar?: () => void;
  readonly history?: PageHistory;
}

/** A row's height before it is measured: a two-line quote and its source. */
const ROW_HEIGHT = 76;

const COMMENTS: readonly { value: CommentFilter; label: string }[] = [
  { value: 'any', label: 'With or without a comment' },
  { value: 'with', label: 'With a comment' },
  { value: 'without', label: 'Without a comment' },
];

const CHANGED: readonly { value: ChangedWithin; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'week', label: 'Source changed this week' },
  { value: 'month', label: 'Source changed this month' },
  { value: 'year', label: 'Source changed this year' },
];

// By place, not id: two highlights of one note can share an id (a note edited by hand).
const keyOf = (entry: HighlightEntry) => `${entry.path}#${entry.index}`;

/**
 * All highlights (#507): every highlight across the literature notes — its
 * quote, comment, colour and source, and its page or location. Filtered by
 * source, colour, tag, comment and when the source last changed. A row opens
 * the note at the highlight, and dragged into a note it becomes the embed
 * `![[Source#^id]]` there.
 */
export function HighlightsPage(props: HighlightsPageProps) {
  const { state } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const count = shownCount(state, ['highlight', 'highlights']);
  return (
    <>
      <PageBar
        crumb={{ icon: 'library', parent: 'Library' }}
        name="All highlights"
        {...(count !== null && { count })}
        {...(props.onShowSidebar !== undefined && { onShowSidebar: props.onShowSidebar })}
        {...(props.history !== undefined && { history: props.history })}
      />
      <div className="panel__body panel__body--rows" ref={scroller} {...ROW_SCROLLER_MARK}>
        <RowScrollerContext.Provider value={scroller}>
          <article className="page page--wide research" aria-label="All highlights">
            <HiddenTitle>All highlights</HiddenTitle>
            <HighlightsToolbar {...props} />
            <ResearchNotice
              state={state}
              reading="Reading the highlights…"
              none="No highlights yet. Highlights taken in a PDF or an EPUB, or synced from a Kindle, are listed here."
              noMatch="No highlight matches."
            />
            {state.kind === 'ready' && state.shown.length > 0 && (
              <ResearchRows
                items={state.shown}
                keyOf={keyOf}
                estimate={ROW_HEIGHT}
                label="Highlights"
                renderRow={(entry, place) => (
                  <HighlightRow
                    key={keyOf(entry)}
                    entry={entry}
                    index={place.index}
                    size={place.size}
                    measure={place.measure}
                    onOpen={props.onOpen}
                    linkTargetOf={props.linkTargetOf}
                    onCopyEmbed={props.onCopyEmbed}
                  />
                )}
              />
            )}
          </article>
        </RowScrollerContext.Provider>
      </div>
    </>
  );
}

function HighlightsToolbar({ choices, filter, onFilter }: HighlightsPageProps) {
  return (
    <div className="research__toolbar">
      <FilterSelect
        label="Source"
        every="All sources"
        value={filter.source}
        choices={choices.sources}
        onChange={(source) => onFilter({ ...filter, source })}
      />
      <ChipToggles
        label="Colour"
        choices={choices.colors}
        on={filter.colors}
        hueOf={(color) => HIGHLIGHT_HUES[color]}
        onToggle={(color) => onFilter({ ...filter, colors: withToggled(filter.colors, color) })}
      />
      <FilterSelect
        label="Tag"
        every="Any tag"
        value={filter.tag}
        choices={choices.tags}
        onChange={(tag) => onFilter({ ...filter, tag })}
      />
      <ChoiceSelect
        label="Comment"
        className="research__select"
        value={filter.comment}
        choices={COMMENTS}
        onChange={(comment) => onFilter({ ...filter, comment })}
      />
      <ChoiceSelect
        label="Date"
        className="research__select"
        value={filter.changed}
        choices={CHANGED}
        onChange={(changed) => onFilter({ ...filter, changed })}
      />
      <ClearFilters
        on={isHighlightFiltered(filter)}
        onClear={() => onFilter(NO_HIGHLIGHT_FILTER)}
      />
    </div>
  );
}

/** One highlight. Drawn again only when its own entry or handlers change, not as the list scrolls. */
const HighlightRow = memo(function HighlightRow({
  entry,
  index,
  size,
  measure,
  onOpen,
  linkTargetOf,
  onCopyEmbed,
}: {
  entry: HighlightEntry;
  index: number;
  size: number;
  measure: RowPlace['measure'];
  onOpen: HighlightsPageProps['onOpen'];
  linkTargetOf: HighlightsPageProps['linkTargetOf'];
  onCopyEmbed: HighlightsPageProps['onCopyEmbed'];
}) {
  const place = highlightPlace(entry);
  const color = highlightColor(entry.color);
  const transfer = () => blockEmbedTransfer({ target: linkTargetOf(entry.path), id: entry.id });
  const onDragStart = (event: DragEvent<HTMLLIElement>) => {
    const dragged = transfer();
    event.dataTransfer.setData('text/plain', dragged.text);
    event.dataTransfer.setData('text/html', dragged.html);
    event.dataTransfer.effectAllowed = 'copy';
  };
  // ⌘C on a focused row copies its embed, unless words are selected: that copy is theirs.
  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'c') return;
    if ((window.getSelection()?.toString() ?? '') !== '') return;
    event.preventDefault();
    onCopyEmbed(transfer().text);
  };
  return (
    <li
      ref={measure}
      data-index={index}
      className="research__row highlight__row"
      aria-setsize={size}
      aria-posinset={index + 1}
      draggable
      onDragStart={onDragStart}
      onKeyDown={onKeyDown}
    >
      <span
        className="highlight__swatch"
        data-hue={HIGHLIGHT_HUES[color]}
        data-mark={entry.mark === 'underline' ? 'underline' : 'highlight'}
        aria-hidden="true"
      />
      <button
        type="button"
        className="research__open highlight__open"
        onClick={(event) => onOpen(entry.path, entry.id, openHowFrom(event))}
      >
        <span className="visually-hidden">
          {color} {entry.mark === 'underline' ? 'underline' : 'highlight'}:{' '}
        </span>
        <span className="highlight__quote">{entry.quote}</span>
        {hasComment(entry) && <span className="highlight__comment">{entry.comment}</span>}
        <span className="highlight__source">
          <span className="research__title">{entry.source}</span>
          {place !== null && <span className="research__byline">{place}</span>}
        </span>
      </button>
      <button
        type="button"
        className="btn btn--sm highlight__copy"
        aria-label={`Copy embed of this ${color} highlight`}
        onClick={() => onCopyEmbed(transfer().text)}
      >
        <Icon name="copy" size={14} />
      </button>
    </li>
  );
});
