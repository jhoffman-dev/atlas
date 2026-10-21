import {
  bodyWithoutTitle,
  exportImageSourcesOf,
  exportPageDocument,
  exportStandalone,
  formatWikiLink,
  retargetPictures,
  webPictureSourcesOf,
  missingTransclusion,
  noteTitle,
  pageTitle,
  propertySummary,
  splitFrontmatter,
  type EditorDocument,
  type EmbeddedNote,
  type ExportDrops,
  type ParsedBody,
  type Transclusion,
  type VaultFile,
  type VaultPath,
} from '@atlas/domain';
import type { NotePageRenderer } from '../thumbnails/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
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
    webPictures?: 'keep' | 'link';
  }) => { doc: EditorDocument; dropped: readonly ExportDrops[] };
}

/**
 * A note's blocks with each picture readdressed from the vault's root, as
 * its own folder finds it (`/Projects/chart.png`): read as the note it came
 * from, before its blocks join another note's (#502).
 */
async function fromItsFolder(
  fs: VaultFsPort,
  { path, doc }: { path: VaultPath; doc: EditorDocument },
): Promise<EditorDocument> {
  const sources = exportImageSourcesOf([doc]);
  if (sources.length === 0) return doc;
  const located = await locatePictures({ fs, notePath: path, sources });
  return retargetPictures(doc, (src) => {
    const file = located.get(src);
    return file === undefined ? null : `/${file.path}`;
  });
}

/**
 * The blocks a note shows and the notes it embeds, each read as itself: an
 * embedded note's own shown blocks and pictures are found from it, not from
 * the note exported (#502).
 */
async function readAlong(
  ports: ExportReadPorts,
  { note, notePaths }: { note: NoteToExport; notePaths: readonly VaultPath[] },
): Promise<{ shown: Map<string, Transclusion>; embedded: Map<string, EmbeddedNote> }> {
  const { doc } = note.parsed;
  const shown = await shownBlocks(ports, { doc, holder: note.path, notePaths });
  const embedded = new Map<string, EmbeddedNote>();
  for (const [written, inner] of await embeddedNotes(ports, {
    doc,
    holder: note.path,
    notePaths,
  })) {
    const itsShown = await shownBlocks(ports, { doc: inner.doc, holder: inner.path, notePaths });
    for (const [link, block] of itsShown) if (!shown.has(link)) shown.set(link, block);
    embedded.set(written, { title: inner.title, doc: await fromItsFolder(ports.fs, inner) });
  }
  for (const [link, block] of shown) {
    if (block.kind !== 'block') continue;
    shown.set(link, {
      ...block,
      content: await fromItsFolder(ports.fs, { path: block.path, doc: block.content }),
    });
  }
  return { shown, embedded };
}

async function gather(
  ports: ExportReadPorts,
  { note, notePaths }: { note: NoteToExport; notePaths: readonly VaultPath[] },
): Promise<Gathered> {
  const { doc } = note.parsed;
  const { shown, embedded } = await readAlong(ports, { note, notePaths });
  const docs = [
    doc,
    ...[...shown.values()].flatMap((block) => (block.kind === 'block' ? [block.content] : [])),
    ...[...embedded.values()].map((each) => each.doc),
  ];
  const titles = await linkTitles(ports, { docs, notePaths });
  return {
    docs,
    read: ({ hrefOf, imageSrc, webPictures }) =>
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
          ...(webPictures !== undefined && { webPictures }),
        },
      }),
  };
}

/** A note as standalone Markdown, and the pictures in the vault it shows, by their source. */
export interface StandaloneNote {
  readonly pictures: ReadonlyMap<string, VaultFile>;
  /** Pictures the note shows that are not in the vault. */
  readonly unlocated: number;
  /** The Markdown, given where each picture is copied to, and what it left out: one export pass. */
  readonly render: (pictureHref: (file: VaultFile) => string | null) => {
    readonly markdown: string;
    readonly dropped: readonly ExportDrops[];
  };
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
  const sources = exportImageSourcesOf(gathered.docs);
  const pictures = await locatePictures({ fs: ports.fs, notePath: note.path, sources });
  return {
    pictures,
    unlocated: sources.length - pictures.size,
    render: (pictureHref) => {
      const exported = gathered.read({
        hrefOf,
        imageSrc: (src) => {
          const file = pictures.get(src);
          return file === undefined ? null : pictureHref(file);
        },
      });
      const body = ports.markdown.serializeBody({
        originalBody: note.body,
        parsed: note.parsed,
        doc: exported.doc,
      });
      const markdown = keepFrontmatter ? `${note.frontmatterText}${body}` : body;
      return { markdown, dropped: exported.dropped };
    },
  };
}

/**
 * A note as one page to print or hand to Google Docs, and how many pictures
 * it left out: those not in the vault, unreadable or too large, and those on
 * the web, which the page — fetching nothing — names and links instead (#502).
 */
export async function notePage(
  ports: ExportReadPorts & { readonly renderer: NotePageRenderer },
  {
    note,
    notePaths,
    script,
  }: { note: NoteToExport; notePaths: readonly VaultPath[]; script: string | null },
): Promise<{ html: string; picturesLeftOut: number }> {
  const gathered = await gather(ports, { note, notePaths });
  const sources = exportImageSourcesOf(gathered.docs);
  const located = await locatePictures({ fs: ports.fs, notePath: note.path, sources });
  const { urls, leftOut } = await picturesAsDataUrls({ fs: ports.fs, located });
  const { doc } = gathered.read({
    hrefOf: () => null,
    imageSrc: (src) => urls.get(src) ?? null,
    webPictures: 'link',
  });
  const html = exportPageDocument({
    title: note.title,
    properties: propertySummary(note.properties),
    bodyHtml: ports.renderer.bodyHtml(bodyWithoutTitle(doc, note.title)),
    styles: ports.renderer.styles,
    script,
  });
  const unlocated = sources.length - located.size;
  const onTheWeb = webPictureSourcesOf(gathered.docs).length;
  return { html, picturesLeftOut: leftOut + unlocated + onTheWeb };
}
