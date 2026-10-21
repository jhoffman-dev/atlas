import {
  attachmentFileNames,
  COMPANION_SUFFIX,
  EXPORT_PAGE,
  exportFileName,
  exportFileStem,
  exportFolderName,
  exportImageSourcesOf,
  markdownHref,
  resolveWikiLinkTarget,
  SHARED_ATTACHMENTS_FOLDER,
  uniqueFileNames,
  type ExportFormat,
  type VaultFile,
  type VaultPath,
} from '@atlas/domain';
import type { Clock } from '../ports.ts';
import type { NotePageRenderer } from '../thumbnails/ports.ts';
import { locatePictures } from './export-attachments.ts';
import type { ExportReadPorts } from './export-reading.ts';
import {
  notePage,
  readNoteToExport,
  standaloneNote,
  type NoteToExport,
} from './note-for-export.ts';
import {
  ExportError,
  type ExportDestination,
  type ExportFilesPort,
  type PdfRendererPort,
} from './ports.ts';

/** The formats saved as files. A Google Doc goes to Drive instead (`export-google-docs.ts`). */
export type FileFormat = Exclude<ExportFormat, 'google-doc'>;

export interface SaveExportPorts extends ExportReadPorts {
  readonly files: ExportFilesPort;
  readonly pdf: PdfRendererPort;
  readonly renderer: NotePageRenderer;
  readonly clock: Clock;
}

/** What saving an export did: nothing, when the person cancelled the dialog. */
export type SavedExport =
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'saved';
      readonly format: FileFormat;
      /** The file or folder it went to. */
      readonly where: string;
      readonly notes: number;
      readonly attachments: number;
      /** Pictures the export could not bring along: not in the vault, unreadable, too big. */
      readonly picturesLeftOut: number;
    };

/** The most HTML a PDF is made from: what the host takes in one page. */
export const MAX_PDF_HTML_BYTES = 64 * 1024 * 1024;

const extensionOf = (format: FileFormat) => (format === 'pdf' ? 'pdf' : 'md');

/** One file of the export: where in the destination it goes, and its bytes, made when written. */
interface Planned {
  readonly path: string;
  readonly bytes: () => Promise<Uint8Array>;
}

const encoder = new TextEncoder();

/**
 * Saves notes to where the person picks (#501): one note to a file (its
 * pictures in a folder beside it), several into a folder of their own (the
 * pictures shared in `attachments/`). It reads the vault and never writes
 * to it; what it writes goes through the host, to the place picked.
 */
export async function saveExport(
  ports: SaveExportPorts,
  request: {
    format: FileFormat;
    paths: readonly VaultPath[];
    notePaths: readonly VaultPath[];
    keepFrontmatter: boolean;
  },
): Promise<SavedExport> {
  if (request.paths.length === 0)
    throw new ExportError('failed', 'No notes were chosen to export.');
  const notes: NoteToExport[] = [];
  for (const path of request.paths) notes.push(await readNoteToExport(ports, path));
  return notes.length === 1
    ? saveOne(ports, { ...request, note: notes[0]! })
    : saveMany(ports, { ...request, notes });
}

async function saveOne(
  ports: SaveExportPorts,
  request: {
    format: FileFormat;
    note: NoteToExport;
    notePaths: readonly VaultPath[];
    keepFrontmatter: boolean;
  },
): Promise<SavedExport> {
  const { format, note } = request;
  const markdown = format === 'pdf' ? null : await markdownPlan(ports, request);
  const pictures = markdown?.pictures ?? new Map<string, VaultFile>();
  const destination = await ports.files.choose({
    kind: 'file',
    suggestedName: exportFileName(note.title, extensionOf(format)),
    extension: extensionOf(format),
    companionSuffix: pictures.size > 0 ? COMPANION_SUFFIX : null,
  });
  if (destination === null) return { kind: 'cancelled' };
  const companion = lastPart(destination.companion);
  const names = attachmentFileNames([...pictures.values()].map((file) => file.path));
  const copyAt = (file: VaultFile) => `${companion}/${names.get(file.path) ?? file.name}`;
  let picturesLeftOut = 0;
  const main: Planned = {
    path: '',
    bytes: async () => {
      if (markdown !== null) return markdown.bytes((file) => markdownHref(copyAt(file)));
      const made = await pdfOf(ports, { note, notePaths: request.notePaths });
      picturesLeftOut = made.picturesLeftOut;
      return made.bytes;
    },
  };
  const copies = uniqueFiles(pictures).map((file) => copyPlan(ports, file, copyAt(file)));
  await writeAll(ports.files, destination, [main, ...copies]);
  return {
    kind: 'saved',
    format,
    where: destination.path,
    notes: 1,
    attachments: copies.length,
    picturesLeftOut: picturesLeftOut + (markdown?.unlocated ?? 0),
  };
}

