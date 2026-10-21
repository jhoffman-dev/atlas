import {
  attachmentFileNames,
  exportImageSourcesOf,
  markdownHref,
  SHARED_ATTACHMENTS_FOLDER,
  type VaultFile,
  type VaultPath,
} from '@atlas/domain';
import { locatePictures } from '../export/export-attachments.ts';
import type { ExportReadPorts } from '../export/export-reading.ts';
import { readNoteToExport, standaloneNote } from '../export/note-for-export.ts';
import { exportNoteForConfluence } from '../notes/export-for-confluence.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { ApiError } from './api-error.ts';
import type {
  ApiConfluenceExport,
  ApiExportAttachment,
  ApiMarkdownExport,
  ApiNoteExport,
  ApiStandaloneExport,
} from './contract.ts';
import { notePathOf, readNote } from './note-io.ts';
import { isApiFilePath, isApiNotePath } from './paths.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/*
 * A note made ready to leave Atlas: as markdown for a Confluence page
 * (P32-07), for Claude's Atlassian connector to write, or as Markdown (#501),
 * as it is or standalone. Atlas writes nothing, here or anywhere else — a PDF
 * or a Google Doc is made in the app alone (ADR-0016). Links, shown blocks,
 * embeds and pictures are read from user space alone, so nothing in `.atlas`
 * or a hidden folder reaches the export.
 */

const FORMATS = ['confluence', 'markdown', 'standalone'] as const;
type Format = ApiNoteExport['format'];

/** What every format reads: the note's path, and the user-space notes it may name. */
interface Asked {
  readonly path: VaultPath;
  readonly notePaths: readonly VaultPath[];
}

export async function exportNoteRoute(request: VaultRequest): Promise<RouteResult> {
  const format = formatOf(request.query['format']);
  const keepFrontmatter = keepFrontmatterOf(format, request.query['frontmatter']);
  const path = await notePathOf(request);
  // Read once as the API reads a note, so a missing one is `not_found` and a switched vault `no_vault`.
  const { text } = await readNote(request, path);
  const notePaths = (await listVaultNotes({ fs: request.fs })).filter(isApiNotePath);
  const asked: Asked = { path, notePaths };
  const answer: ApiNoteExport =
    format === 'confluence'
      ? await confluenceExport(request, { ...asked, text })
      : format === 'markdown'
        ? await asIsExport(request, asked)
        : await standaloneExport(request, { ...asked, keepFrontmatter });
  request.assertStillOpen();
  return { status: 200, body: { export: answer } };
}

/** The format asked for, by name: one of the three, or nothing. */
function formatOf(raw: string | undefined): Format {
  const found = FORMATS.find((format) => format === raw);
  if (found === undefined) {
    throw new ApiError('invalid', 'format must be "confluence", "markdown" or "standalone"');
  }
  return found;
}

/** Whether a standalone export keeps the frontmatter: by default it does. No other format takes it. */
function keepFrontmatterOf(format: Format, raw: string | undefined): boolean {
  if (raw === undefined) return true;
  if (format !== 'standalone') {
    throw new ApiError('invalid', 'frontmatter is for format "standalone" only');
  }
  if (raw === 'keep' || raw === 'drop') return raw === 'keep';
  throw new ApiError('invalid', 'frontmatter must be "keep" or "drop"');
}

const portsOf = (request: VaultRequest): ExportReadPorts => ({
  fs: request.fs,
  markdown: request.markdown,
  index: request.index,
});

async function confluenceExport(
  request: VaultRequest,
  { path, notePaths, text }: Asked & { text: string },
): Promise<ApiConfluenceExport> {
  const exported = await exportNoteForConfluence({
    ...portsOf(request),
    note: { path, text },
    notePaths,
  });
  return { path, format: 'confluence', ...exported };
}

/** The note as it is: the file's text untouched, and the pictures its own blocks show. */
async function asIsExport(request: VaultRequest, { path }: Asked): Promise<ApiMarkdownExport> {
  const note = await readNoteToExport(portsOf(request), path);
  const located = await locatePictures({
    fs: request.fs,
    notePath: path,
    sources: exportImageSourcesOf([note.parsed.doc]),
  });
  const pictures = userSpaceFiles(located.values());
  const names = attachmentFileNames(pictures.map((file) => file.path));
  const attachments = pictures.map((file) => ({ path: file.path, as: names.get(file.path)! }));
  return { path, format: 'markdown', title: note.title, markdown: textOf(note), attachments };
}

/** The note made standalone, its pictures linked at `attachments/<name>` and links as words. */
async function standaloneExport(
  request: VaultRequest,
  { path, notePaths, keepFrontmatter }: Asked & { keepFrontmatter: boolean },
): Promise<ApiStandaloneExport> {
  const ports = portsOf(request);
  const note = await readNoteToExport(ports, path);
  // One note leaves the vault, so a link to any other is its words.
  const standalone = await standaloneNote(ports, {
    note,
    notePaths,
    hrefOf: () => null,
    keepFrontmatter,
  });
  const pictures = userSpaceFiles(standalone.pictures.values());
  const names = attachmentFileNames(pictures.map((file) => file.path));
  const copyAt = new Map(
    pictures.map((file) => [file.path, `${SHARED_ATTACHMENTS_FOLDER}/${names.get(file.path)!}`]),
  );
  const pictureHref = (file: VaultFile) => {
    const at = copyAt.get(file.path);
    return at === undefined ? null : markdownHref(at);
  };
  const attachments: ApiExportAttachment[] = [...copyAt].map(([from, as]) => ({ path: from, as }));
  const rendered = standalone.render(pictureHref);
  return {
    path,
    format: 'standalone',
    title: note.title,
    markdown: rendered.markdown,
    attachments,
    dropped: rendered.dropped,
  };
}

/** Each picture once, in the order the note shows them; one outside user space is not the API's to name. */
function userSpaceFiles(files: Iterable<VaultFile>): VaultFile[] {
  const byPath = new Map<VaultPath, VaultFile>();
  for (const file of files) {
    if (isApiFilePath(file.path) && !byPath.has(file.path)) byPath.set(file.path, file);
  }
  return [...byPath.values()];
}

/**
 * The file's bytes as text, a byte-order mark and all. A file that is not
 * UTF-8 cannot be answered byte for byte in JSON, so it is refused rather
 * than answered changed.
 */
function textOf(note: { path: VaultPath; bytes: Uint8Array }): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(note.bytes);
  } catch {
    throw new ApiError(
      'invalid',
      `${note.path} is not UTF-8 text, so it cannot be answered as it is; export it from the app`,
    );
  }
}
