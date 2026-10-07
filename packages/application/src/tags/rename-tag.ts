import {
  isTagWithin,
  joinFrontmatter,
  noteTitle,
  renamedTagName,
  renameTagInBody,
  renameTagInProperty,
  splitFrontmatter,
  tagKey,
  tagRenameProblem,
  TAGS_KEY,
  type TagCount,
  type TagRename,
  type VaultPath,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { LinkUpdatePanes } from '../vault/update-links.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { loadTagCounts, loadTaggedNotes, type TaggedNote } from './load-tags.ts';

/** A rename asked for that cannot be made, in words for the person who asked. */
export class TagRenameError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'TagRenameError';
  }
}

/** What renaming a tag would change, shown before anything is written. */
export interface TagRenamePlan {
  readonly rename: TagRename;
  /** The notes it would rewrite, each with how many uses. */
  readonly notes: readonly TaggedNote[];
  readonly total: number;
  /**
   * A tag already in use that this one, or one nested under it, would join:
   * the new name itself first, else the first nested one. Null when none would.
   */
  readonly mergesInto: string | null;
  /** Notes the new name could not be written in so that it reads back, each with why. */
  readonly refused: readonly { readonly path: VaultPath; readonly reason: string }[];
}

/** What renaming did: the notes rewritten, and the ones that could not be, with why. */
export interface TagRenameReport {
  readonly updated: readonly VaultPath[];
  readonly failed: readonly { readonly path: VaultPath; readonly reason: string }[];
}

/**
 * A note's text with a tag renamed in its `tags` property and its body. The
 * property is rewritten through the YAML writer, which keeps every other key's
 * bytes; the body changes only where a tag is.
 */
export function renameTagInNote({
  text,
  markdown,
  rename,
}: {
  text: string;
  markdown: MarkdownPort;
  rename: TagRename;
}): { text: string; count: number; problem: string | null } {
  const document = splitFrontmatter(text);
  const property = renameTagInProperty(
    markdown.frontmatterProperties(document.frontmatter)[TAGS_KEY],
    rename,
  );
  const frontmatter =
    property === null
      ? document.frontmatter
      : markdown.updateFrontmatter(document.frontmatter, { [TAGS_KEY]: property.value });
  const body = renameTagInBody({
    body: document.body,
    ranges: markdown.textRanges(document.body),
    rename,
  });
  if (body.problem !== null) return { text, count: 0, problem: body.problem };
  const count = (property?.count ?? 0) + body.count;
  return {
    text: count === 0 ? text : joinFrontmatter(frontmatter, body.body),
    count,
    problem: null,
  };
}

/**
 * The notes a rename would touch, counted from the files themselves: the index
 * says which notes use the tag, and each is read and worked out the way the
 * rename would. Refused when the new name cannot be a tag's. `alsoInUse` are
 * tags known to be written that the index may not show yet.
 */
export async function tagRenamePlan({
  index,
  fs,
  markdown,
  rename,
  alsoInUse = [],
}: {
  index: IndexPort;
  fs: VaultFsPort;
  markdown: MarkdownPort;
  rename: TagRename;
  alsoInUse?: readonly TagCount[];
}): Promise<TagRenamePlan> {
  const problem = tagRenameProblem(rename);
  if (problem !== null) throw new TagRenameError(problem);

  // A rename reaches archived notes too: unarchived later, they must not keep the old name.
  const tagged = await loadTaggedNotes({
    index,
    key: tagKey(rename.from),
    includeArchived: true,
  });
  const titles = new Map(tagged.map((note) => [note.path as string, note.title]));
  const files = await fs.readNotes(tagged.map((note) => note.path));
  const worked = files.map((file) => ({
    path: file.path as VaultPath,
    title: titles.get(file.path) ?? noteTitle(file.path as VaultPath),
    ...renameTagInNote({ text: file.text, markdown, rename }),
  }));
  const notes = worked
    .filter((note) => note.problem === null && note.count > 0)
    .map(({ path, title, count }) => ({ path, title, count }));
  const refused = worked.flatMap(({ path, problem }) =>
    problem === null ? [] : [{ path, reason: problem }],
  );

  return {
    rename,
    notes,
    total: notes.reduce((sum, note) => sum + note.count, 0),
    mergesInto: tagMergeTarget(
      [...(await loadTagCounts({ index, includeArchived: true })), ...alsoInUse],
      rename,
    ),
    refused,
  };
}