async function saveMany(
  ports: SaveExportPorts,
  request: {
    format: FileFormat;
    notes: readonly NoteToExport[];
    notePaths: readonly VaultPath[];
    keepFrontmatter: boolean;
  },
): Promise<SavedExport> {
  const { format, notes } = request;
  const fileNames = uniqueFileNames(
    notes.map((note) => exportFileStem(note.title)),
    extensionOf(format),
  );
  const fileOf = new Map(notes.map((note, at) => [note.path, fileNames[at]!]));
  const hrefOf = (target: string) => {
    const path = resolveWikiLinkTarget(target, request.notePaths);
    const file = path === null ? undefined : fileOf.get(path);
    return file === undefined ? null : markdownHref(file);
  };
  const markdowns =
    format === 'pdf'
      ? null
      : await Promise.all(notes.map((note) => markdownPlan(ports, { ...request, note, hrefOf })));
  const pictures = new Map(markdowns?.flatMap((plan) => [...plan.pictures]) ?? []);
  const names = attachmentFileNames([...pictures.values()].map((file) => file.path));
  const copyAt = (file: VaultFile) =>
    `${SHARED_ATTACHMENTS_FOLDER}/${names.get(file.path) ?? file.name}`;
  const destination = await ports.files.choose({
    kind: 'folder',
    folderName: exportFolderName(ports.clock.today()),
  });
  if (destination === null) return { kind: 'cancelled' };
  let picturesLeftOut = 0;
  const planned: Planned[] = notes.map((note, at) => ({
    path: fileNames[at]!,
    bytes: async () => {
      const markdown = markdowns?.[at];
      if (markdown !== undefined) return markdown.bytes((file) => markdownHref(copyAt(file)));
      const made = await pdfOf(ports, { note, notePaths: request.notePaths });
      picturesLeftOut += made.picturesLeftOut;
      return made.bytes;
    },
  }));
  const copies = uniqueFiles(pictures).map((file) => copyPlan(ports, file, copyAt(file)));
  await writeAll(ports.files, destination, [...planned, ...copies]);
  const unlocated = markdowns?.reduce((sum, plan) => sum + plan.unlocated, 0) ?? 0;
  return {
    kind: 'saved',
    format,
    where: destination.path,
    notes: notes.length,
    attachments: copies.length,
    picturesLeftOut: picturesLeftOut + unlocated,
  };
}

/** A note's Markdown — as it is, or standalone — and the pictures that go with it. */
interface MarkdownPlan {
  readonly pictures: ReadonlyMap<string, VaultFile>;
  /** Pictures the note names that are not in the vault. */
  readonly unlocated: number;
  readonly bytes: (pictureHref: (file: VaultFile) => string) => Uint8Array;
}

async function markdownPlan(
  ports: SaveExportPorts,
  {
    format,
    note,
    notePaths,
    keepFrontmatter,
    hrefOf = () => null,
  }: {
    format: FileFormat;
    note: NoteToExport;
    notePaths: readonly VaultPath[];
    keepFrontmatter: boolean;
    hrefOf?: (target: string) => string | null;
  },
): Promise<MarkdownPlan> {
  if (format === 'markdown') {
    // As it is: the file's own bytes, untouched, and the pictures its own blocks name.
    const sources = exportImageSourcesOf([note.parsed.doc]);
    const pictures = await locatePictures({ fs: ports.fs, notePath: note.path, sources });
    return { pictures, unlocated: sources.length - pictures.size, bytes: () => note.bytes };
  }
  const standalone = await standaloneNote(ports, { note, notePaths, hrefOf, keepFrontmatter });
  const unlocated = (pictureHref: (file: VaultFile) => string) =>
    standalone.dropped(pictureHref).find((drops) => drops.kind === 'image')?.items.length ?? 0;
  const anyHref = () => '';
  return {
    pictures: standalone.pictures,
    unlocated: unlocated(anyHref),
    bytes: (pictureHref) => encoder.encode(standalone.markdown(pictureHref)),
  };
}

async function pdfOf(
  ports: SaveExportPorts,
  { note, notePaths }: { note: NoteToExport; notePaths: readonly VaultPath[] },
): Promise<{ bytes: Uint8Array; picturesLeftOut: number }> {
  const page = await notePage(ports, { note, notePaths, script: ports.pdf.pagingScript });
  if (encoder.encode(page.html).byteLength > MAX_PDF_HTML_BYTES) {
    throw new ExportError(
      'too-large',
      `${note.title} is too large to make a PDF of: its page and pictures come to more than 64 MB.`,
    );
  }
  const bytes = await ports.pdf.render({ html: page.html, page: EXPORT_PAGE });
  return { bytes, picturesLeftOut: page.picturesLeftOut };
}

function uniqueFiles(pictures: ReadonlyMap<string, VaultFile>): VaultFile[] {
  return [...new Map([...pictures.values()].map((file) => [file.path, file])).values()];
}

function copyPlan(ports: SaveExportPorts, file: VaultFile, path: string): Planned {
  return { path, bytes: async () => new Uint8Array(await ports.fs.readBinaryFile(file.path)) };
}

/** Writes each file in turn, then lets the destination go — whatever happened on the way. */
async function writeAll(
  files: ExportFilesPort,
  destination: ExportDestination,
  planned: readonly Planned[],
): Promise<void> {
  try {
    for (const file of planned) {
      await files.write({ destination, path: file.path, bytes: await file.bytes() });
    }
  } finally {
    await files.finish(destination);
  }
}

/** The last part of a path the host gave, as a relative path inside the export names it. */
function lastPart(path: string | null): string {
  return path === null
    ? ''
    : (path
        .split(/[\\/]/)
        .filter((part) => part !== '')
        .at(-1) ?? '');
}
