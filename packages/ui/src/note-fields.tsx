import {
  cardChips,
  cardFields,
  optionColor,
  type BoardRow,
  type OptionColors,
  type PropertyKind,
} from '@atlas/domain';
import { chipGlyph, Icon } from './icon.tsx';
import { useNoteNames } from './note-names.tsx';
import { StatusPill, TintedPill } from './status-pill.tsx';

const NO_COLORS: Readonly<Record<string, OptionColors>> = {};

/**
 * The fields beside a note in a list, a gallery or a feed, drawn as the board
 * draws them: a choice, a multi-select's options and a relation's notes as
 * pills in their colours, anything else as a chip that says what its value is.
 */
export function NoteFields({
  row,
  fields,
  kinds = {},
  colors = NO_COLORS,
  className,
}: {
  row: BoardRow;
  /** The view's columns, in its order. */
  fields: readonly string[];
  /** The declared kind of each property, so a value is drawn as what it is. */
  kinds?: Readonly<Record<string, PropertyKind>>;
  /** The colours each select's type chose for its options. */
  colors?: Readonly<Record<string, OptionColors>>;
  className: string;
}) {
  const { pills, chips: chipFields } = cardFields({ fields, kinds });
  const shownPills = pills.filter((field) => String(row.values[field] ?? '') !== '');
  const names = useNoteNames();
  const chips = cardChips({ fields: chipFields, values: row.values, kinds, names, colors });
  if (shownPills.length === 0 && chips.length === 0) return null;

  return (
    <span className={className}>
      {shownPills.map((field) => {
        const value = String(row.values[field]);
        return (
          <StatusPill
            key={field}
            value={value}
            tone={optionColor({ colors: colors[field] }, value)}
          />
        );
      })}
      {chips.map((chip) =>
        chip.color === undefined ? (
          <span
            className={chip.you ? 'note-chip note-chip--you' : 'note-chip'}
            key={chip.key}
            data-missing={chip.missing}
          >
            <Icon name={chipGlyph(chip.icon)} size={12} />
            {chip.text}
          </span>
        ) : (
          <TintedPill key={chip.key} text={chip.text} color={chip.color} />
        ),
      )}
    </span>
  );
}
