import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SecretStoreError, SqliteSourceError } from '@atlas/application';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

const { tauriSecrets } = await import('./tauri-secrets.ts');
const { tauriSqliteSource } = await import('./tauri-sqlite-source.ts');

describe('tauriSecrets', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('lists names and where each is sent from the host', async () => {
    const listed = [{ name: 'github', origins: ['https://api.github.com'] }];
    invoke.mockResolvedValue(listed);
    await expect(tauriSecrets.list()).resolves.toEqual(listed);
    expect(invoke).toHaveBeenCalledWith('secret_list');
  });

  it('hands a value to the host with the vault it was typed for', async () => {
    invoke.mockResolvedValue(null);
    await tauriSecrets.set({ name: 'github', value: 'ghp_1', vault: '/v' });
    expect(invoke).toHaveBeenCalledWith('secret_set', {
      name: 'github',
      value: 'ghp_1',
      vault: '/v',
    });
  });

  it('hands the sites a value is bound to along with it', async () => {
    invoke.mockResolvedValue(null);
    const origins = ['https://api.github.com'];
    await tauriSecrets.set({ name: 'github', value: 'ghp_1', vault: '/v', origins });
    expect(invoke).toHaveBeenCalledWith('secret_set', {
      name: 'github',
      value: 'ghp_1',
      vault: '/v',
      origins,
    });
  });

  it('binds a stored secret to sites', async () => {
    invoke.mockResolvedValue(null);
    const origins = ['https://api.test'];
    await tauriSecrets.bind({ name: 'legacy', origins, vault: '/v' });
    expect(invoke).toHaveBeenCalledWith('secret_bind', { name: 'legacy', origins, vault: '/v' });
  });

  it('removes by name', async () => {
    invoke.mockResolvedValue(null);
    await tauriSecrets.remove({ name: 'github', vault: '/v' });
    expect(invoke).toHaveBeenCalledWith('secret_delete', { name: 'github', vault: '/v' });
  });

  it('has no way to ask for a value back', () => {
    expect(Object.keys(tauriSecrets).sort()).toEqual(['bind', 'list', 'remove', 'set']);
  });

  it('turns a keychain refusal into an error', async () => {
    invoke.mockRejectedValue('the keychain refused access');
    const error = await tauriSecrets.list().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(SecretStoreError);
    expect((error as Error).message).toBe('the keychain refused access');
  });
});

describe('tauriSqliteSource', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('asks the host to run the query on the file', async () => {
    const rows = { columns: ['id'], rows: [[1]], truncated: false };
    invoke.mockResolvedValue(rows);
    await expect(tauriSqliteSource.query({ file: 'a.db', sql: 'SELECT 1' })).resolves.toEqual(rows);
    expect(invoke).toHaveBeenCalledWith('sqlite_source_query', { file: 'a.db', sql: 'SELECT 1' });
  });

  it('asks the host to pick a file', async () => {
    invoke.mockResolvedValue('/Users/me/app.db');
    await expect(tauriSqliteSource.pick()).resolves.toBe('/Users/me/app.db');
    expect(invoke).toHaveBeenCalledWith('pick_sqlite_file');
  });

  it('turns a refusal into an error', async () => {
    invoke.mockRejectedValue('this is not a SQLite database');
    const error = await tauriSqliteSource
      .query({ file: 'a.db', sql: 'SELECT 1' })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(SqliteSourceError);
  });
});