/**
 * The tag in use outside the renamed one that it would join, or null: `#a`
 * renamed to `#b` joins `#b`, and `#a/x` joins `#b/x`. A tag used only as the
 * parent of others is in use: once `#a` is `#b`, renaming `#b` back would
 * carry `#b/y` off with it.
 */
export function tagMergeTarget(counts: readonly TagCount[], rename: TagRename): string | null {
  const fromKey = tagKey(rename.from);
  const staying = spellings(counts.filter((tag) => !isTagWithin(tag.key, fromKey)));
  const joins = [...spellings(counts).values()]
    .flatMap((name) => {
      const renamed = renamedTagName({ name, ...rename });
      const joined = renamed === null ? undefined : staying.get(tagKey(renamed));
      return renamed === null || joined === undefined
        ? []
        : [{ name: joined, depth: renamed.split('/').length }];
    })
    .sort((left, right) => left.depth - right.depth);
  return joins[0]?.name ?? null;
}

/**
 * Every tag these uses make, by key: each one, and each it is nested under.
 * A tag is spelled as its own first use has it; one known only as a parent,
 * as its first child has it.
 */
function spellings(counts: readonly TagCount[]): Map<string, string> {
  const found = new Map<string, string>();
  const names = [...counts.map((tag) => tag.name), ...counts.flatMap((tag) => parentsOf(tag.name))];
  for (const name of names) if (!found.has(tagKey(name))) found.set(tagKey(name), name);
  return found;
}

/** The tags `a/b/c` is nested under: `a/b` and `a`. */
function parentsOf(name: string): string[] {
  const parts = name.split('/');
  return parts.slice(1).map((_, at) => parts.slice(0, parts.length - 1 - at).join('/'));
}

/**
 * Renames the tag in every note the plan found, one note at a time, as moving
 * a note rewrites its links: a pane's unsaved typing is written first so the
 * rename starts from it, a note still being typed in is left alone, and each
 * note is worked out again from what it holds at the moment of writing and
 * written against that version. One note failing does not stop the others.
 */
export async function renameTag({
  fs,
  markdown,
  openNotes,
  plan,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  openNotes: LinkUpdatePanes;
  plan: TagRenamePlan;
}): Promise<TagRenameReport> {
  const updated: VaultPath[] = [];
  const failed: { path: VaultPath; reason: string }[] = [];
  for (const { path } of plan.notes) {
    try {
      if (await rewrite({ fs, markdown, openNotes, path, rename: plan.rename })) updated.push(path);
    } catch (cause) {
      failed.push({ path, reason: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return { updated, failed };
}

async function rewrite({
  fs,
  markdown,
  openNotes,
  path,
  rename,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  openNotes: LinkUpdatePanes;
  path: VaultPath;
  rename: TagRename;
}): Promise<boolean> {
  if (openNotes.state(path) === 'dirty') await openNotes.flush([path]);
  if (openNotes.state(path) === 'dirty') throw new Error(`${noteTitle(path)} has unsaved changes.`);
  const { text, modified } = await fs.readTextFile(path);
  const renamed = renameTagInNote({ text, markdown, rename });
  if (renamed.problem !== null) throw new Error(renamed.problem);
  if (renamed.count === 0) return false;
  await fs.writeTextFile({ path, contents: renamed.text, expectedModified: modified });
  if (openNotes.state(path) === 'clean') openNotes.reload(path);
  return true;
}
