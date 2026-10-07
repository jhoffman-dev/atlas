/**
 * Turning fetched records into notes, without losing what you wrote on them.
 *
 * A note produced by a source is still your note: you can open it, write under
 * it and link to it. So a refresh never overwrites a body you have changed. It
 * knows the difference because it records a digest of the body it last wrote —
 * if the body still matches, it is Atlas's to replace; if it does not, it is
 * yours to keep.
 *
 * The other half of that promise is the path. A record's note is identified by
 * the path its key computes to, so two records can never plan two writes to one
 * file, and a note that already exists is never created over. The computation
 * is a pure function of the key: the same feed gives the same notes on every
 * run and every machine.
 */

import { createVaultPath, joinVaultPath, type VaultPath } from '../vault/vault-path.ts';
import {
  MAX_RECORDS,
  SOURCE_DIGEST_KEY,
  SOURCE_KEY_KEY,
  SOURCE_MISSING_KEY,
  SOURCE_PATH_KEY,
  type Datasource,
} from './datasource.ts';
import type { SourceRecord } from './records.ts';

/** A note a source already produced, as the refresh needs to see it. */
export interface ExistingSourceNote {
  readonly path: string;
  /** The record it was made from. */
  readonly key: string;
  /** The digest of the body Atlas last wrote into it. */
  readonly digest: string;
  /** What the body says now. */
  readonly body: string;
}

/**
 * One note a refresh writes.
 *
 * A property set to null is one to take off the note, which is how a mark the
 * last refresh left is cleared; everything else is written as it reads.
 */
export type SourceWrite =
  | {
      readonly kind: 'create';
      readonly path: string;
      readonly properties: Readonly<Record<string, unknown>>;
      readonly body: string;
    }
  /** The whole note is Atlas's to replace: you have not touched the body. */
  | {
      readonly kind: 'replace';
      readonly path: string;
      readonly properties: Readonly<Record<string, unknown>>;
      readonly body: string;
    }
  /** You edited this one, so only the properties the source owns are written. */
  | {
      readonly kind: 'properties';
      readonly path: string;
      readonly properties: Readonly<Record<string, unknown>>;
    };

export interface SourcePlan {
  readonly writes: readonly SourceWrite[];
  /** Notes whose record is no longer in the feed. Marked, never deleted. */
  readonly missing: readonly string[];
  /** Records with nothing in the key field, which cannot be followed over time. */
  readonly unkeyed: number;
  /** True when the feed was longer than one refresh is allowed to write. */
  readonly truncated: boolean;
}

/**
 * A stable digest of a body.
 *
 * FNV-1a: not a security hash, and not meant to be. It answers one question —
 * is this the text we wrote? — and it has to give the same answer on every
 * machine and every run, which rules out anything with a random seed.
 */
export function digestOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const EXTENSION = '.md';
/** What a key with no usable characters left in it is called. */
const FALLBACK_NAME = 'record';
/** `-` and the eight hex characters `digestOf` returns. */
const DIGEST_LENGTH = 9;
/** `-` and up to four digits, for the numbering `availablePath` may add. */
const NUMBERING_LENGTH = 5;
/** Filenames stop at 255 bytes almost everywhere, and every name built here
 * is ASCII, so its length in characters is its length in bytes. */
const MAX_BASE_LENGTH = 255 - EXTENSION.length - DIGEST_LENGTH - NUMBERING_LENGTH;

/**
 * The file a record lands in — a pure function of the folder and the key, so a
 * feed lands in the same notes on every run and every machine.
 *
 * The key goes into a filename, so anything a path could take badly is replaced
 * and a leading dot is dropped, which means the replacement is lossy: `acme
 * corp`, `acme/corp` and `acme-corp` all reduce to the same letters, and a key
 * with nothing ASCII in it reduces to nothing at all. A key that is already a
 * filename keeps it; every other key is told apart by a digest of the key it
 * came from, because two records sharing a path is how a refresh overwrites a
 * note it should have left alone.
 *
 * `into` goes through `createVaultPath`, so a folder that climbs out of the
 * vault is refused here rather than trusted and written to.
 */
export function notePathFor({ into, key }: { into: string; key: string }): VaultPath {
  return joinVaultPath(createVaultPath(into), noteFileNameFor(key));
}

function noteFileNameFor(key: string): string {
  const safe = key.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  if (safe === key && key.length <= MAX_BASE_LENGTH) return `${key}${EXTENSION}`;

  const base = (safe === '' ? FALLBACK_NAME : safe).slice(0, MAX_BASE_LENGTH);
  return `${base}-${digestOf(key)}${EXTENSION}`;
}

/**
 * `path`, or the first numbered variant of it that nothing has taken:
 * `imported/acme-corp.md`, then `imported/acme-corp-2.md`, the way Finder
 * numbers copies. Nothing is ever written over, whether it was another record's
 * note or one you made yourself.
 */
function availablePath(path: VaultPath, taken: ReadonlySet<string>): VaultPath {
  if (!taken.has(path)) return path;

  const base = path.slice(0, -EXTENSION.length);
  for (let attempt = 2; ; attempt += 1) {
    const candidate = `${base}-${attempt}${EXTENSION}`;
    if (!taken.has(candidate)) return candidate as VaultPath;
  }
}

