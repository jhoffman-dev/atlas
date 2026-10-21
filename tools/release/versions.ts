/*
 * The app's version, one number in many files (issue #481). The root
 * package.json is the source of truth; `pnpm version:set` writes it into the
 * rest, and `pnpm version:check` fails CI when any of them disagree. These are
 * the rules, on file text; `version.mjs` does the reading and writing.
 *
 * Every write changes the version and nothing else, so a bump is a diff of one
 * line per file and the formatter has nothing to say about it.
 */

export type VersionFileKind = 'package-json' | 'tauri-conf' | 'cargo-toml' | 'cargo-lock';

export interface VersionFile {
  /** Repo-relative, for messages. */
  readonly path: string;
  readonly kind: VersionFileKind;
  readonly text: string;
}

export interface Disagreement {
  readonly path: string;
  /** Null when the file has no version to read. */
  readonly found: string | null;
}

export class InvalidVersionError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidVersionError';
  }
}

/** Semver, optionally pre-release; no leading zeros, as the spec requires. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const BUMPS = ['major', 'minor', 'patch'] as const;
type Bump = (typeof BUMPS)[number];

interface Parsed {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly pre: string | null;
}

function parse(version: string): Parsed {
  const match = SEMVER.exec(version);
  if (match === null) throw new InvalidVersionError(`"${version}" is not a semver version`);
  const [, major, minor, patch, pre] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch), pre: pre ?? null };
}

/** Negative, zero or positive as `a` is before, equal to or after `b`. Pre-release before release. */
function compare(a: Parsed, b: Parsed): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (core !== 0) return core;
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return comparePre(a.pre.split('.'), b.pre.split('.'));
}

/** Semver's pre-release order: numbers by value and before words, words by ASCII, shorter first. */
function comparePre(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const [x, y] = [a[i]!, b[i]!];
    if (x === y) continue;
    const [xNum, yNum] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (xNum && yNum) return Number(x) - Number(y);
    if (xNum !== yNum) return xNum ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return a.length - b.length;
}

function bump(current: Parsed, part: Bump): string {
  if (current.pre !== null) {
    throw new InvalidVersionError('a pre-release has no one next version; set it exactly');
  }
  if (part === 'major') return `${current.major + 1}.0.0`;
  if (part === 'minor') return `${current.major}.${current.minor + 1}.0`;
  return `${current.major}.${current.minor}.${current.patch + 1}`;
}

/** The version after `current`: a bump (`major`, `minor`, `patch`) or an exact later version. */
export function nextVersion(current: string, request: string): string {
  const from = parse(current);
  if ((BUMPS as readonly string[]).includes(request)) return bump(from, request as Bump);
  if (compare(parse(request), from) <= 0) {
    throw new InvalidVersionError(`${request} does not come after ${current}`);
  }
  return request;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The `[package]` table of a Cargo.toml: from its header to the next table. */
function packageTable(text: string): { start: number; end: number } | null {
  const header = /^\[package\]\s*$/m.exec(text);
  if (header === null) return null;
  const start = header.index + header[0].length;
  const next = /^\[/m.exec(text.slice(start));
  return { start, end: next === null ? text.length : start + next.index };
}

/** The app crate's name in its Cargo.toml, which is how Cargo.lock lists it. */
export function cargoCrateName(file: VersionFile): string {
  const table = packageTable(file.text);
  const name = table && /^name = "([^"]+)"/m.exec(file.text.slice(table.start, table.end));
  if (!name) throw new Error(`${file.path} has no [package] name`);
  return name[1]!;
}

/** Where the version string sits in the file: its start and end offsets. */
function locate(file: VersionFile, crate: string): { start: number; end: number } | null {
  switch (file.kind) {
    case 'package-json':
    case 'tauri-conf':
      return locateJson(file.text);
    case 'cargo-toml': {
      const table = packageTable(file.text);
      if (table === null) return null;
      const found = locateIn(file.text.slice(table.start, table.end), /^version = "([^"]*)"/m);
      return found && { start: table.start + found.start, end: table.start + found.end };
    }
    case 'cargo-lock':
      return locateIn(
        file.text,
        new RegExp(`^\\[\\[package\\]\\]\\nname = "${escape(crate)}"\\nversion = "([^"]*)"`, 'm'),
      );
  }
}

function locateIn(text: string, pattern: RegExp): { start: number; end: number } | null {
  const match = pattern.exec(text);
  if (match === null) return null;
  const end = match.index + match[0].length - 1;
  return { start: end - match[1]!.length, end };
}

/** Stands in for the version while a candidate is checked; plain, so the JSON stays valid. */
const PROBE = 'atlas-version-probe';

/**
 * The top-level `"version"` of a JSON file. Found by text so the rest of the
 * file is left byte for byte, then confirmed by parsing: a nested `"version"`
 * listed first is skipped rather than rewritten.
 */
function locateJson(text: string): { start: number; end: number } | null {
  const pattern = /"version"\s*:\s*"([^"]*)"/g;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const end = match.index + match[0].length - 1;
    const at = { start: end - match[1]!.length, end };
    const probed = `${text.slice(0, at.start)}${PROBE}${text.slice(at.end)}`;
    if ((JSON.parse(probed) as { version?: unknown }).version === PROBE) return at;
  }
  return null;
}

function missing(file: VersionFile, crate: string): Error {
  const where = file.kind === 'cargo-lock' ? ` for the crate "${crate}"` : '';
  return new Error(`${file.path} has no version${where}`);
}

/** The app version this file holds. `crate` names the package to read in Cargo.lock. */
export function readVersion(file: VersionFile, crate: string): string {
  const at = locate(file, crate);
  if (at === null) throw missing(file, crate);
  return file.text.slice(at.start, at.end);
}

/** The file's text with its app version set to `version`, and nothing else changed. */
export function writeVersion(file: VersionFile, version: string, crate: string): string {
  parse(version);
  const at = locate(file, crate);
  if (at === null) throw missing(file, crate);
  return `${file.text.slice(0, at.start)}${version}${file.text.slice(at.end)}`;
}

/** Each file whose version is not `expected`, with what it has instead. */
export function disagreements(
  files: readonly VersionFile[],
  expected: string,
  crate: string,
): Disagreement[] {
  return files.flatMap((file) => {
    const at = locate(file, crate);
    const found = at === null ? null : file.text.slice(at.start, at.end);
    return found === expected ? [] : [{ path: file.path, found }];
  });
}

/** Why a release tag does not name `version`, or null when it does (`v` + the version). */
export function tagMismatch(tag: string, version: string): string | null {
  const name = tag.replace(/^refs\/tags\//, '');
  return name === `v${version}`
    ? null
    : `tag ${name} does not match the version: expected v${version}`;
}
