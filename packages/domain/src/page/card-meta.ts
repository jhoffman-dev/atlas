import type { PropertyKind } from '../types/property-def.ts';
import type { NoteNames } from '../types/relation-names.ts';
import { cardChips, cardFields } from './card-chip.ts';
import { optionLabel } from './status-tone.ts';

/** One value on a card's metadata line: "Phase 14", "Review", "3h". */
export interface CardMetaItem {
  readonly key: string;
  readonly text: string;
  /** For a relation: whether every note it links is missing, drawn struck through. */
  readonly missing: boolean;
}

/**
 * A card's fields as the words of one metadata line — "Phase 14 · Review ·
 * 3h" — in the view's order, each field once however often the view lists
 * it. A choice is written as its label; anything else as its chip's text
 * (`cardChips`), without the icon. The column's property and the lane's are
 * left out (`cardFields`), and so is every empty value.
 */
export function cardMeta({
  fields,
  groupBy,
  laneBy,
  kinds = {},
  values,
  names,
}: {
  fields: readonly string[];
  groupBy?: string | null;
  laneBy?: string | null;
  kinds?: Readonly<Record<string, PropertyKind>>;
  values: Readonly<Record<string, unknown>>;
  names?: NoteNames;
}): CardMetaItem[] {
  const { pills, chips } = cardFields({
    fields,
    kinds,
    ...(groupBy !== undefined && { groupBy }),
    ...(laneBy !== undefined && { laneBy }),
  });
  const byKey = new Map<string, CardMetaItem>();
  for (const field of pills) {
    const text = choiceLabel(values[field]);
    if (text !== '') byKey.set(field, { key: field, text, missing: false });
  }
  const chipItems = cardChips({
    fields: chips,
    values,
    kinds,
    ...(names !== undefined && { names }),
  });
  for (const chip of chipItems) {
    byKey.set(chip.key, { key: chip.key, text: chip.text, missing: chip.missing === true });
  }
  return fields.flatMap((field) => {
    const item = byKey.get(field);
    if (item === undefined) return [];
    byKey.delete(field);
    return [item];
  });
}

/** A choice as it is written: its label — or nothing, for a value that is not a choice. */
function choiceLabel(value: unknown): string {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' ? optionLabel(value) : '';
}
