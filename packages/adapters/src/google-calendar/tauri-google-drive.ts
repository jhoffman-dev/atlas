import { invoke } from '@tauri-apps/api/core';
import { GOOGLE_DOC_MIME_TYPE, GOOGLE_FOLDER_MIME_TYPE } from '@atlas/domain';
import { GoogleCalendarError, type GoogleDrivePort } from '@atlas/application';
import { googleErrorOf } from './tauri-google-calendar.ts';

/** A Drive API answer as the host hands it back, with every token struck from it. */
interface GoogleAnswer {
  readonly status: number;
  readonly body: string;
}

const malformed = (message: string) => new GoogleCalendarError({ kind: 'malformed', message });

async function callDrive(
  vault: string,
  call: { method: string; path: string; body?: string; contentType?: string },
): Promise<Record<string, unknown>> {
  let answer: GoogleAnswer;
  try {
    answer = await invoke<GoogleAnswer>('google_drive_request', { vault, call });
  } catch (rejection) {
    throw googleErrorOf(rejection);
  }
  if (answer.status < 200 || answer.status > 299) {
    throw new GoogleCalendarError({
      kind: 'api_refused',
      code: String(answer.status),
      message: `the Drive API answered ${answer.status}`,
    });
  }
  try {
    const read = JSON.parse(answer.body) as unknown;
    if (typeof read === 'object' && read !== null) return read as Record<string, unknown>;
  } catch {
    // Not JSON at all: said below, as an answer that is not one to read.
  }
  throw malformed('the Drive API did not answer with JSON');
}

/** A value written into a Drive query's quotes: its backslashes and quotes escaped. */
export const driveQuoted = (value: string): string =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** A boundary the page does not hold, so the parts cannot be read wrongly. */
export function boundaryFor(html: string): string {
  for (let count = 1; ; count += 1) {
    const boundary = `atlas-export-${count}`;
    if (!html.includes(boundary)) return boundary;
  }
}

/** The upload a Doc is made from: its metadata, then the page, as `multipart/related`. */
export function uploadBody({
  title,
  html,
  folderId,
}: {
  title: string;
  html: string;
  folderId: string;
}): { body: string; contentType: string } {
  const boundary = boundaryFor(html);
  const metadata = JSON.stringify({
    name: title,
    mimeType: GOOGLE_DOC_MIME_TYPE,
    parents: [folderId],
  });
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
    `--${boundary}--`,
  ].join('\r\n');
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

const idOf = (answer: Record<string, unknown>, what: string): string => {
  const id = answer['id'];
  if (typeof id !== 'string' || id === '') throw malformed(`the ${what} came back without an id`);
  return id;
};

/**
 * Google Drive through the host (ADR-0030, #501): the calls are built and
 * read here; the host adds the token, and lets them reach Drive's files and
 * its upload alone.
 */
export const tauriGoogleDrive: GoogleDrivePort = {
  async findFolder({ vault, name }) {
    const query = [
      `name = ${driveQuoted(name)}`,
      `mimeType = '${GOOGLE_FOLDER_MIME_TYPE}'`,
      'trashed = false',
    ].join(' and ');
    const path = `/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id)')}&pageSize=1`;
    const listed = await callDrive(vault, { method: 'GET', path });
    const files = listed['files'];
    if (!Array.isArray(files)) throw malformed('the Drive file list is not one to read');
    const [first] = files as unknown[];
    const id =
      typeof first === 'object' && first !== null ? (first as Record<string, unknown>)['id'] : null;
    return typeof id === 'string' && id !== '' ? id : null;
  },
  async createFolder({ vault, name }) {
    const body = JSON.stringify({ name, mimeType: GOOGLE_FOLDER_MIME_TYPE });
    return idOf(
      await callDrive(vault, { method: 'POST', path: '/drive/v3/files?fields=id', body }),
      'folder',
    );
  },
  async uploadDocument({ vault, title, html, folderId }) {
    const { body, contentType } = uploadBody({ title, html, folderId });
    const path = '/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';
    const made = await callDrive(vault, { method: 'POST', path, body, contentType });
    const id = idOf(made, 'Doc');
    const link = made['webViewLink'];
    const url =
      typeof link === 'string' && link.startsWith('https://')
        ? link
        : `https://docs.google.com/document/d/${encodeURIComponent(id)}/edit`;
    return { id, url };
  },
};
