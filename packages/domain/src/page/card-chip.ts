import type { PropertyKind } from '../types/property-def.ts';
import { linkedNames, noteNames, withNoteNames, type NoteNames } from '../types/relation-names.ts';
import { formatPropertyDate } from './property-date.ts';
import { humanizeKey } from './property-label.ts';
import { isYou, propertyRole } from './property-role.ts';

/** The glyphs a card's chip can carry, named for what they mean. */
export type ChipIcon = 'hash' | 'person' | 'clock' | 'date' | 'tag' | 'note';

/** One labelled property on a board card: "Phase 14", "From you", "3h". */
export interface CardChip {
  readonly key: string;
  readonly icon: ChipIcon;
  readonly text: string;
  /** Names the person using the vault, which is drawn in the accent. */
  readonly you: boolean;
  /** For a relation: whether every note it links is missing, drawn struck through. */
  readonly missing?: boolean;
}

/** Before the vault's notes are known, links read as their bare names. */
const UNKNOWN_NOTES = noteNames(null);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
/** A value written as a slug — `bug-fixer` — rather than as words. */
const SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/**
 * A property as a chip a person can read without the column heading a table
 * would give it: a bare `14` says nothing on a card, "Phase 14" does.
 *
 * Empty values, and a checkbox left unticked, make no chip.
 */
export function cardChip({
  key,
  value,
  kind,
  names = UNKNOWN_NOTES,
}: {
  key: string;
  value: unknown;
  /** The property's declared kind, when the view's type declares it. */
  kind?: PropertyKind;
  /** The vault's notes, which a relation's links are named by. */
  names?: NoteNames;
}): CardChip | null {
  if (value === null || value === undefined || value === false) return null;
  const text = String(value).trim();
  if (text === '') return null;

  // A relation is the notes it links, never `[[…]]` — whatever its key says.
  const linked = linkedNames(value, names);
  if (linked.length > 0) {
    return {
      key,
      icon: 'note',
      text: withNoteNames(value, names),
      you: false,
      missing: linked.every((link) => link.missing),
    };
  }

  const chip = (icon: ChipIcon, label: string, you = false): CardChip => ({
    key,
    icon,
    text: label,
    you,
  });

  const role = propertyRole(key);
  if (role === 'person') {
    if (isYou(text)) return chip('person', key === 'source' ? 'From you' : 'You', true);
    return chip('person', SLUG.test(text) ? humanizeKey(text) : text);
  }
  if (role === 'duration') return chip('clock', text);
  if (kind === 'checkbox') return isTicked(text) ? chip('tag', humanizeKey(key)) : null;
  if (value === true) return chip('tag', humanizeKey(key));
  if (kind === 'date' || (kind === undefined && ISO_DATE.test(text))) {
    return chip('date', formatPropertyDate(text) ?? text);
  }
  if (kind === 'number' || typeof value === 'number') {
    return chip('hash', `${humanizeKey(key)} ${text}`);
  }
  return chip('tag', text);
}

/** The chips a card shows, in the order its view lists the fields. */
export function cardChips({
  fields,
  values,
  kinds = {},
  names = UNKNOWN_NOTES,
}: {
  fields: readonly string[];
  values: Readonly<Record<string, unknown>>;
  kinds?: Readonly<Record<string, PropertyKind>>;
  names?: NoteNames;
}): CardChip[] {
  return fields
    .map((key) => {
      const kind = kinds[key];
      return cardChip({ key, value: values[key], names, ...(kind === undefined ? {} : { kind }) });
    })
    .filter((chip) => chip !== null);
}

/** Keys a card shows in a place of its own — the title, the summary — or, the path, not at all. */
const OWN_PLACE: readonly string[] = ['path', 'title', 'summary'];

/** A card's fields, by how each is drawn. */
export interface CardFields {
  /** Choices, drawn as their status pill. */
  readonly pills: readonly string[];
  /** Everything else, drawn as a chip (`cardChips`). */
  readonly chips: readonly string[];
}

/**
 * Which of a view's fields a card shows, and how, in the view's order — the
 * same on a board and in a list. The property a board groups by is the column
 * the card sits in, and the one its lanes are by is the lane, so neither is
 * repeated on the card.
 */
export function cardFields({
  fields,
  groupBy = null,
  laneBy = null,
  kinds = {},
}: {
  fields: readonly string[];
  groupBy?: string | null;
  /** The property a board's swimlanes are by: like the column's, the lane already says it. */
  laneBy?: string | null;
  kinds?: Readonly<Record<string, PropertyKind>>;
}): CardFields {
  const shown = fields.filter(
    (field) => !OWN_PLACE.includes(field) && field !== groupBy && field !== laneBy,
  );
  return {
    pills: shown.filter((field) => kinds[field] === 'select'),
    chips: shown.filter((field) => kinds[field] !== 'select'),
  };
}

/** The index keeps a checkbox as its text, so an unticked one arrives as "false". */
function isTicked(text: string): boolean {
  return text !== 'false' && text !== '0';
}
