import { invoke } from '@tauri-apps/api/core';
import { createVaultPath, type VaultEntry, type VaultPath } from '@atlas/domain';
import type { HostVaultFsPort, NoteContents } from '@atlas/application';
import { throughHost } from './host-error.ts';

/** The shape the Rust side sends back. Validated here before it becomes a domain type. */
interface RawEntry {
  name: string;
  path: string;
  kind: string;
  modified: number;
  size: number;
}

interface RawNoteFile {
  path: string;
  text: string;
  modified: number;
  size: number;
}

function toEntry(raw: RawEntry): VaultEntry {
  const path = createVaultPath(raw.path);
  if (raw.kind === 'directory') return { kind: 'directory', name: raw.name, path };
  return {
    kind: 'file',
    name: raw.name,
    path,
    ...(typeof raw.modified === 'number' && { modified: raw.modified }),
    ...(typeof raw.size === 'number' && { size: raw.size }),
  };
}

export const tauriVaultFs: HostVaultFsPort = {
  async listDirectory(path: VaultPath) {
    const raw = await throughHost(invoke<RawEntry[]>('list_directory', { path }));
    return raw.map(toEntry);
  },

  async listNotes({
    skipDirectories,
    maxDepth,
  }: {
    skipDirectories: readonly string[];
    maxDepth: number;
  }) {
    const raw = await throughHost(
      invoke<RawEntry[]>('list_notes', { skipDirectories: [...skipDirectories], maxDepth }),
    );
    return raw.map((note) => ({
      name: note.name,
      path: createVaultPath(note.path),
      modified: note.modified,
      size: note.size,
    }));
  },

  readNotes(paths: readonly string[]) {
    return throughHost(invoke<RawNoteFile[]>('read_notes', { paths }));
  },

  readTextFile(path: VaultPath) {
    return throughHost(invoke<NoteContents>('read_text_file', { path }));
  },

  readBinaryFile(path: VaultPath) {
    return throughHost(invoke<ArrayBuffer>('read_binary_file', { path }));
  },

  // `vault` is passed on for the host to compare with the vault it has open;
  // which vault a write belongs to is decided before it gets here.
  async createNote({
    path,
    contents,
    vault,
  }: {
    path: VaultPath;
    contents: string;
    vault: string;
  }) {
    await throughHost(invoke('create_note', { path, contents, vault }));
  },

  async createFolder({ path, vault }: { path: VaultPath; vault: string }) {
    await throughHost(invoke('create_folder', { path, vault }));
  },

  async moveEntry({ from, to, vault }: { from: VaultPath; to: VaultPath; vault: string }) {
    await throughHost(invoke('move_entry', { from, to, vault }));
  },

  async trashEntry({ path, vault }: { path: VaultPath; vault: string }) {
    await throughHost(invoke('trash_entry', { path, vault }));
  },

  writeTextFile({
    path,
    contents,
    expectedModified,
    vault,
  }: {
    path: VaultPath;
    contents: string;
    expectedModified: number | null;
    vault: string;
  }) {
    return throughHost(
      invoke<number>('write_text_file', { path, contents, expectedModified, vault }),
    );
  },

  // The bytes go as the raw body rather than a JSON array of numbers, which
  // would be four times their size; what they are for goes in headers, which
  // carry only ASCII, so the path and vault are percent-encoded.
  writeBinaryFile({
    path,
    bytes,
    offset,
    replace = false,
    vault,
  }: {
    path: VaultPath;
    bytes: Uint8Array;
    offset: number;
    replace?: boolean;
    vault: string;
  }) {
    const headers: Record<string, string> = {
      [BINARY_HEADERS.path]: encodeURIComponent(path),
      [BINARY_HEADERS.offset]: String(offset),
      ...(replace && { [BINARY_HEADERS.replace]: '1' }),
      [BINARY_HEADERS.vault]: encodeURIComponent(vault),
    };
    return throughHost(invoke<number>('write_binary_file', bytes, { headers }));
  },
};

/** The headers `write_binary_file` reads, as `vault.rs` names them. */
export const BINARY_HEADERS = {
  path: 'atlas-path',
  offset: 'atlas-offset',
  vault: 'atlas-vault',
  replace: 'atlas-replace',
} as const;
