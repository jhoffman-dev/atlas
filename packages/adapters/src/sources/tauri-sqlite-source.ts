import { invoke } from '@tauri-apps/api/core';
import type { SqliteRows } from '@atlas/domain';
import { SqliteSourceError, type SqliteSourcePort } from '@atlas/application';
import { throughHost } from '../vault/host-error.ts';

const refused = (message: string) => new SqliteSourceError(message);

/**
 * Someone else's SQLite file, through the host.
 *
 * Every guard — read-only and immutable, the statement check, the row cap,
 * which files outside the vault may be opened — is in Rust, where the file is
 * opened. This end only translates.
 */
export const tauriSqliteSource: SqliteSourcePort = {
  query({ file, sql }) {
    return throughHost(invoke<SqliteRows>('sqlite_source_query', { file, sql }), refused);
  },
  pick() {
    return throughHost(invoke<string | null>('pick_sqlite_file'), refused);
  },
};
