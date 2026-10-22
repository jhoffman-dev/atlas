import { describe, expect, it } from 'vitest';
import {
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_DRIVE_FILE_SCOPE,
  MAX_GOOGLE_DOC_HTML_BYTES,
  type VaultPath,
} from '@dfai/domain';
import { fakeGoogleCalendar } from '../testing/fake-google-calendar.ts';
import { fakeGoogleDrive, readOnlyVault } from '../testing/fake-export.ts';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { blockMarkdown } from '../testing/block-markdown.ts';
import { GoogleCalendarError } from '../google-calendar/ports.ts';
import { ExportError, exportGoogleDocs, exportSummary, PartlyExportedError } from './index.ts';

const VAULT = '/Users/someone/Vault';
const CLIENT = '1234-abc.apps.googleusercontent.com';
const KICKOFF = 'Kickoff.md' as VaultPath;
const RETRO = 'Retro.md' as VaultPath;

function setUp({
  scopes = GOOGLE_CALENDAR_SCOPES,
  connected = true,
  folders = {},
  files = { 'Kickoff.md': 'Agreed the plan.\n', 'Retro.md': 'Went well.\n' },
  bodyHtml = () => '<p>body</p>',
}: {
  bodyHtml?: () => string;
  scopes?: readonly string[];
  connected?: boolean;
  folders?: Record<string, string>;
  files?: Record<string, string>;
} = {}) {
  const google = fakeGoogleCalendar();
  const drive = fakeGoogleDrive(folders);
  const waits: number[] = [];
  const ports = {
    fs: readOnlyVault(files),
    markdown: blockMarkdown(),
    index: fakeIndexPort(),
    renderer: { bodyHtml, styles: '' },
    google: google.port,
    drive: drive.port,
    wait: async (milliseconds: number) => {
      waits.push(milliseconds);
    },
  };
  const ready = connected
    ? google.port.connect({ vault: VAULT, clientId: CLIENT, scopes })
    : Promise.resolve();
  const connects: (readonly string[])[] = [];
  const connect = google.port.connect;
  google.port.connect = async (args) => {
    connects.push(args.scopes);
    return connect(args);
  };
  const run = async (paths: VaultPath[]) => {
    await ready;
    return exportGoogleDocs(ports, {
      vault: VAULT,
      paths,
      notePaths: [KICKOFF, RETRO],
      appName: 'Northwind',
    });
  };
  return { run, drive: drive.state, google, connects, waits };
}

describe('exportGoogleDocs (#501)', () => {
  it('asks once for Drive on top of the Calendar’s scope, then makes a Doc per note in the default folder', async () => {
    const { run, drive, connects } = setUp();
    const outcome = await run([KICKOFF, RETRO]);

    expect(connects).toEqual([[...GOOGLE_CALENDAR_SCOPES, GOOGLE_DRIVE_FILE_SCOPE]]);
    expect(drive.folders).toEqual({ 'Northwind exports': 'folder-1' });
    expect(drive.uploads.map(({ title, folderId }) => ({ title, folderId }))).toEqual([
      { title: 'Kickoff', folderId: 'folder-1' },
      { title: 'Retro', folderId: 'folder-1' },
    ]);
    expect(drive.uploads[0]?.html).toContain('<h1 class="export__title">Kickoff</h1>');
    expect(drive.uploads[0]?.html).not.toContain('<script>');
    expect(outcome).toEqual({
      kind: 'uploaded',
      folder: 'Northwind exports',
      documents: [
        { title: 'Kickoff', url: 'https://docs.example.com/document/d/doc-1/edit' },
        { title: 'Retro', url: 'https://docs.example.com/document/d/doc-2/edit' },
      ],
      picturesLeftOut: 0,
    });
    expect(exportSummary(outcome)).toBe('Made 2 Google Docs in “Northwind exports” in your Drive.');
  });

  it('asks for nothing more once Drive is granted, and reuses the folder it made', async () => {
    const { run, drive, connects } = setUp({
      scopes: [...GOOGLE_CALENDAR_SCOPES, GOOGLE_DRIVE_FILE_SCOPE],
      folders: { 'Northwind exports': 'kept-folder' },
    });
    await run([KICKOFF]);
    expect(connects).toEqual([]);
    expect(drive.uploads[0]?.folderId).toBe('kept-folder');
  });

  it('says to connect Google first when the vault has no sign-in', async () => {
    const { run, drive } = setUp({ connected: false });
    await expect(run([KICKOFF])).rejects.toMatchObject({
      kind: 'google-not-set-up',
      message: expect.stringContaining('Settings → Google Calendar'),
    });
    expect(drive.uploads).toEqual([]);
  });

  it('makes nothing when the person does not allow Drive', async () => {
    const { run, drive, google } = setUp();
    google.state.next = new Error(
      'Google did not grant https://www.googleapis.com/auth/drive.file',
    );
    await expect(run([KICKOFF])).rejects.toThrow('did not grant');
    expect(drive.folders).toEqual({});
    expect(drive.uploads).toEqual([]);
  });

  it('refuses a note too large for Google to convert, before asking for anything', async () => {
    const { run, drive, connects } = setUp({
      bodyHtml: () => 'x'.repeat(MAX_GOOGLE_DOC_HTML_BYTES),
    });
    await expect(run([KICKOFF])).rejects.toMatchObject({
      kind: 'too-large',
      message: expect.stringContaining('Kickoff is too large for Google Docs'),
    });
    expect(connects).toEqual([]);
    expect(drive.uploads).toEqual([]);
  });

  it('refuses when no note was chosen', async () => {
    const { run } = setUp();
    await expect(run([])).rejects.toBeInstanceOf(ExportError);
  });

  const refused = (status: number) =>
    new GoogleCalendarError({
      kind: 'api_refused',
      code: String(status),
      message: `answered ${status}`,
    });

  it('tries again while Google says to slow down, waiting longer each time (#502)', async () => {
    const { run, drive, waits } = setUp();
    drive.uploadFailures.push(refused(429), refused(503));
    await expect(run([KICKOFF])).resolves.toMatchObject({ kind: 'uploaded' });
    expect(waits).toEqual([1_000, 2_000]);
    expect(drive.uploads).toHaveLength(1);
  });

  it('gives up after three tries, and never tries again what another try would not change', async () => {
    const tired = setUp();
    tired.drive.uploadFailures.push(refused(500), refused(500), refused(500), refused(500));
    await expect(tired.run([KICKOFF])).rejects.toMatchObject({ failure: { code: '500' } });
    expect(tired.waits).toEqual([1_000, 2_000, 4_000]);
    const denied = setUp();
    denied.drive.uploadFailures.push(refused(403));
    await expect(denied.run([KICKOFF])).rejects.toMatchObject({ failure: { code: '403' } });
    expect(denied.waits).toEqual([]);
  });

  it('says which Docs were made when one after them fails (#502)', async () => {
    const { run, drive } = setUp();
    drive.uploadFailures.push(undefined, refused(403));
    const failed = await run([KICKOFF, RETRO]).catch((cause: unknown) => cause);
    expect(failed).toBeInstanceOf(PartlyExportedError);
    const partly = failed as PartlyExportedError;
    expect(partly.documents).toEqual([
      { title: 'Kickoff', url: 'https://docs.example.com/document/d/doc-1/edit' },
    ]);
    expect(partly.message).toBe(
      'Made 1 of 2 Google Docs in “Northwind exports” before it stopped: answered 403',
    );
    expect(partly.cause).toBeInstanceOf(GoogleCalendarError);
  });
});
