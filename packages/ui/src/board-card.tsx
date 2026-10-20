import { Fragment, memo, useState, type ReactNode } from 'react';
import { openHowFrom, type OpenHow } from './open-how.ts';
import { useDraggable } from '@dnd-kit/core';
import {
  cardMeta,
  plainText,
  type BoardRow,
  type CardMetaItem,
  type OptionColors,
  type PropertyKind,
} from '@atlas/domain';
import { useClaimFocus, type FocusFollower } from './drag/focus.ts';
import { DoneCheckbox, doneClass, type DoneTicks } from './done-checkbox.tsx';
import { ChecklistProgress } from './checklist-progress.tsx';
import { Icon } from './icon.tsx';
import { useNoteNames } from './note-names.tsx';
import { TintedPill } from './status-pill.tsx';

/** What a card needs to be drawn, the same in its column and under the pointer. */
export interface CardLook {
  /** Properties to show on the metadata line, in the view's order. */
  readonly fields: readonly string[];
  readonly groupBy: string;
  /** The property a board's swimlanes are by, when the card sits in one: not repeated on the card. */
  readonly laneBy?: string;
  /** The declared kind of each property, so a value can say what it is. */
  readonly kinds: Readonly<Record<string, PropertyKind>>;
  /** The colours each select's type chose for its options, which its pills are drawn in. */
  readonly colors: Readonly<Record<string, OptionColors>>;
  /** The card sits in the column that means finished. */
  readonly done: boolean;
  /** Given when the type can be ticked done: the card leads with a box instead of a tick. */
  readonly ticks?: DoneTicks;
}

/**
 * A card on the board.
 *
 * A pointer picks it up from anywhere on its face; the keyboard picks it up from
 * the title, the one thing on the card that holds focus — making the whole card
 * a second tab stop would double every Tab through a column. A press that
 * travels less than a few pixels is a click, so clicking the title still opens
 * the note, and Enter on it still does too: only Space picks up.
 *
 * Drawn again only for a change of its own (`memo`, #260): its row, its look,
 * or what it opens with — a board holds every card at once.
 */
export const Card = memo(function Card({
  row,
  look,
  onOpen,
  claimFocus,
}: {
  row: BoardRow;
  look: CardLook;
  /** Opens the card's note; `how` is where the click asked for it. */
  onOpen: (path: string, how?: OpenHow) => void;
  claimFocus: FocusFollower['claim'];
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, attributes } = useDraggable({
    id: row.path,
  });
  const titleRef = useClaimFocus<HTMLButtonElement>({
    claim: claimFocus,
    id: row.path,
    alsoRef: setActivatorNodeRef,
  });

  return (
    <article
      className={doneClass('board__card', look.ticks, row.values)}
      ref={setNodeRef}
      data-path={row.path}
      {...listeners}
    >
      <CardFace
        row={row}
        look={look}
        tick={
          look.ticks === undefined ? null : (
            <DoneCheckbox
              path={row.path}
              title={row.title}
              values={row.values}
              ticks={look.ticks}
            />
          )
        }
        title={
          <button
            type="button"
            className="board__title"
            ref={titleRef}
            {...attributes}
            onClick={(event) => onOpen(row.path, openHowFrom(event))}
          >
            <TitleText>{row.title}</TitleText>
          </button>
        }
      />
    </article>
  );
});

/** The card being dragged: a picture of it, drawn above the board. */
export function LiftedCard({ row, look }: { row: BoardRow; look: CardLook }) {
  return (
    <article className="board__card board__card--lifted" aria-hidden="true">
      <CardFace
        row={row}
        look={look}
        tick={null}
        title={
          <span className="board__title">
            <TitleText>{row.title}</TitleText>
          </span>
        }
      />
    </article>
  );
}

/**
 * The title's words, clamped to two lines. The clamp is on a span of its own
 * because WebKit lays a button's content out its own way, which the clamp's
 * box display does not survive.
 */
function TitleText({ children }: { children: string }) {
  return <span className="board__title-text">{children}</span>;
}

/**
 * What a card shows: its done box — or, for a type that has none, a sage tick
 * when it sits in the finished column — the title, one line of what it is
 * about, how far through its checklist it is, and one line of metadata.
 */
function CardFace({
  row,
  look,
  tick,
  title,
}: {
  row: BoardRow;
  look: CardLook;
  tick: ReactNode;
  title: ReactNode;
}) {
  const summary = typeof row.values['summary'] === 'string' ? plainText(row.values['summary']) : '';

  return (
    <>
      <div className="board__head">
        {tick}
        {tick === null && look.done && (
          <span className="board__done" aria-label="Done" role="img">
            <Icon name="check" size={14} />
          </span>
        )}
        {title}
      </div>
      {summary !== '' && <p className="board__summary">{summary}</p>}
      <ChecklistProgress values={row.values} kinds={look.kinds} />
      <CardMetaLine row={row} look={look} />
    </>
  );
}

/**
 * A card's fields as one line — "Phase 14 · From you · 3h" — with no icon per
 * value (brief rule 4). A choice and a linked note are muted pills, which the
 * eye finds faster than words (#413); the rest are words joined by `·`.
 * `cardMeta` decides both. A line with nothing on it is not drawn. Only the
 * dot is hidden from a screen reader, so the spaces round it keep
 * neighbouring values apart.
 */
function CardMetaLine({ row, look }: { row: BoardRow; look: CardLook }) {
  const names = useNoteNames();
  const items = cardMeta({
    fields: look.fields,
    groupBy: look.groupBy,
    ...(look.laneBy !== undefined && { laneBy: look.laneBy }),
    kinds: look.kinds,
    values: row.values,
    names,
    colors: look.colors,
  });
  if (items.length === 0) return null;

  return (
    <p className="board__meta">
      {items.map((item, at) => (
        <Fragment key={item.key}>
          {at > 0 && <MetaGap dotted={!isPill(items[at - 1]) && !isPill(item)} />}
          {item.color === undefined ? (
            <span className="board__meta-item" data-missing={item.missing}>
              {item.text}
            </span>
          ) : (
            <TintedPill text={item.text} color={item.color} />
          )}
        </Fragment>
      ))}
    </p>
  );
}

const isPill = (item: CardMetaItem | undefined): boolean => item?.color !== undefined;

/** What parts two values on the line: a `·` between words; a pill is set apart by its own fill. */
function MetaGap({ dotted }: { dotted: boolean }) {
  if (!dotted) return <> </>;
  return (
    <>
      {' '}
      <span className="board__meta-sep" aria-hidden="true">
        ·
      </span>{' '}
    </>
  );
}

/**
 * Adding a card without leaving the board.
 *
 * The field stays open after each one, because adding work happens in runs —
 * that is what the standalone board this replaced got right.
 */
export function AddCard({
  label,
  onAdd,
  onClose,
}: {
  label: string;
  onAdd: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');

  return (
    <input
      className="board__add-input"
      aria-label={`New card in ${label}`}
      placeholder="Name it, then press Enter"
      // The field exists because Add was just clicked.
      autoFocus
      value={name}
      onChange={(event) => setName(event.target.value)}
      onBlur={() => {
        if (name.trim() === '') onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose();
          return;
        }
        if (event.key !== 'Enter') return;
        if (name.trim() === '') {
          onClose();
          return;
        }
        onAdd(name.trim());
        setName('');
      }}
    />
  );
}
