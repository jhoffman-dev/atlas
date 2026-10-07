import { useState, type ReactNode } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { cardChips, cardFields, plainText, type BoardRow, type PropertyKind } from '@atlas/domain';
import { useClaimFocus, type FocusFollower } from './drag/focus.ts';
import { DoneCheckbox, doneClass, type DoneTicks } from './done-checkbox.tsx';
import { chipGlyph, Icon } from './icon.tsx';
import { useNoteNames } from './note-names.tsx';
import { StatusPill } from './status-pill.tsx';

/** What a card needs to be drawn, the same in its column and under the pointer. */
export interface CardLook {
  /** Properties to show as chips, in the view's order. */
  readonly fields: readonly string[];
  readonly groupBy: string;
  /** The property a board's swimlanes are by, when the card sits in one: not repeated as a chip. */
  readonly laneBy?: string;
  /** The declared kind of each property, so a chip can say what its value is. */
  readonly kinds: Readonly<Record<string, PropertyKind>>;
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
 */
export function Card({
  row,
  look,
  onOpen,
  claimFocus,
}: {
  row: BoardRow;
  look: CardLook;
  onOpen: (path: string) => void;
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
            onClick={() => onOpen(row.path)}
          >
            {row.title}
          </button>
        }
      />
    </article>
  );
}

/** The card being dragged: a picture of it, drawn above the board. */
export function LiftedCard({ row, look }: { row: BoardRow; look: CardLook }) {
  return (
    <article className="board__card board__card--lifted" aria-hidden="true">
      <CardFace
        row={row}
        look={look}
        tick={null}
        title={<span className="board__title">{row.title}</span>}
      />
    </article>
  );
}

/**
 * What a card shows: its done box — or, for a type that has none, a tick when
 * it sits in the finished column — the title, what it is about, and its chips.
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
            <Icon name="check" size={12} />
          </span>
        )}
        {title}
      </div>
      {summary !== '' && <p className="board__summary">{summary}</p>}
      <CardFieldList row={row} look={look} />
    </>
  );
}

/** A card's fields: a choice as its pill, anything else as a chip. */
function CardFieldList({ row, look }: { row: BoardRow; look: CardLook }) {
  const { pills, chips: chipFields } = cardFields(look);
  const shownPills = pills.filter((field) => String(row.values[field] ?? '') !== '');
  const names = useNoteNames();
  const chips = cardChips({ fields: chipFields, values: row.values, kinds: look.kinds, names });
  if (shownPills.length === 0 && chips.length === 0) return null;

  return (
    <div className="board__fields">
      {shownPills.map((field) => (
        <StatusPill key={field} value={String(row.values[field])} />
      ))}
      {chips.map((chip) => (
        <span
          className={chip.you ? 'board__field board__field--you' : 'board__field'}
          key={chip.key}
          data-missing={chip.missing}
        >
          <Icon name={chipGlyph(chip.icon)} size={12} />
          {chip.text}
        </span>
      ))}
    </div>
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
