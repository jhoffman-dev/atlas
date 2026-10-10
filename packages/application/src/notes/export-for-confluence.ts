import {
  createVaultPath,
  exportForConfluence,
  formatWikiLink,
  isBlankFrontmatter,
  linkTargetsOf,
  missingTransclusion,
  noteTitle,
  pageTitle,
  resolveWikiLinkTarget,
  shownBlocksOf,
  splitFrontmatter,
  type EditorDocument,
  type ExportDrops,
  type RawPartsReader,
  type Transclusion,
  type VaultPath,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import { createTransclusionReader } from '../transclusion/read-transclusions.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import type { MarkdownPort } from './ports.ts';

/** A note as a Confluence page takes it (P32-07). */
export interface NoteForConfluence {
  /** The note's title, as its page in Atlas shows it: the page's title. */
  readonly title: string;
  /** The page's body, as markdown. */
  readonly markdown: string;
  /** Everything the page leaves out, by kind. */
  readonly dropped: readonly ExportDrops[];
}

/** What a property key reads as when the frontmatter holding it cannot be read at all. */
export const UNREADABLE_FRONTMATTER = '(frontmatter Atlas cannot read)';

/** What it reads as when the frontmatter is YAML but no map of properties: a list, a value, comments. */
export const NOT_PROPERTIES = '(frontmatter that is not properties)';

interface ExportPorts {
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
  readonly index: IndexPort;
}

/**
 * A note made ready to share on Confluence: its links as words, the blocks it
 * shows read from their notes, its callouts as quotes, and a list of all it
 * left out. It writes nothing. The notes it may read, for a title or a shown
 * block, are `notePaths`: a link to any other is shared as it is written.
 */
export async function exportNoteForConfluence({
  note,
  notePaths,
  ...ports
}: ExportPorts & {
  note: { readonly path: VaultPath; readonly text: string };
  notePaths: readonly VaultPath[];
}): Promise<NoteForConfluence> {
  const { frontmatter, body } = splitFrontmatter(note.text);
  const properties = ports.markdown.frontmatterProperties(frontmatter);
  const title = pageTitle({ fileTitle: noteTitle(note.path), properties }).text;
  const { doc } = ports.markdown.parseBody(body);
  const shown = await shownBlocks(ports, { doc, holder: note.path, notePaths });
  const shownDocs = [...shown.values()].flatMap((block) =>
    block.kind === 'block' ? [block.content] : [],
  );
  const titles = await linkTitles(ports, { docs: [doc, ...shownDocs], notePaths });
  const exported = exportForConfluence({
    doc,
    title,
    propertyKeys: propertyKeysOf(ports.markdown, { frontmatter, properties }),
    sources: {
      titleOf: (target) => titles.get(target) ?? null,
      shown: (link) => shown.get(formatWikiLink(link)) ?? missingTransclusion(link),
      readRaw: readRawOf(ports.markdown),
    },
  });
  return { title, markdown: written(ports.markdown, exported.doc), dropped: exported.dropped };
}

/**
 * The frontmatter as the page leaves it out: its keys, or what stands for a
 * block holding something that is not keys, so even that is never lost unsaid.
 */
function propertyKeysOf(
  markdown: MarkdownPort,
  {
    frontmatter,
    properties,
  }: { frontmatter: string | null; properties: Readonly<Record<string, unknown>> },
): string[] {
  if (frontmatter === null || isBlankFrontmatter(frontmatter)) return [];
  if (markdown.frontmatterProblem(frontmatter) !== null) return [UNREADABLE_FRONTMATTER];
  const keys = Object.keys(properties);
  return keys.length > 0 ? keys : [NOT_PROPERTIES];
}

const readRawOf =
  (markdown: MarkdownPort): RawPartsReader =>
  (raw, definitions) =>
    markdown.rawParts(raw, definitions);

/** What each block the note shows in place shows, by its link as written. */
async function shownBlocks(
  ports: ExportPorts,
  {
    doc,
    holder,
    notePaths,
  }: { doc: EditorDocument; holder: VaultPath; notePaths: readonly VaultPath[] },
): Promise<Map<string, Transclusion>> {
  const links = shownBlocksOf(doc);
  if (links.length === 0) return new Map();
  const read = await createTransclusionReader(ports).read({ links, holder, notePaths });
  return new Map(
    links.map((link, at) => [formatWikiLink(link), read[at] ?? missingTransclusion(link)]),
  );
}

/** The title of each note the export will name, by the target that names it. */
async function linkTitles(
  { fs, markdown }: ExportPorts,
  { docs, notePaths }: { docs: readonly EditorDocument[]; notePaths: readonly VaultPath[] },
): Promise<Map<string, string>> {
  const pathOf = new Map(
    linkTargetsOf(docs, readRawOf(markdown)).flatMap((target) => {
      const path = resolveWikiLinkTarget(target, notePaths);
      return path === null ? [] : [[target, path] as const];
    }),
  );
  if (pathOf.size === 0) return new Map();
  const files = await fs.readNotes([...new Set(pathOf.values())]);
  const titleAt = new Map(
    files.map((file) => {
      const properties = markdown.frontmatterProperties(splitFrontmatter(file.text).frontmatter);
      return [
        file.path,
        pageTitle({ fileTitle: noteTitle(createVaultPath(file.path)), properties }).text,
      ];
    }),
  );
  return new Map(
    [...pathOf].flatMap(([target, path]) => {
      const found = titleAt.get(path);
      return found === undefined ? [] : [[target, found] as const];
    }),
  );
}

/** The exported blocks as markdown, every one written afresh. */
function written(markdown: MarkdownPort, doc: EditorDocument): string {
  const nothing: EditorDocument = { type: 'doc', content: [] };
  return markdown.serializeBody({ originalBody: '', parsed: { blocks: [], doc: nothing }, doc });
}
