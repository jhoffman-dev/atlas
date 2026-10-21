import {
  exportForConfluence,
  formatWikiLink,
  isBlankFrontmatter,
  missingTransclusion,
  noteTitle,
  pageTitle,
  splitFrontmatter,
  type EditorDocument,
  type ExportDrops,
  type VaultPath,
} from '@dfai/domain';
import {
  linkTitles,
  readRawOf,
  shownBlocks,
  type ExportReadPorts,
} from '../export/export-reading.ts';
import type { MarkdownPort } from './ports.ts';

/** A note as a Confluence page takes it (P32-07). */
export interface NoteForConfluence {
  /** The note's title, as its page in DFAI shows it: the page's title. */
  readonly title: string;
  /** The page's body, as markdown. */
  readonly markdown: string;
  /** Everything the page leaves out, by kind. */
  readonly dropped: readonly ExportDrops[];
}

/** What a property key reads as when the frontmatter holding it cannot be read at all. */
export const UNREADABLE_FRONTMATTER = '(frontmatter DFAI cannot read)';

/** What it reads as when the frontmatter is YAML but no map of properties: a list, a value, comments. */
export const NOT_PROPERTIES = '(frontmatter that is not properties)';

type ExportPorts = ExportReadPorts;

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

/** The exported blocks as markdown, every one written afresh. */
function written(markdown: MarkdownPort, doc: EditorDocument): string {
  const nothing: EditorDocument = { type: 'doc', content: [] };
  return markdown.serializeBody({ originalBody: '', parsed: { blocks: [], doc: nothing }, doc });
}
