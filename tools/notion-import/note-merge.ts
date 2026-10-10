import { createHash } from 'node:crypto';

/**
 * What the last run brought in for one Notion page: a digest of each
 * property's value as Notion gave it, and of the page's body. A digest is
 * enough to tell whether a note still holds what was imported, and keeps the
 * record small.
 */
export interface ImportedPage {
  readonly fields: Readonly<Record<string, string>>;
  readonly body: string;
}

/** The digest of a value that says nothing: absent, empty, or a list of nothing. */
export const NOTHING = 'nothing';

const isNothing = (value: unknown) =>
  value === null ||
  value === undefined ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

const digestOf = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** A property's value as the record compares it. */
export const valueDigest = (value: unknown): string =>
  isNothing(value) ? NOTHING : digestOf(JSON.stringify(value));

/** A body as the record compares it: the blank lines around it are not the person's words. */
export const bodyDigest = (body: string): string =>
  body.trim() === '' ? NOTHING : digestOf(body.trim());

/** What a page should be in the vault, by Notion's say. */
export interface WantedContent {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly fillOnly: Readonly<Record<string, unknown>>;
  readonly body: string;
}

/** A note as it is in the vault now. */
export interface NoteNow {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly body: string;
}

/** What to change in a note so it follows Notion, and what was left as Atlas has it. */
export interface Merge {
  /** Properties to set; a null removes the key. */
  readonly changes: Readonly<Record<string, unknown>>;
  /** The new body, or null to leave it as it is. */
  readonly body: string | null;
  /** Properties (and `body`) changed both in Atlas and in Notion since the last run: Atlas's is kept. */
  readonly kept: readonly string[];
  /** What this run brought in, for the record. */
  readonly imported: ImportedPage;
}

/** One value's three sides: what was imported last, what the note holds, what Notion says now. */
interface Sides {
  readonly last: string;
  readonly now: string;
  readonly notion: string;
}

/**
 * What one value comes to. A side that has not moved since the last run
 * gives way to the side that has: Notion's change is written where Atlas
 * left the value alone, and an edit made in Atlas stands while Notion's
 * value has not changed. When both have changed, to different values, the
 * note keeps Atlas's and the value is listed: never written over.
 */
function settle({ last, now, notion }: Sides): 'same' | 'take' | 'keep' | 'kept' {
  if (now === notion) return 'same';
  if (now === last) return 'take';
  if (notion === last) return 'keep';
  return 'kept';
}

/**
 * A three-way merge of one note: the last import (from the record), the note
 * as it is, and Notion now. With no record of a last import — a note an
 * earlier, one-off import made — nothing is known to have been imported, so
 * only what the note lacks is filled in and every other difference is kept
 * and listed. Each Notion value is recorded once it has been offered, so a
 * difference is listed when it appears, and a run with nothing new in
 * Notion changes nothing.
 */
export function mergeNote(args: {
  readonly now: NoteNow;
  readonly wanted: WantedContent;
  readonly last: ImportedPage | null;
}): Merge {
  const { now, wanted, last } = args;
  const changes: Record<string, unknown> = {};
  const kept: string[] = [];
  const fields: Record<string, string> = {};
  const keys = new Set([...Object.keys(wanted.fields), ...Object.keys(last?.fields ?? {})]);
  for (const key of keys) {
    const notion = valueDigest(wanted.fields[key]);
    const sides = {
      last: last?.fields[key] ?? NOTHING,
      now: valueDigest(now.properties[key]),
      notion,
    };
    const outcome = settle(sides);
    if (outcome === 'take') changes[key] = wanted.fields[key] ?? null;
    if (outcome === 'kept') kept.push(key);
    if (notion !== NOTHING) fields[key] = notion;
  }
  for (const [key, value] of Object.entries(wanted.fillOnly)) {
    if (valueDigest(now.properties[key]) === NOTHING) changes[key] = value;
  }
  const notionBody = bodyDigest(wanted.body);
  const body = settle({
    last: last?.body ?? NOTHING,
    now: bodyDigest(now.body),
    notion: notionBody,
  });
  if (body === 'kept') kept.push('body');
  return {
    changes,
    body: body === 'take' ? wanted.body : null,
    kept,
    imported: { fields, body: notionBody },
  };
}

/** The record of a note this run makes afresh. */
export function importedAs(wanted: WantedContent): ImportedPage {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(wanted.fields)) {
    if (!isNothing(value)) fields[key] = valueDigest(value);
  }
  return { fields, body: bodyDigest(wanted.body) };
}
