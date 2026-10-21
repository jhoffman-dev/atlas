/**
 * The Drive adapter against a fake Drive on this machine's loopback (#501):
 * the host command is played by a hop to a local HTTP server, so the calls
 * this side builds are real requests — a query Drive must read, a multipart
 * body it must split — and nothing reaches Google.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GOOGLE_DOC_MIME_TYPE, GOOGLE_FOLDER_MIME_TYPE } from '@dfai/domain';
import { GoogleCalendarError } from '@dfai/application';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { tauriGoogleDrive, driveQuoted, boundaryFor } = await import('./tauri-google-drive.ts');

const VAULT = '/Users/someone/Vault';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  html?: string;
}

/** Drive, as much of it as an export uses. */
const drive = {
  files: [] as DriveFile[],
  answer: null as { status: number; body: string } | null,
};

const read = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    request.on('end', () => resolve(body));
  });

/** A Drive query of the one shape an export asks: name, kind and not trashed. */
function matches(query: string, file: DriveFile): boolean {
  const name = /name = '((?:\\.|[^'\\])*)'/.exec(query)?.[1]?.replace(/\\(.)/g, '$1');
  const kind = /mimeType = '([^']*)'/.exec(query)?.[1];
  return (
    file.name === name &&
    file.mimeType === kind &&
    (!query.includes('trashed = false') || !file.trashed)
  );
}

function multipartParts(body: string, contentType: string): { type: string; content: string }[] {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1] ?? '';
  return body
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((part) => {
      const [head = '', ...rest] = part.replace(/^\r\n/, '').split('\r\n\r\n');
      return {
        type: /Content-Type: ([^\r\n;]+)/.exec(head)?.[1] ?? '',
        content: rest.join('\r\n\r\n').replace(/\r\n$/, ''),
      };
    });
}

async function serve(request: IncomingMessage): Promise<{ status: number; body: string }> {
  if (drive.answer !== null) return drive.answer;
  const url = new URL(request.url ?? '/', 'http://drive.test');
  const body = await read(request);
  if (request.method === 'GET' && url.pathname === '/drive/v3/files') {
    const query = url.searchParams.get('q') ?? '';
    const found = drive.files.filter((file) => matches(query, file)).map(({ id }) => ({ id }));
    return { status: 200, body: JSON.stringify({ files: found }) };
  }
  if (request.method === 'POST' && url.pathname === '/drive/v3/files') {
    const metadata = JSON.parse(body) as { name: string; mimeType: string };
    const id = `folder-${drive.files.length + 1}`;
    drive.files.push({ id, ...metadata, parents: [], trashed: false });
    return { status: 200, body: JSON.stringify({ id }) };
  }
  if (request.method === 'POST' && url.pathname === '/upload/drive/v3/files') {
    if (url.searchParams.get('uploadType') !== 'multipart') return { status: 400, body: '{}' };
    const parts = multipartParts(body, request.headers['content-type'] ?? '');
    const metadata = JSON.parse(parts[0]?.content ?? '{}') as Omit<DriveFile, 'id' | 'trashed'>;
    const id = `doc-${drive.files.length + 1}`;
    drive.files.push({ id, ...metadata, trashed: false, html: parts[1]?.content ?? '' });
    const types = parts.map((part) => part.type);
    if (types.join() !== 'application/json,text/html') return { status: 400, body: '{}' };
    return {
      status: 200,
      body: JSON.stringify({ id, webViewLink: `https://docs.example.com/document/d/${id}/edit` }),
    };
  }
  return { status: 404, body: '{"error":{"code":404}}' };
}

let server: Server;
let origin = '';

