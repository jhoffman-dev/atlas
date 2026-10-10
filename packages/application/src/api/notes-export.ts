import { exportNoteForConfluence } from '../notes/export-for-confluence.ts';
import { listVaultNotes } from '../vault/read-vault.ts';
import { ApiError } from './api-error.ts';
import type { ApiNoteExport } from './contract.ts';
import { notePathOf, readNote } from './note-io.ts';
import { isApiNotePath } from './paths.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/**
 * A note as markdown for a Confluence page (P32-07), for Claude's Atlassian
 * connector to write: Atlas writes nothing, here or anywhere else. Its links
 * and shown blocks are read from user space alone, so nothing in `.atlas` or a
 * hidden folder reaches the page — a link there is shared as it is written.
 */
export async function exportNoteRoute(request: VaultRequest): Promise<RouteResult> {
  const format = formatOf(request.query['format']);
  const path = await notePathOf(request);
  const { text } = await readNote(request, path);
  const notePaths = (await listVaultNotes({ fs: request.fs })).filter(isApiNotePath);
  const exported = await exportNoteForConfluence({
    fs: request.fs,
    markdown: request.markdown,
    index: request.index,
    note: { path, text },
    notePaths,
  });
  request.assertStillOpen();
  const answer: ApiNoteExport = { path, format, ...exported };
  return { status: 200, body: { export: answer } };
}

/** The format asked for: Confluence is the only one, and it is asked for by name. */
function formatOf(raw: string | undefined): ApiNoteExport['format'] {
  if (raw === 'confluence') return raw;
  throw new ApiError('invalid', 'format must be "confluence"');
}
