import { cardChips, cardFields, type BoardRow, type PropertyKind } from '@atlas/domain';
import { chipGlyph, Icon } from './icon.tsx';
import { useNoteNames } from './note-names.tsx';
import { StatusPill } from './status-pill.tsx';

/**
 * The fields beside a note in a list, a gallery or a feed, drawn as the board
 * draws them: a choice as its status pill, anything else as a chip that says
 * what its value is.
 */
export function NoteFields({
  row,
  fields,
  kinds = {},
  className,
}: {
  row: BoardRow;
  /** The view's columns, in its order. */
  fields: readonly string[];
  /** The declared kind of each property, so a value is drawn as what it is. */
  kinds?: Readonly<Record<string, PropertyKind>>;
  className: string;
}) {
  const { pills, chips: chipFields } = cardFields({ fields, kinds });
  const shownPills = pills.filter((field) => String(row.values[field] ?? '') !== '');
  const names = useNoteNames();
  const chips = cardChips({ fields: chipFields, values: row.values, kinds, names });
  if (shownPills.length === 0 && chips.length === 0) return null;

  return (
    <span className={className}>
      {shownPills.map((field) => (
        <StatusPill key={field} value={String(row.values[field])} />
      ))}
      {chips.map((chip) => (
        <span
          className={chip.you ? 'note-chip note-chip--you' : 'note-chip'}
          key={chip.key}
          data-missing={chip.missing}
        >
          <Icon name={chipGlyph(chip.icon)} size={12} />
          {chip.text}
        </span>
      ))}
    </span>
  );
}