beforeAll(async () => {
  server = createServer((request, response) => {
    void serve(request).then(({ status, body }) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  drive.files = [];
  drive.answer = null;
  invoke.mockReset();
  // The host's part: the call is sent as built, its body under the type it names.
  invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    expect(command).toBe('google_drive_request');
    expect(args['vault']).toBe(VAULT);
    const call = args['call'] as {
      method: string;
      path: string;
      body?: string;
      contentType?: string;
    };
    const response = await fetch(origin + call.path, {
      method: call.method,
      ...(call.body !== undefined && {
        body: call.body,
        headers: { 'content-type': call.contentType ?? 'application/json' },
      }),
    });
    return { status: response.status, body: await response.text() };
  });
});

describe('tauriGoogleDrive (#501)', () => {
  it('finds no folder, makes one, then finds it again', async () => {
    const name = 'Northwind exports';
    expect(await tauriGoogleDrive.findFolder({ vault: VAULT, name })).toBeNull();
    const id = await tauriGoogleDrive.createFolder({ vault: VAULT, name });
    expect(drive.files).toEqual([
      { id, name, mimeType: GOOGLE_FOLDER_MIME_TYPE, parents: [], trashed: false },
    ]);
    expect(await tauriGoogleDrive.findFolder({ vault: VAULT, name })).toBe(id);
  });

  it('finds a folder whose name holds quotes and backslashes, and not one in the trash', async () => {
    const name = "Mara's \\ exports";
    drive.files.push(
      { id: 'gone', name, mimeType: GOOGLE_FOLDER_MIME_TYPE, parents: [], trashed: true },
      { id: 'kept', name, mimeType: GOOGLE_FOLDER_MIME_TYPE, parents: [], trashed: false },
    );
    expect(await tauriGoogleDrive.findFolder({ vault: VAULT, name })).toBe('kept');
    expect(driveQuoted("a'b\\c")).toBe("'a\\'b\\\\c'");
  });

  it('uploads the page as HTML for Google to make a Doc of, titled and in the folder', async () => {
    const html = '<!doctype html><p>Agreed — Friday.</p><p>--atlas-export-1</p>';
    const made = await tauriGoogleDrive.uploadDocument({
      vault: VAULT,
      title: 'Kickoff with Larkspur',
      html,
      folderId: 'folder-9',
    });
    expect(made).toEqual({ id: 'doc-1', url: 'https://docs.example.com/document/d/doc-1/edit' });
    expect(drive.files[0]).toEqual({
      id: 'doc-1',
      name: 'Kickoff with Larkspur',
      mimeType: GOOGLE_DOC_MIME_TYPE,
      parents: ['folder-9'],
      trashed: false,
      html,
    });
  });

  it('picks a boundary the page does not hold', () => {
    expect(boundaryFor('plain')).toBe('atlas-export-1');
    expect(boundaryFor('atlas-export-1 atlas-export-2')).toBe('atlas-export-3');
  });

  it('says what Drive refused, with its status', async () => {
    drive.answer = { status: 403, body: '{"error":{"code":403}}' };
    const refused = tauriGoogleDrive.findFolder({ vault: VAULT, name: 'x' });
    await expect(refused).rejects.toBeInstanceOf(GoogleCalendarError);
    await expect(refused).rejects.toMatchObject({ failure: { kind: 'api_refused', code: '403' } });
  });

  it('calls an answer that is not JSON, or a Doc with no id, malformed', async () => {
    drive.answer = { status: 200, body: '<html>captive portal</html>' };
    await expect(tauriGoogleDrive.createFolder({ vault: VAULT, name: 'x' })).rejects.toMatchObject({
      failure: { kind: 'malformed' },
    });
    drive.answer = { status: 200, body: '{"name":"x"}' };
    await expect(
      tauriGoogleDrive.uploadDocument({ vault: VAULT, title: 't', html: '', folderId: 'f' }),
    ).rejects.toMatchObject({ failure: { kind: 'malformed' } });
  });

  it('hands on the host’s failure as Google’s, when Google cannot be reached', async () => {
    invoke.mockRejectedValue({ kind: 'unreachable', message: 'cannot reach Google: offline' });
    await expect(tauriGoogleDrive.findFolder({ vault: VAULT, name: 'x' })).rejects.toMatchObject({
      failure: { kind: 'unreachable', message: 'cannot reach Google: offline' },
    });
  });
});
