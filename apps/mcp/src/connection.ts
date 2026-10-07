/**
 * Finding the running app: its base URL and bearer token.
 *
 * Atlas writes both to a connection file in its data directory when the API is
 * turned on (ADR-0016). Environment variables override the file, for scripts
 * and tests. Nothing here is cached: every call resolves again, so a rotated
 * token or a new port is picked up without restarting the MCP server.
 */

import { join } from 'node:path';

/** Tauri's bundle identifier, from `apps/desktop/src-tauri/tauri.conf.json`. */
export const BUNDLE_IDENTIFIER = 'dev.jhoffman.atlas';

const TURN_ON = 'Open Atlas and turn on the API in Settings → Connections.';

export interface Connection {
  /** `http://127.0.0.1:<port>`, with no trailing slash. */
  readonly baseUrl: string;
  readonly token: string;
}

/** Everything resolution reads from the outside world, so tests can stand it in. */
export interface ConnectionSource {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly homeDir: string;
  /** Rejects with a Node error carrying `code` (e.g. `ENOENT`) when the file cannot be read. */
  readonly readFile: (path: string) => Promise<string>;
}

/** A reason the connection could not be found, worded for the person reading the tool result. */
export class ConnectionError extends Error {
  override readonly name = 'ConnectionError';
}

/** Where Tauri's `appDataDir` puts the connection file on each platform. */
export function defaultConnectionFile(source: Omit<ConnectionSource, 'readFile'>): string {
  const { env, platform, homeDir } = source;
  if (platform === 'darwin') {
    return join(homeDir, 'Library', 'Application Support', BUNDLE_IDENTIFIER, 'api.json');
  }
  if (platform === 'win32') {
    return join(
      env['APPDATA'] ?? join(homeDir, 'AppData', 'Roaming'),
      BUNDLE_IDENTIFIER,
      'api.json',
    );
  }
  return join(
    env['XDG_DATA_HOME'] ?? join(homeDir, '.local', 'share'),
    BUNDLE_IDENTIFIER,
    'api.json',
  );
}

/** Resolves the URL and token, or throws a `ConnectionError` that says how to fix it. */
export async function resolveConnection(source: ConnectionSource): Promise<Connection> {
  const fromEnv = connectionFromEnv(source.env);
  if (fromEnv) return fromEnv;
  const file = source.env['ATLAS_CONNECTION_FILE'] || defaultConnectionFile(source);
  return parseConnectionFile(await readConnectionFile(source, file), file);
}

function connectionFromEnv(env: ConnectionSource['env']): Connection | null {
  const url = env['ATLAS_API_URL'];
  const token = env['ATLAS_API_TOKEN'];
  if (!url && !token) return null;
  if (!url || !token) {
    throw new ConnectionError(
      'ATLAS_API_URL and ATLAS_API_TOKEN must be set together; only one of them is set.',
    );
  }
  return { baseUrl: url.replace(/\/+$/, ''), token };
}

async function readConnectionFile(source: ConnectionSource, file: string): Promise<string> {
  try {
    return await source.readFile(file);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new ConnectionError(`Atlas's API has not been turned on yet (no ${file}). ${TURN_ON}`);
    }
    throw new ConnectionError(`Could not read ${file} (${errorCode(error) ?? 'unknown error'}).`);
  }
}

/** Validates the file's shape. Its token never appears in a message. */
export function parseConnectionFile(text: string, file: string): Connection {
  const malformed = (why: string) =>
    new ConnectionError(`${file} is not a valid Atlas connection file: ${why}. ${TURN_ON}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw malformed('it is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) throw malformed('it is not an object');
  const { port, token, version, enabled } = parsed as Record<string, unknown>;
  if (version !== 1) throw malformed(`version ${String(version)} is not one this server speaks`);
  if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) {
    throw malformed('port is missing or not a port number');
  }
  if (typeof token !== 'string' || token === '') throw malformed('token is missing');
  // Written as false when the API is switched off; absent in files that predate the switch.
  if (enabled === false) throw new ConnectionError(`Atlas's API is turned off. ${TURN_ON}`);
  return { baseUrl: `http://127.0.0.1:${port as number}`, token };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}
