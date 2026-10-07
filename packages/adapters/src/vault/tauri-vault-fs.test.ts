import { describe, expect, it, vi, beforeEach } from 'vitest';
import { VaultAccessError } from '@atlas/application';
import { InvalidVaultPathError, VAULT_ROOT, createVaultPath } from '@atlas/domain';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { tauriVaultFs } = await import('./tauri-vault-fs.ts');

describe('tauriVaultFs.listDirectory', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('asks the host for the requested directory', async () => {
    invoke.mockResolvedValue([]);
    await tauriVaultFs.listDirectory(createVaultPath('Notes'));
    expect(invoke).toHaveBeenCalledWith('list_directory', { path: 'Notes' });
  });

  it('turns raw host entries into domain entries', async () => {
    invoke.mockResolvedValue([
      { name: 'Notes', path: 'Notes', kind: 'directory' },
      { name: 'a.md', path: 'a.md', kind: 'file' },
    ]);
    const entries = await tauriVaultFs.listDirectory(VAULT_ROOT);
    expect(entries).toEqual([
      { kind: 'directory', name: 'Notes', path: 'Notes' },
      { kind: 'file', name: 'a.md', path: 'a.md' },
    ]);
  });

  it("keeps a file's modified time and size, so an image too big is never read", async () => {
    invoke.mockResolvedValue([
      { name: 'Notes', path: 'Notes', kind: 'directory', modified: 5, size: 0 },
      { name: 'a.png', path: 'a.png', kind: 'file', modified: 1_700_000, size: 3 },
    ]);
    const entries = await tauriVaultFs.listDirectory(VAULT_ROOT);
    expect(entries).toEqual([
      { kind: 'directory', name: 'Notes', path: 'Notes' },
      { kind: 'file', name: 'a.png', path: 'a.png', modified: 1_700_000, size: 3 },
    ]);
  });

  it('treats an unrecognised kind as a file rather than trusting the host', async () => {
    invoke.mockResolvedValue([{ name: 'odd', path: 'odd', kind: 'socket' }]);
    const [entry] = await tauriVaultFs.listDirectory(VAULT_ROOT);
    expect(entry?.kind).toBe('file');
  });

  it('refuses a host path that would escape the vault', async () => {
    invoke.mockResolvedValue([{ name: 'evil', path: '../evil', kind: 'file' }]);
    await expect(tauriVaultFs.listDirectory(VAULT_ROOT)).rejects.toThrow(InvalidVaultPathError);
  });

  it('propagates a host error', async () => {
    invoke.mockImplementation(() => Promise.reject(new VaultAccessError('no vault is open')));
    await expect(tauriVaultFs.listDirectory(VAULT_ROOT)).rejects.toThrow('no vault is open');
  });
});

describe('tauriVaultFs.listNotes', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('passes the folders it was told to skip, and how deep to go, on to the host', async () => {
    invoke.mockResolvedValue([]);
    await tauriVaultFs.listNotes({ skipDirectories: ['.git', 'node_modules'], maxDepth: 7 });
    expect(invoke).toHaveBeenCalledWith('list_notes', {
      skipDirectories: ['.git', 'node_modules'],
      maxDepth: 7,
    });
  });

  it('asks for the whole tree when nothing is to be skipped', async () => {
    invoke.mockResolvedValue([]);
    await tauriVaultFs.listNotes({ skipDirectories: [], maxDepth: 32 });
    expect(invoke).toHaveBeenCalledWith('list_notes', { skipDirectories: [], maxDepth: 32 });
  });

  it('keeps the file facts the index needs, and decides nothing itself', async () => {
    // Including the dotted paths the host now reports: filtering them is the
    // frontend's job and happens a layer up, not here.
    invoke.mockResolvedValue([
      { name: 'a.md', path: 'a.md', kind: 'file', modified: 12, size: 34 },
      { name: 'task.md', path: '.atlas/types/task.md', kind: 'file', modified: 5, size: 6 },
    ]);
    await expect(tauriVaultFs.listNotes({ skipDirectories: [], maxDepth: 32 })).resolves.toEqual([
      { name: 'a.md', path: 'a.md', modified: 12, size: 34 },
      { name: 'task.md', path: '.atlas/types/task.md', modified: 5, size: 6 },
    ]);
  });

  it('refuses a host path that would escape the vault', async () => {
    invoke.mockResolvedValue([
      { name: 'evil.md', path: '../evil.md', kind: 'file', modified: 1, size: 1 },
    ]);
    await expect(tauriVaultFs.listNotes({ skipDirectories: [], maxDepth: 32 })).rejects.toThrow(
      InvalidVaultPathError,
    );
  });

  it('propagates a host error', async () => {
    invoke.mockImplementation(() => Promise.reject(new VaultAccessError('no vault is open')));
    await expect(tauriVaultFs.listNotes({ skipDirectories: [], maxDepth: 32 })).rejects.toThrow(
      'no vault is open',
    );
  });
});

