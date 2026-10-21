import {
  defaultDriveFolderName,
  MAX_GOOGLE_DOC_HTML_BYTES,
  scopesWithDrive,
  type VaultPath,
} from '@atlas/domain';
import type { GoogleCalendarPort } from '../google-calendar/ports.ts';
import type { NotePageRenderer } from '../thumbnails/ports.ts';
import type { ExportReadPorts } from './export-reading.ts';
import { notePage, readNoteToExport } from './note-for-export.ts';
import { ExportError, type GoogleDrivePort } from './ports.ts';

export interface GoogleDocsPorts extends ExportReadPorts {
  readonly renderer: NotePageRenderer;
  /** The Calendar's sign-in, which the export reuses (ADR-0030). */
  readonly google: GoogleCalendarPort;
  readonly drive: GoogleDrivePort;
}

export interface ExportedDocs {
  readonly kind: 'uploaded';
  readonly folder: string;
  readonly documents: readonly { readonly title: string; readonly url: string }[];
  readonly picturesLeftOut: number;
}

const NOT_SET_UP =
  'Google is not connected for this vault. Connect it in Settings → Google Calendar, then export again.';

/**
 * Makes sure the sign-in reaches Drive: once, the person is asked to allow
 * the one more scope (`drive.file`) on top of what they allowed before. The
 * tokens stay with the host; nothing here sees one.
 */
async function ensureDriveAccess(google: GoogleCalendarPort, vault: string): Promise<void> {
  const connection = await google.status({ vault });
  if (!connection.connected || connection.clientId === null) {
    throw new ExportError('google-not-set-up', NOT_SET_UP);
  }
  const scopes = scopesWithDrive(connection.scopes);
  if (scopes === null) return;
  await google.connect({ vault, clientId: connection.clientId, scopes });
}

/**
 * Each note as a Google Doc in the person's Drive (#501), titled as the
 * note, in the folder named `folderName` — the one this app made before, or
 * a new one. Each is made from the page a PDF is made from, without its
 * script, uploaded as HTML for Google to convert. Nothing in the vault changes.
 */
export async function exportGoogleDocs(
  ports: GoogleDocsPorts,
  {
    vault,
    paths,
    notePaths,
    appName,
  }: {
    vault: string;
    paths: readonly VaultPath[];
    notePaths: readonly VaultPath[];
    /** The app's own name: the default folder is named after it. */
    appName: string;
  },
): Promise<ExportedDocs> {
  if (paths.length === 0) throw new ExportError('failed', 'No notes were chosen to export.');
  const pages = [];
  for (const path of paths) {
    const note = await readNoteToExport(ports, path);
    const page = await notePage(ports, { note, notePaths, script: null });
    if (new TextEncoder().encode(page.html).byteLength > MAX_GOOGLE_DOC_HTML_BYTES) {
      throw new ExportError(
        'too-large',
        `${note.title} is too large for Google Docs: with its pictures it comes to more than 45 MB.`,
      );
    }
    pages.push({ title: note.title, ...page });
  }
  await ensureDriveAccess(ports.google, vault);
  const folder = defaultDriveFolderName(appName);
  const folderId =
    (await ports.drive.findFolder({ vault, name: folder })) ??
    (await ports.drive.createFolder({ vault, name: folder }));
  const documents = [];
  for (const page of pages) {
    const made = await ports.drive.uploadDocument({
      vault,
      title: page.title,
      html: page.html,
      folderId,
    });
    documents.push({ title: page.title, url: made.url });
  }
  return {
    kind: 'uploaded',
    folder,
    documents,
    picturesLeftOut: pages.reduce((sum, page) => sum + page.picturesLeftOut, 0),
  };
}
