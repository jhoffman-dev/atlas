import {
  findMention,
  isTemplateNote,
  joinFrontmatter,
  linkFirstMention,
  mentionExcerpt,
  noteTitle,
  proseText,
  splitFrontmatter,
  toSearchQuery,
  type VaultPath,
  wikiLinkTargetFor,
} from '@atlas/domain';
import type { OpenNotes } from '../api/ports.ts';
import type { IndexPort } from '../index/ports.ts';
import { searchScope } from '../index/search-notes.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** How many search hits are read to look for mentions. */
const CANDIDATES = 25;

/** The note being mentioned: where it is, and the title it is shown by. */
export interface MentionedNote {
  readonly path: VaultPath;
  readonly title: string;
}

/** Another note that names this one in plain text, and the words around it. */
export interface UnlinkedMention {
  readonly path: VaultPath;
  readonly title: string;
  readonly excerpt: string;
}

/** A mention could not be linked, and why, in words for the person who asked. */
export class MentionNotLinkedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'MentionNotLinkedError';
  }
}

/** The names a note may be mentioned by: its file's name, and the title it shows. */
function namesOf(note: MentionedNote): string[] {
  return [...new Set([noteTitle(note.path), note.title])];
}

/** Where a mention may be found in a body: its plain words, in prose blocks. */
function mentionable(markdown: MarkdownPort, body: string) {
  return proseText(markdown.parseBody(body), markdown.textRanges(body));
}

/**
 * Notes that name this one in their prose without linking to it.
 *
 * The index narrows the vault to notes whose words match; each is then read
 * and checked the way a link would be made, so every note listed is one the
 * "Link" button can actually link. Notes already linking here are left out —
 * they are listed as links, not mentions.
 */
export async function findUnlinkedMentions({
  index,
  fs,
  markdown,
  note,
  linkedFrom,
}: {
  index: IndexPort;
  fs: VaultFsPort;
  markdown: MarkdownPort;
  note: MentionedNote;
  linkedFrom: readonly VaultPath[];
}): Promise<UnlinkedMention[]> {
  const names = namesOf(note);
  const skip = new Set<string>([note.path, ...linkedFrom]);
  const titles = new Map<string, string>();
  for (const name of names) {
    const query = toSearchQuery(name);
    if (query === null) continue;
    const scope = searchScope({ includeArchived: false });
    for (const hit of await index.search(query, CANDIDATES, scope)) {
      // A template is never written into from a note's page (ADR-0026).
      if (!skip.has(hit.path) && !isTemplateNote(hit.path)) titles.set(hit.path, hit.title);
    }
  }
  if (titles.size === 0) return [];

  const files = await fs.readNotes([...titles.keys()]);
  return files
    .flatMap((file) => {
      const { body } = splitFrontmatter(file.text);
      const mention = findMention({ body, prose: mentionable(markdown, body), names });
      if (mention === null) return [];
      const path = file.path as VaultPath;
      return [
        {
          path,
          title: titles.get(path) ?? noteTitle(path),
          excerpt: mentionExcerpt(body, mention),
        },
      ];
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

/**
 * Turns the first plain mention of `target` in `source` into a link.
 *
 * The link names the note by its bare name when that opens it, and by its
 * path when another note of the same name would win (`wikiLinkTargetFor`).
 * Only the mention's bytes change (`linkFirstMention`); the file is written
 * against the modification time it was read at, so an edit made in between is
 * never overwritten. A pane holding the note with unsaved typing is refused
 * rather than written under, and a pane holding it clean is reloaded.
 * False when the mention has gone since it was listed.
 */
export async function linkUnlinkedMention({
  index,
  fs,
  markdown,
  openNotes,
  source,
  target,
}: {
  index: Pick<IndexPort, 'manifest'>;
  fs: VaultFsPort;
  markdown: MarkdownPort;
  openNotes: Pick<OpenNotes, 'state' | 'reload'>;
  source: VaultPath;
  target: MentionedNote;
}): Promise<boolean> {
  if (isTemplateNote(source)) {
    throw new MentionNotLinkedError('A template is edited on its own, not linked from a note.');
  }
  const pane = openNotes.state(source);
  if (pane === 'dirty') {
    throw new MentionNotLinkedError(`${noteTitle(source)} has unsaved changes. Save it first.`);
  }
  const notes = (await index.manifest()).map((entry) => entry.path as VaultPath);
  const { text, modified } = await fs.readTextFile(source);
  const document = splitFrontmatter(text);
  const body = linkFirstMention({
    body: document.body,
    prose: mentionable(markdown, document.body),
    names: namesOf(target),
    target: wikiLinkTargetFor(target.path, notes),
  });
  if (body === null) return false;

  await fs.writeTextFile({
    path: source,
    contents: joinFrontmatter(document.frontmatter, body),
    expectedModified: modified,
  });
  if (pane === 'clean') openNotes.reload(source);
  return true;
}