export function planRefresh({
  source,
  sourcePath,
  records,
  existing,
}: {
  source: Datasource;
  /** The source note itself, written onto everything it produces. */
  sourcePath: string;
  records: readonly SourceRecord[];
  existing: readonly ExistingSourceNote[];
}): SourcePlan {
  const known = notesByKey(existing);
  const examined = records.slice(0, MAX_RECORDS);
  const seen = new Set<string>();
  const taken = new Set<string>(existing.map((note) => note.path));
  const written = new Set<string>();
  const writes: SourceWrite[] = [];
  let unkeyed = 0;

  for (const record of examined) {
    const key = (record[source.key] ?? '').trim();
    if (key === '') {
      unkeyed += 1;
      continue;
    }
    // A feed that repeats a key would otherwise have its later copies overwrite
    // its earlier ones, one refresh at a time. The first wins, consistently.
    if (seen.has(key)) continue;
    seen.add(key);

    const body = source.body === null ? '' : (record[source.body] ?? '');
    const properties = {
      type: source.type,
      title: (record[source.name] ?? key).trim(),
      ...mapped(record, source.map),
      [SOURCE_PATH_KEY]: sourcePath,
      [SOURCE_KEY_KEY]: key,
      [SOURCE_DIGEST_KEY]: digestOf(body),
      // The record is here, so the note is not missing. Marking is only half a
      // rule without its inverse: a note that was away for a day would keep
      // the mark for good, and every view filtering on it would go on hiding
      // it. Cleared by removing the key rather than by writing `false`, so a
      // note that was never missing does not collect a property saying so.
      [SOURCE_MISSING_KEY]: null,
    };

    // Several notes can carry one key, so the first by path is this record's
    // and the rest are reported like any other note the feed no longer has.
    const [already] = known.get(key) ?? [];
    if (already === undefined) {
      const path = availablePath(notePathFor({ into: source.into, key }), taken);
      taken.add(path);
      writes.push({ kind: 'create', path, properties, body });
    } else if (already.digest === digestOf(already.body)) {
      written.add(already.path);
      writes.push({ kind: 'replace', path: already.path, properties, body });
    } else {
      // You wrote something here. The feed's fields are still refreshed; the
      // digest is not, so the note goes on being yours until you clear it.
      const keepingYourBody = Object.fromEntries(
        Object.entries(properties).filter(([property]) => property !== SOURCE_DIGEST_KEY),
      );
      written.add(already.path);
      writes.push({ kind: 'properties', path: already.path, properties: keepingYourBody });
    }
  }

  // Past the cap the records were never looked at, so a note whose key is
  // waiting in that tail is still in the feed — marking it missing would write
  // `atlas_source_missing` onto a note that is perfectly current.
  const waiting = new Set(
    records
      .slice(MAX_RECORDS)
      .map((record) => (record[source.key] ?? '').trim())
      .filter((key) => key !== '' && !seen.has(key)),
  );
  const missing = existing
    .filter((note) => !written.has(note.path) && !waiting.has(note.key))
    .map((note) => note.path)
    .sort();

  return { writes, missing, unkeyed, truncated: records.length > MAX_RECORDS };
}

/**
 * The existing notes for each key, lowest path first.
 *
 * Two notes sharing a key was easy to arrive at while keys collided on a path,
 * and a map of one note per key made the loser invisible: never written, and
 * never reported either.
 */
function notesByKey(existing: readonly ExistingSourceNote[]): Map<string, ExistingSourceNote[]> {
  const byKey = new Map<string, ExistingSourceNote[]>();
  // Sorted by code unit rather than by locale, so the note a refresh picks does
  // not depend on which machine it runs on.
  for (const note of [...existing].sort((one, other) => (one.path < other.path ? -1 : 1))) {
    byKey.set(note.key, [...(byKey.get(note.key) ?? []), note]);
  }
  return byKey;
}

/** What a note whose record has gone should say, so it is marked not deleted. */
export function missingProperties(): Readonly<Record<string, unknown>> {
  return { [SOURCE_MISSING_KEY]: true };
}

/**
 * The properties a refresh owns. A mapped field that took one of these would
 * break the note's identity — a record whose `atlas_source_key` came from the
 * feed is a record the next refresh cannot find again, and writes a second note
 * for.
 */
const RESERVED_PROPERTIES: readonly string[] = [
  'type',
  SOURCE_PATH_KEY,
  SOURCE_KEY_KEY,
  SOURCE_DIGEST_KEY,
  SOURCE_MISSING_KEY,
];

function mapped(
  record: SourceRecord,
  map: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const fields = Object.entries(map)
    .filter(([, to]) => !RESERVED_PROPERTIES.includes(to))
    .map(([from, to]): [string, string | undefined] => [to, record[from]])
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '');
  // Built from entries rather than assigned, so a property named `__proto__`
  // is written as a property instead of reaching the prototype setter.
  return Object.fromEntries(fields);
}
