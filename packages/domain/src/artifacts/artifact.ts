import { isUnnamed, noteFileName } from '../vault/new-note.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import {
  createVaultPath,
  joinVaultPath,
  parentVaultPath,
  type VaultPath,
} from '../vault/vault-path.ts';

/*
 * A Claude artifact, kept in the vault: one note per artifact, holding its
 * link and what it is, and beside it — optionally — a saved copy of the page.
 */

/** The `type:` an artifact note declares. */
export const ARTIFACT_TYPE = 'artifact';

/** Where new artifacts go: their notes, and their saved copies in folders beside them. */
export const ARTIFACTS_FOLDER: VaultPath = createVaultPath('artifacts');

/** What an artifact is, as its `kind` property holds it. */
export const ARTIFACT_KINDS = ['page', 'deck', 'design', 'doc', 'other'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** The properties an artifact note uses, by what they mean. */
export const ARTIFACT_KEYS = {
  url: 'url',
  kind: 'kind',
  project: 'project',
  tags: 'tags',
  /** The vault-relative folder of the saved copy; empty when only the link is kept. */
  saved: 'saved',
  savedAt: 'saved_at',
  /**
   * The picture a gallery card is fronted with: the note's `cover`, as any
   * note's is — the copy's thumbnail, once Atlas has made one (`artifact-thumbnail.ts`).
   */
  cover: 'cover',
} as const;

/** What an artifact is called when nobody said. */
export const DEFAULT_ARTIFACT_TITLE = 'Untitled artifact';

export function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === 'string' && (ARTIFACT_KINDS as readonly string[]).includes(value);
}

/** Whether a note's properties say it is an artifact. */
export function isArtifactNote(properties: Readonly<Record<string, unknown>>): boolean {
  return properties['type'] === ARTIFACT_TYPE;
}

const CLAUDE_HOST = /(^|\.)claude\.(ai|site)$/i;
const ARTIFACT_SEGMENT = /^artifacts?$/i;

/**
 * The link to a Claude artifact in what was pasted, or null when it is not one.
 *
 * Any `https` address on claude.ai (or claude.site, where published artifacts
 * live) whose path has an `artifact` or `artifacts` segment followed by an id:
 * `claude.ai/artifact/…`, `claude.ai/code/artifact/…`, `claude.ai/public/artifacts/…`.
 */
export function claudeArtifactUrl(text: string): string | null {
  const url = parsedUrl(text.trim());
  if (url === null || url.protocol !== 'https:' || !CLAUDE_HOST.test(url.hostname)) return null;
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const at = segments.findIndex((segment) => ARTIFACT_SEGMENT.test(segment));
  if (at === -1 || at === segments.length - 1) return null;
  return url.href;
}

/** Whether a link may be kept as an artifact's `url`: an `http` or `https` address. */
export function isArtifactLink(text: string): boolean {
  const url = parsedUrl(text.trim());
  return url !== null && (url.protocol === 'https:' || url.protocol === 'http:');
}

function parsedUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    // Not an address at all, which is an answer rather than a failure.
    return null;
  }
}

const KIND_WORDS: readonly (readonly [ArtifactKind, RegExp])[] = [
  ['deck', /\b(deck|slides?|presentation)\b/i],
  ['design', /\b(design|mockup|prototype|wireframe)\b/i],
  ['doc', /\b(doc|docs|document)\b/i],
];

/** What a link's path suggests the artifact is, or null when it says nothing. */
export function kindFromUrl(text: string): ArtifactKind | null {
  const url = parsedUrl(text.trim());
  if (url === null) return null;
  const words = decodeURIComponent(url.pathname).replace(/[/_-]+/g, ' ');
  return KIND_WORDS.find(([, pattern]) => pattern.test(words))?.[0] ?? null;
}

/**
 * What a page's HTML suggests it is.
 *
 * Three or more slides, or reveal.js, is a deck; artboards or a mockup's frames
 * are a design; an `<article>`, or long prose under several headings, is a
 * doc. Everything else is a page — the safe guess, since it is what an
 * artifact most often is.
 */
