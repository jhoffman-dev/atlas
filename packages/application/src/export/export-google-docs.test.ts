import { describe, expect, it } from 'vitest';
import {
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_DRIVE_FILE_SCOPE,
  MAX_GOOGLE_DOC_HTML_BYTES,
  type VaultPath,
} from '@atlas/domain';
import { fakeGoogleCalendar } from '../testing/fake-google-calendar.ts';
import { fakeGoogleDrive, readOnlyVault } from '../testing/fake-export.ts';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { blockMarkdown } from '../testing/block-markdown.ts';
import { ExportError, exportGoogleDocs, exportSummary } from './index.ts';

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
  const ports = {
    fs: readOnlyVault(files),
    markdown: blockMarkdown(),
    index: fakeIndexPort(),
    renderer: { bodyHtml, styles: '' },
    google: google.port,
    drive: drive.port,
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
  return { run, drive: drive.state, google, connects };
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
});
