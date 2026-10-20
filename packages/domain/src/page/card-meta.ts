import type { PropertyKind } from '../types/property-def.ts';
import { noteNames, type NoteNames } from '../types/relation-names.ts';
import { cardChips, cardFields } from './card-chip.ts';
import { optionColor, optionColorsOf, type OptionColor, type OptionColors } from './pill-colour.ts';
import { optionLabel } from './status-tone.ts';

/** One value on a card's metadata line: "Phase 14", "Review", "3h". */
export interface CardMetaItem {
  readonly key: string;
  readonly text: string;
  /** For a relation: whether the note it links is missing, drawn struck through. */
  readonly missing: boolean;
  /**
   * The pill it is drawn as — a choice's colour, a linked note's hue — so the
   * eye finds it again (#413). Absent, it is plain words.
   */
  readonly color?: OptionColor;
}

/** Before the vault's notes are known, links read as their bare names. */
const UNKNOWN_NOTES = noteNames(null);

/**
 * A card's fields as the words of one metadata line — "Phase 14 · Review ·
 * 3h" — in the view's order, each field once however often the view lists
 * it. A choice is written as its label; anything else as its chip's text
 * (`cardChips`), without the icon. A choice, each of a multi-select's
 * options and each note a relation links is its own item, with the colour its
 * pill is drawn in. The column's property and the lane's are left out
 * (`cardFields`), and so is every empty value.
 */
export function cardMeta({
  fields,
  groupBy,
  laneBy,
  kinds = {},
  values,
  names = UNKNOWN_NOTES,
  colors = {},
}: {
  fields: readonly string[];
  groupBy?: string | null;
  laneBy?: string | null;
  kinds?: Readonly<Record<string, PropertyKind>>;
  values: Readonly<Record<string, unknown>>;
  names?: NoteNames;
  /** The colours each select's type chose for its options (`optionColorsByKey`). */
  colors?: Readonly<Record<string, OptionColors>>;
}): CardMetaItem[] {
  const { pills, chips } = cardFields({
    fields,
    kinds,
    ...(groupBy !== undefined && { groupBy }),
    ...(laneBy !== undefined && { laneBy }),
  });
  const byKey = new Map<string, CardMetaItem[]>();
  for (const field of pills) {
    const text = choiceLabel(values[field]);
    if (text === '') continue;
    const color = optionColor(
      { key: field, colors: optionColorsOf(colors, field) },
      String(values[field]),
    );
    byKey.set(field, [{ key: field, text, missing: false, color }]);
  }
  for (const field of chips) {
    const items = cardChips({ fields: [field], values, kinds, names, colors }).map((chip) => ({
      key: chip.key,
      text: chip.text,
      missing: chip.missing === true,
      ...(chip.color !== undefined && { color: chip.color }),
    }));
    byKey.set(field, items);
  }
  return fields.flatMap((field) => {
    const items = byKey.get(field) ?? [];
    byKey.delete(field);
    return items;
  });
}

/** A choice as it is written: its label — or nothing, for a value that is not a choice. */
function choiceLabel(value: unknown): string {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' ? optionLabel(value) : '';
}
