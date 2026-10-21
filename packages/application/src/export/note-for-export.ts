import {
  bodyWithoutTitle,
  exportImageSourcesOf,
  exportPageDocument,
  exportStandalone,
  formatWikiLink,
  missingTransclusion,
  noteTitle,
  pageTitle,
  propertySummary,
  splitFrontmatter,
  type EditorDocument,
  type ExportDrops,
  type ParsedBody,
  type VaultFile,
  type VaultPath,
} from '@atlas/domain';
import type { NotePageRenderer } from '../thumbnails/ports.ts';
import { locatePictures, picturesAsDataUrls } from './export-attachments.ts';
import {
  embeddedNotes,
  linkTitles,
  readRawOf,
  shownBlocks,
  type ExportReadPorts,
} from './export-reading.ts';
import { ExportError } from './ports.ts';

/** A note read to be exported: its bytes as they are on disk, and the same read as a note. */
export interface NoteToExport {
  readonly path: VaultPath;
  readonly bytes: Uint8Array;
  readonly title: string;
  readonly properties: Readonly<Record<string, unknown>>;
  /** Everything before the body, delimiters and all, byte for byte; "" when there is none. */
  readonly frontmatterText: string;
  readonly body: string;
  readonly parsed: ParsedBody;
}

/** Reads a note to export. Nothing is written, here or anywhere. */
export async function readNoteToExport(
  ports: ExportReadPorts,
  path: VaultPath,
): Promise<NoteToExport> {
  let bytes: Uint8Array;
  let text: string;
  try {
    bytes = new Uint8Array(await ports.fs.readBinaryFile(path));
    text = (await ports.fs.readTextFile(path)).text;
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ExportError('unreadable', `${noteTitle(path)} could not be read: ${reason}`);
  }
  const { frontmatter, body } = splitFrontmatter(text);
  // Text as read loses a byte-order mark; the frontmatter kept is the file's, so it keeps it.
  const mark =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && !text.startsWith('\uFEFF');
  const properties = ports.markdown.frontmatterProperties(frontmatter);
  return {
    path,
    bytes,
    title: pageTitle({ fileTitle: noteTitle(path), properties }).text,
    properties,
    frontmatterText: frontmatter === null ? '' : `${mark ? '\uFEFF' : ''}${frontmatter}`,
    body,
    parsed: ports.markdown.parseBody(body),
  };
}

/** What a note brings along: the blocks it shows and the notes it embeds, read. */
interface Gathered {
  readonly docs: readonly EditorDocument[];
  readonly read: (args: {
    hrefOf: (target: string) => string | null;
    imageSrc: (src: string) => string | null;
  }) => { doc: EditorDocument; dropped: readonly ExportDrops[] };
}

async function gather(
  ports: ExportReadPorts,
  { note, notePaths }: { note: NoteToExport; notePaths: readonly VaultPath[] },
): Promise<Gathered> {
  const { doc } = note.parsed;
  const holder = { doc, holder: note.path, notePaths };
  const shown = await shownBlocks(ports, holder);
  const embedded = await embeddedNotes(ports, holder);
  const docs = [
    doc,
    ...[...shown.values()].flatMap((block) => (block.kind === 'block' ? [block.content] : [])),
    ...[...embedded.values()].map((each) => each.doc),
  ];
  const titles = await linkTitles(ports, { docs, notePaths });
  return {
    docs,
    read: ({ hrefOf, imageSrc }) =>
      exportStandalone({
        doc,
        title: note.title,
        sources: {
          titleOf: (target) => titles.get(target) ?? null,
          shown: (link) => shown.get(formatWikiLink(link)) ?? missingTransclusion(link),
          readRaw: readRawOf(ports.markdown),
          hrefOf,
          imageSrc,
          embedded: (link) => embedded.get(formatWikiLink(link)) ?? null,
        },
      }),
  };
}

/** A note as standalone Markdown, and the pictures in the vault it shows, by their source. */
export interface StandaloneNote {
  readonly pictures: ReadonlyMap<string, VaultFile>;
  /** The Markdown, given where each picture is copied to (a relative link), or null if it is not. */
  readonly markdown: (pictureHref: (file: VaultFile) => string | null) => string;
  readonly dropped: (pictureHref: (file: VaultFile) => string | null) => readonly ExportDrops[];
}

/**
 * A note made standalone Markdown (#501): links to notes exported with it
 * as links to their files (`hrefOf`), any other as words; embeds quoted;
 * pictures linked where they are copied to; the frontmatter kept or not.
 * Blocks the export leaves as they were keep their bytes (ADR-0003).
 */
export async function standaloneNote(
  ports: ExportReadPorts,
  {
    note,
    notePaths,
    hrefOf,
    keepFrontmatter,
  }: {
    note: NoteToExport;
    notePaths: readonly VaultPath[];
    hrefOf: (target: string) => string | null;
    keepFrontmatter: boolean;
  },
): Promise<StandaloneNote> {
  const gathered = await gather(ports, { note, notePaths });
  const pictures = await locatePictures({
    fs: ports.fs,
    notePath: note.path,
    sources: exportImageSourcesOf(gathered.docs),
  });
  const exported = (pictureHref: (file: VaultFile) => string | null) =>
    gathered.read({
      hrefOf,
      imageSrc: (src) => {
        const file = pictures.get(src);
        return file === undefined ? null : pictureHref(file);
      },
    });
  return {
    pictures,
    markdown: (pictureHref) => {
      const body = ports.markdown.serializeBody({
        originalBody: note.body,
        parsed: note.parsed,
        doc: exported(pictureHref).doc,
      });
      return keepFrontmatter ? `${note.frontmatterText}${body}` : body;
    },
    dropped: (pictureHref) => exported(pictureHref).dropped,
  };
}

/** A note as one page to print or hand to Google Docs, and how many pictures it left out. */
export async function notePage(
  ports: ExportReadPorts & { readonly renderer: NotePageRenderer },
  {
    note,
    notePaths,
    script,
  }: { note: NoteToExport; notePaths: readonly VaultPath[]; script: string | null },
): Promise<{ html: string; picturesLeftOut: number }> {
  const gathered = await gather(ports, { note, notePaths });
  const located = await locatePictures({
    fs: ports.fs,
    notePath: note.path,
    sources: exportImageSourcesOf(gathered.docs),
  });
  const { urls, leftOut } = await picturesAsDataUrls({ fs: ports.fs, located });
  const { doc } = gathered.read({ hrefOf: () => null, imageSrc: (src) => urls.get(src) ?? null });
  const html = exportPageDocument({
    title: note.title,
    properties: propertySummary(note.properties),
    bodyHtml: ports.renderer.bodyHtml(bodyWithoutTitle(doc, note.title)),
    styles: ports.renderer.styles,
    script,
  });
  return { html, picturesLeftOut: leftOut };
}
