import { createVaultPath, parentVaultPath, type VaultEntry, type VaultPath } from '@atlas/domain';
import type {
  DestinationRequest,
  ExportFilesPort,
  GoogleDrivePort,
  PdfRendererPort,
} from '../export/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { fakeVaultFs } from './fake-ports.ts';

/**
 * A vault in memory that reads as the host reads one — bytes, text and each
 * folder's listing — and refuses every write, so an export that tried to
 * change the vault would fail its test.
 */
export function readOnlyVault(files: Record<string, string | Uint8Array>): VaultFsPort {
  const encoder = new TextEncoder();
  const bytesOf = (path: string): Uint8Array => {
    const held = files[path];
    if (held === undefined) throw new Error(`${path} is not in the vault`);
    return typeof held === 'string' ? encoder.encode(held) : held;
  };
  const refused = async (): Promise<never> => {
    throw new Error('an export wrote to the vault');
  };
  return fakeVaultFs({
    readBinaryFile: async (path) => bytesOf(path).slice().buffer,
    readTextFile: async (path) => ({ text: new TextDecoder().decode(bytesOf(path)), modified: 1 }),
    readNotes: async (paths) =>
      paths.flatMap((path) =>
        files[path] === undefined
          ? []
          : [{ path, text: new TextDecoder().decode(bytesOf(path)), modified: 1, size: 0 }],
      ),
    listDirectory: async (folder: VaultPath) => {
      const entries: VaultEntry[] = [];
      for (const path of Object.keys(files)) {
        if (parentVaultPath(createVaultPath(path)) !== folder) continue;
        const name = path.split('/').at(-1) ?? path;
        entries.push({
          kind: 'file',
          name,
          path: createVaultPath(path),
          size: bytesOf(path).length,
        });
      }
      return entries;
    },
    createNote: refused,
    createFolder: refused,
    moveEntry: refused,
    trashEntry: refused,
    writeTextFile: refused,
    writeBinaryFile: refused,
  });
}

/**
 * The host's export destinations in memory: `choose` answers with `picked`
 * (null cancels), and every file written is kept by its path, whole.
 */
export function recordingExportFiles(picked: { path: string; companion?: string | null } | null) {
  const state = {
    asked: [] as DestinationRequest[],
    written: new Map<string, Uint8Array>(),
    finished: 0,
    discarded: 0,
    failWrite: null as Error | null,
  };
  const port: ExportFilesPort = {
    choose: async (request) => {
      state.asked.push(request);
      if (picked === null) return null;
      return { id: 'grant-1', path: picked.path, companion: picked.companion ?? null };
    },
    write: async ({ destination, path, bytes }) => {
      if (state.failWrite !== null) throw state.failWrite;
      // A write to a destination it was not handed would be the host's to refuse.
      if (destination.id !== 'grant-1') throw new Error('not an open destination');
      state.written.set(path, bytes);
    },
    finish: async (_destination, { discard }) => {
      state.finished += 1;
      // As the host takes back what a failed export made.
      if (discard) {
        state.discarded += 1;
        state.written.clear();
      }
    },
  };
  return { port, state };
}

/** A PDF renderer that answers with the page it was handed, after a PDF's header. */
export function fakePdfRenderer(): PdfRendererPort & { readonly pages: string[] } {
  const pages: string[] = [];
  return {
    pages,
    pagingScript: 'document.documentElement.dataset.pages = "1";',
    render: async ({ html }) => {
      pages.push(html);
      return new TextEncoder().encode(`%PDF-1.7\n${html.length}`);
    },
  };
}

/** Google Drive in memory: folders by name, and every Doc uploaded. */
export function fakeGoogleDrive(folders: Record<string, string> = {}) {
  const state = {
    folders: { ...folders },
    uploads: [] as { title: string; html: string; folderId: string }[],
    /** What each upload in turn throws instead of making its Doc; undefined lets it through. */
    uploadFailures: [] as (Error | undefined)[],
  };
  const port: GoogleDrivePort = {
    findFolder: async ({ name }) => state.folders[name] ?? null,
    createFolder: async ({ name }) => {
      const id = `folder-${Object.keys(state.folders).length + 1}`;
      state.folders[name] = id;
      return id;
    },
    uploadDocument: async ({ title, html, folderId }) => {
      const failure = state.uploadFailures.shift();
      if (failure !== undefined) throw failure;
      state.uploads.push({ title, html, folderId });
      const id = `doc-${state.uploads.length}`;
      return { id, url: `https://docs.example.com/document/d/${id}/edit` };
    },
  };
  return { port, state };
}
