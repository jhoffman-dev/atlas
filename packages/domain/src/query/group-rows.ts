import { splitWikiLinks } from '../markdown/wikilink.ts';
import { statusTone, type StatusTone } from '../page/status-tone.ts';
import { noteNames, type NoteNames } from '../types/relation-names.ts';

/**
 * Turning a view's rows into board columns.
 *
 * Columns follow the order the type declares its options in, so a board reads
 * left to right the way the workflow does rather than alphabetically. Values the
 * type does not declare still get a column — the file is the truth, and hiding a
 * card because its status was typed by hand would lose work.
 */
export interface BoardRow {
  readonly path: string;
  readonly title: string;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface BoardColumn {
  /** The property value this column holds, or null for the cards without one. */
  readonly value: string | null;
  readonly label: string;
  readonly rows: readonly BoardRow[];
  /**
   * The tone the column's heading is drawn in. Null for a column that is not a
   * status at all — a project, say — which is drawn as a plain label. Absent,
   * the heading is toned by its name.
   */
  readonly tone?: StatusTone | null;
}

/**
 * What a board groups by. `option` for a select, whose value is the column;
 * `relation` for a link to another note, whose column is that note.
 */
export type GroupingKind = 'option' | 'relation';

/** What a column with no value is called. */
export const UNGROUPED_LABEL = 'No value';

export function toBoardRows({
  columns,
  rows,
}: {
  columns: readonly string[];
  rows: readonly (readonly unknown[])[];
}): BoardRow[] {
  const pathAt = columns.indexOf('path');
  const titleAt = columns.indexOf('title');

  return rows.map((row, index) => ({
    path: pathAt === -1 ? String(index) : String(row[pathAt] ?? ''),
    title: titleAt === -1 ? '' : String(row[titleAt] ?? ''),
    values: Object.fromEntries(columns.map((column, at) => [column, row[at]])),
  }));
}

export function groupRows({
  rows,
  groupBy,
  options,
  grouping = 'option',
  colors = {},
  names = noteNames(null),
}: {
  rows: readonly BoardRow[];
  groupBy: string;
  /** The values the type declares, in the order they should appear. */
  options: readonly string[];
  grouping?: GroupingKind;
  /** Tones the type chose for its options; the rest are toned by name. */
  colors?: Readonly<Record<string, StatusTone>>;
  /** The vault's notes, which a relation's columns are named by. */
  names?: NoteNames;
}): BoardColumn[] {
  const spelling = SPELLINGS[grouping];
  const toneOf = (value: string): StatusTone | null =>
    grouping === 'relation' ? null : (colors[value] ?? statusTone(value));

  // A column is keyed by what its value means, so a repeated option — or one
  // note linked two ways — cannot be two columns. The first spelling seen of a
  // key is the value a card moved there is given.
  const values = new Map<string, string>();
  const remember = (raw: string): string | null => {
    const key = spelling.key(raw);
    if (key !== null && !values.has(key)) values.set(key, spelling.value(raw));
    return key;
  };
  const declared = [...new Set(options.map(remember))].filter((key) => key !== null);

  const found = new Map<string | null, BoardRow[]>();
  for (const row of rows) {
    const raw = row.values[groupBy];
    const key = raw === null || raw === undefined ? null : remember(String(raw));
    const column = found.get(key);
    if (column === undefined) found.set(key, [row]);
    else column.push(row);
  }
  const isDeclared = new Set(declared);

  const labelOf = (key: string): string => spelling.label(values.get(key) ?? key, names);
  // Declared first, in order; then anything else the files contain; then the
  // cards with no value at all.
  const extras = [...found.keys()]
    .filter((key): key is string => key !== null && !isDeclared.has(key))
    .sort((left, right) => labelOf(left).localeCompare(labelOf(right)));

  const columns: BoardColumn[] = [...declared, ...extras].map((key) => {
    const value = values.get(key) ?? key;
    return { value, label: labelOf(key), rows: found.get(key) ?? [], tone: toneOf(value) };
  });

  // Only shown when something is actually in it: an empty column for "no value"
  // is noise on a board where every card has one.
  const ungrouped = found.get(null) ?? [];
  if (ungrouped.length > 0) {
    columns.push({ value: null, label: UNGROUPED_LABEL, rows: ungrouped, tone: null });
  }

  return columns;
}

/**
 * What makes two values one column: the key a value is grouped under, or null
 * for "No value". A card is in a column exactly when its value has its key.
 */
export function groupingKey(grouping: GroupingKind, raw: string): string | null {
  return SPELLINGS[grouping].key(raw);
}

/** How a grouping reads a value: what makes two values one column, and what each is called. */
interface Spelling {
  key(raw: string): string | null;
  value(raw: string): string;
  label(value: string, names: NoteNames): string;
}

/**
 * One key however the value is encoded: `Café` typed on one Mac and pasted
 * from another can arrive composed (NFC) or decomposed (NFD). Only the key is
 * normalised — the value a card is given is a spelling the files hold.
 */
function trimmedOrNull(raw: string): string | null {
  const text = raw.trim().normalize('NFC');
  return text === '' ? null : text;
}

/** The first link in a relation's value — a card linked to several is grouped under the first. */
function firstLink(raw: string) {
  const piece = splitWikiLinks(raw.trim()).find((candidate) => candidate.kind === 'wikiLink');
  return piece?.kind === 'wikiLink' ? piece : null;
}

/** The note's name, whatever folder the link spells out. */
const noteName = (target: string): string => target.split('/').at(-1)?.trim() ?? '';

const SPELLINGS: Readonly<Record<GroupingKind, Spelling>> = {
  option: {
    key: trimmedOrNull,
    value: (raw) => raw.trim(),
    label: (value) => value,
  },
  relation: {
    // `[[Atlas]]`, `[[projects/Atlas]]` and `[[atlas|The app]]` are one note,
    // so they are one column.
    key: (raw) => {
      const link = firstLink(raw);
      if (link === null) return trimmedOrNull(raw);
      const name = noteName(link.target).normalize('NFC').toLowerCase();
      return name === '' ? null : name;
    },
    // A card moved into the column is given the link alone.
    value: (raw) => {
      const link = firstLink(raw);
      return link === null ? raw.trim() : `[[${link.target}]]`;
    },
    // Named for the note it points at, never shown as a link.
    label: (value, names) => {
      const link = firstLink(value);
      return link === null ? value.trim() : names.name(link).text;
    },
  },
};