export function kindFromHtml(html: string): ArtifactKind {
  const count = (pattern: RegExp) => html.match(pattern)?.length ?? 0;
  if (/reveal(\.min)?\.js/i.test(html) || count(/class\s*=\s*["'][^"']*\bslide\b/gi) >= 3) {
    return 'deck';
  }
  if (/class\s*=\s*["'][^"']*\b(artboard|mockup|wireframe)\b/i.test(html)) return 'design';
  if (/<article[\s>]/i.test(html) || (count(/<h2[\s>]/gi) >= 3 && count(/<p[\s>]/gi) >= 8)) {
    return 'doc';
  }
  return 'page';
}

/**
 * The kind to give a new artifact: the one asked for, else what its HTML
 * says, else what its link says, else a page.
 */
export function artifactKind({
  asked,
  html,
  url,
}: {
  asked?: string | undefined;
  html?: string | undefined;
  url?: string | undefined;
}): ArtifactKind {
  if (isArtifactKind(asked)) return asked;
  if (html !== undefined) return kindFromHtml(html);
  return (url === undefined ? null : kindFromUrl(url)) ?? 'page';
}

const SLUG_LIMIT = 60;

/**
 * A name as a folder name: lower case, letters and digits joined by hyphens,
 * accents dropped. Never empty, never hidden, and short enough for any disk.
 */
export function artifactSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_LIMIT)
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'artifact' : slug;
}

/** Where an artifact's saved copy goes, from its note: a folder named for it, beside it. */
export function copyFolderFor(notePath: VaultPath): VaultPath {
  return joinVaultPath(parentVaultPath(notePath), artifactSlug(noteTitle(notePath)));
}

/** How many numbered names are tried before giving up; a vault never has this many. */
const MAX_PLACEMENTS = 1000;

/**
 * Where a new artifact's note and its copy go: `artifacts/<Title>.md` and
 * `artifacts/<slug>`, numbered together ("Title 2", `title-2`) until neither
 * is taken, in any case — so a copy never lands in another artifact's folder.
 */
export function artifactPlacement({
  title,
  taken,
  folder = ARTIFACTS_FOLDER,
}: {
  title: string;
  /** Every path already in the folder, notes and folders alike. */
  taken: ReadonlySet<string>;
  folder?: VaultPath;
}): { notePath: VaultPath; copyFolder: VaultPath } {
  const takenInAnyCase = new Set([...taken].map((path) => path.toLowerCase()));
  const free = (path: string) => !takenInAnyCase.has(path.toLowerCase());
  const named = isUnnamed(title) ? DEFAULT_ARTIFACT_TITLE : title;
  const base = noteTitle(createVaultPath(noteFileName(named)));
  for (let number = 1; number <= MAX_PLACEMENTS; number += 1) {
    const name = fittedName(base, number === 1 ? '' : ` ${number}`);
    const notePath = joinVaultPath(folder, noteFileName(name));
    const copyFolder = copyFolderFor(notePath);
    if (free(notePath) && free(copyFolder)) return { notePath, copyFolder };
  }
  throw new Error(`No free name for ${JSON.stringify(title)} in ${folder}`);
}

/**
 * The longest single name every disk holds: 255 bytes of UTF-8 on APFS and
 * ext4. NTFS counts UTF-16 units, never more than UTF-8 bytes, so it fits too.
 */
const MAX_NAME_BYTES = 255;

const utf8Bytes = (text: string) => new TextEncoder().encode(text).byteLength;

/**
 * `${base}${suffix}`, with the base cut back — by whole characters, never
 * half an emoji — until the note's file name, `.md` and all, fits on disk.
 */
function fittedName(base: string, suffix: string): string {
  const room = MAX_NAME_BYTES - utf8Bytes(`${suffix}.md`);
  const characters = [...base];
  while (utf8Bytes(characters.join('')) > room) characters.pop();
  return `${characters.join('').trimEnd()}${suffix}`;
}

/** A project, as a relation holds it: `[[Name]]`, whether or not it came bracketed. */
export function projectLink(project: string): string {
  const name = project
    .trim()
    .replace(/^\[\[|\]\]$/g, '')
    .trim();
  return name === '' ? '' : `[[${name}]]`;
}

/** Tags as a multi-select holds them: trimmed, without `#`, without blanks or repeats. */
export function artifactTags(tags: readonly string[]): string[] {
  const cleaned = tags.map((tag) => tag.trim().replace(/^#+/, '').trim());
  return [...new Set(cleaned.filter((tag) => tag !== ''))];
}

/** What the saved copy adds to an artifact's note. */
export interface SavedCopyProperties {
  readonly saved: VaultPath;
  /** The day it was saved, `YYYY-MM-DD`. */
  readonly savedAt: string;
}

/**
 * The frontmatter of a new artifact note, in the order the type declares it.
 * A property with nothing to say is left out rather than written empty.
 */
export function artifactProperties({
  url,
  kind,
  project,
  tags = [],
  copy,
}: {
  url?: string | undefined;
  kind: ArtifactKind;
  project?: string | undefined;
  tags?: readonly string[];
  copy: SavedCopyProperties | null;
}): Record<string, unknown> {
  const link = project === undefined ? '' : projectLink(project);
  const cleanTags = artifactTags(tags);
  return {
    type: ARTIFACT_TYPE,
    ...(url !== undefined && url.trim() !== '' && { [ARTIFACT_KEYS.url]: url.trim() }),
    [ARTIFACT_KEYS.kind]: kind,
    ...(link !== '' && { [ARTIFACT_KEYS.project]: link }),
    ...(cleanTags.length > 0 && { [ARTIFACT_KEYS.tags]: cleanTags }),
    ...(copy === null ? {} : savedCopyValues(copy)),
  };
}

/** The properties that record a saved copy, for setting on a note that already exists. */
export function savedCopyValues(copy: SavedCopyProperties): Record<string, string> {
  return { [ARTIFACT_KEYS.saved]: copy.saved, [ARTIFACT_KEYS.savedAt]: copy.savedAt };
}

/** The folder a note's `saved` names, or null when it names none. */
export function savedFolderOf(properties: Readonly<Record<string, unknown>>): string | null {
  const saved = properties[ARTIFACT_KEYS.saved];
  return typeof saved === 'string' && saved.trim() !== '' ? saved.trim() : null;
}

/** The palette command a pasted artifact link offers. */
export const SAVE_ARTIFACT_LINK = 'save-artifact-link';

/**
 * What the search palette offers when a claude.ai artifact link is pasted
 * into it: saving it as an artifact, ahead of anything the words match.
 */
export function pastedArtifactCommands(
  query: string,
): readonly { readonly id: string; readonly label: string }[] {
  return claudeArtifactUrl(query) === null
    ? []
    : [{ id: SAVE_ARTIFACT_LINK, label: 'Save this link as an artifact' }];
}
