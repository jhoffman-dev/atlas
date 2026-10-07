import type { HttpRequest, SqliteRows } from '@atlas/domain';

/**
 * Fetching text from outside the vault.
 *
 * One method, because that is all a source needs: the host fetches bytes and
 * hands back text. What the text means — which format it is, which fields
 * become which properties — is decided here, never there.
 *
 * The request names secrets rather than holding them. The host fills each one
 * in from the keychain as the request leaves, so no secret's value ever
 * crosses into this side of the app.
 */
export interface HttpPort {
  /** `vault` is the vault the refresh runs in, whose secrets the host fills in. */
  get(args: { request: HttpRequest; vault: string }): Promise<string>;
}

/**
 * A refusal from the host while fetching: a scheme that is not http, a request
 * that timed out, a response too large to hold, a status that is not success,
 * a secret that is not set. Adapters wrap whatever the host sends in this, in
 * the same way `VaultAccessError` wraps a refusal from the filesystem.
 */
export class HttpFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpFetchError';
  }
}

/**
 * Someone else's SQLite file, read and never written.
 *
 * `file` is vault-relative, or absolute for a file outside the vault — which
 * the host opens only if it was picked on this machine.
 */
export interface SqliteSourcePort {
  query(args: { file: string; sql: string }): Promise<SqliteRows>;
  /** Asks for a file with the system dialog; its absolute path, or null when cancelled. */
  pick(): Promise<string | null>;
}

/** A refusal from the host while reading a SQLite file: a write, a pending WAL, a file not picked. */
export class SqliteSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqliteSourceError';
  }
}

/**
 * The secrets of the open vault, by name.
 *
 * There is deliberately no way to read one back: a value goes in, and only the
 * host ever takes it out again, to send it.
 */
export interface SecretStorePort {
  list(): Promise<readonly StoredSecret[]>;
  /**
   * Stores or replaces. `vault` is the vault the value was typed for.
   * `origins`, when given, are where it may be sent from now on; left out, the
   * sites it was bound to are kept.
   */
  set(args: {
    name: string;
    value: string;
    vault: string;
    origins?: readonly string[];
  }): Promise<void>;
  /**
   * Changes where a stored secret may be sent. The host asks the person,
   * natively, before a value it holds may go to a site it was not bound to.
   */
  bind(args: { name: string; origins: readonly string[]; vault: string }): Promise<void>;
  remove(args: { name: string; vault: string }): Promise<void>;
}

/** A secret as the host lists it: its name, and the origins it may be sent to. */
export interface StoredSecret {
  readonly name: string;
  /** Empty for a secret set before bindings existed, which is sent nowhere until bound. */
  readonly origins: readonly string[];
}

/** A refusal from the keychain: access denied, or no keychain on this machine. */
export class SecretStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretStoreError';
  }
}