describe('tauriVaultFs.readTextFile', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('returns the text the host read', async () => {
    invoke.mockResolvedValue('# Today\n');
    await expect(tauriVaultFs.readTextFile(createVaultPath('a.md'))).resolves.toBe('# Today\n');
    expect(invoke).toHaveBeenCalledWith('read_text_file', { path: 'a.md' });
  });

  it('propagates a host refusal, such as a file that is not text', async () => {
    invoke.mockImplementation(() => Promise.reject(new VaultAccessError('not a text file')));
    await expect(tauriVaultFs.readTextFile(createVaultPath('a.png'))).rejects.toThrow(
      'not a text file',
    );
  });
});

describe('tauriVaultFs writes', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(0);
  });

  const notes = createVaultPath('notes.md');

  it('passes the vault a save was meant for on to the host, to compare', async () => {
    await tauriVaultFs.writeTextFile({
      path: notes,
      contents: 'x',
      expectedModified: 7,
      vault: '/vaults/a',
    });
    expect(invoke).toHaveBeenCalledWith('write_text_file', {
      path: 'notes.md',
      contents: 'x',
      expectedModified: 7,
      vault: '/vaults/a',
    });
  });

  it('passes the vault on for a create, a move, a new folder and a delete too', async () => {
    await tauriVaultFs.createNote({ path: notes, contents: '', vault: '/vaults/a' });
    await tauriVaultFs.moveEntry({ from: notes, to: createVaultPath('b.md'), vault: '/vaults/a' });
    await tauriVaultFs.createFolder({ path: createVaultPath('Projects'), vault: '/vaults/a' });
    await tauriVaultFs.trashEntry({ path: notes, vault: '/vaults/a' });
    expect(invoke).toHaveBeenCalledWith('create_note', {
      path: 'notes.md',
      contents: '',
      vault: '/vaults/a',
    });
    expect(invoke).toHaveBeenCalledWith('move_entry', {
      from: 'notes.md',
      to: 'b.md',
      vault: '/vaults/a',
    });
    expect(invoke).toHaveBeenCalledWith('create_folder', { path: 'Projects', vault: '/vaults/a' });
    expect(invoke).toHaveBeenCalledWith('trash_entry', { path: 'notes.md', vault: '/vaults/a' });
  });

  it('surfaces a refused delete as an error, never as success', async () => {
    invoke.mockImplementation(() => Promise.reject('cannot move to the Trash: denied'));
    await expect(tauriVaultFs.trashEntry({ path: notes, vault: '/a' })).rejects.toThrow(
      'cannot move to the Trash',
    );
  });

  it('surfaces the refusal of a write meant for a vault that is no longer open', async () => {
    invoke.mockImplementation(() =>
      Promise.reject('another vault was opened before this could be written'),
    );
    await expect(
      tauriVaultFs.writeTextFile({ path: notes, contents: 'x', expectedModified: 7, vault: '/a' }),
    ).rejects.toThrow(VaultAccessError);
  });
});

describe('tauriVaultFs.writeBinaryFile', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('sends the bytes as the raw body and what they are for as encoded headers', async () => {
    invoke.mockResolvedValue(3);
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(
      tauriVaultFs.writeBinaryFile({
        path: createVaultPath('artifacts/café deck/index.html'),
        bytes,
        offset: 0,
        vault: '/Users/j/Vault ü',
      }),
    ).resolves.toBe(3);
    expect(invoke).toHaveBeenCalledWith('write_binary_file', bytes, {
      headers: {
        'atlas-path': 'artifacts%2Fcaf%C3%A9%20deck%2Findex.html',
        'atlas-offset': '0',
        'atlas-vault': '%2FUsers%2Fj%2FVault%20%C3%BC',
      },
    });
  });

  it('asks for a whole-file replace only when told to', async () => {
    invoke.mockResolvedValue(1);
    const bytes = new Uint8Array([9]);
    await tauriVaultFs.writeBinaryFile({
      path: createVaultPath('a/atlas-thumbnail.png'),
      bytes,
      offset: 0,
      replace: true,
      vault: '/a',
    });
    expect(invoke).toHaveBeenCalledWith('write_binary_file', bytes, {
      headers: {
        'atlas-path': 'a%2Fatlas-thumbnail.png',
        'atlas-offset': '0',
        'atlas-replace': '1',
        'atlas-vault': '%2Fa',
      },
    });
  });

  it('always names the vault, and reports a refusal as a VaultAccessError (R14-04)', async () => {
    invoke.mockImplementation(() =>
      Promise.reject('the file is not the length the write expected'),
    );
    await expect(
      tauriVaultFs.writeBinaryFile({
        path: createVaultPath('a/b.png'),
        bytes: new Uint8Array(1),
        offset: 5,
        vault: '/a',
      }),
    ).rejects.toThrow(VaultAccessError);
    expect(invoke.mock.calls[0]?.[2]).toEqual({
      headers: { 'atlas-path': 'a%2Fb.png', 'atlas-offset': '5', 'atlas-vault': '%2Fa' },
    });
  });
});
