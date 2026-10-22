/**
 * Finding the running app: its base URL and bearer token.
 *
 * DFAI writes both to a connection file in its data directory when the API is
 * turned on (ADR-0016). Environment variables override the file, for scripts
 * and tests. Nothing here is cached: every call resolves again, so a rotated
 * token or a new port is picked up without restarting the MCP server.
 */

import { join } from 'node:path';

/** Tauri's bundle identifier, from `apps/desktop/src-tauri/tauri.conf.json`. */
export const BUNDLE_IDENTIFIER = 'com.dailyflowai.dfai';

/**
 * The identifier the app had as Atlas (#482, ADR-0042). DFAI copies Atlas's
 * folder on its first launch, but an Atlas still running, or a DFAI not yet
 * opened, has written only this one. Read for one release, then dropped.
 */
export const LEGACY_BUNDLE_IDENTIFIER = 'dev.jhoffman.atlas';

const TURN_ON = 'Open DFAI and turn on the API in Settings → Connections.';

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
  override readonly name: string = 'ConnectionError';
}

/** There is no connection file where one was looked for. */
class MissingFileError extends ConnectionError {}

/** Where Tauri's `appDataDir` puts the connection file on each platform. */
export function defaultConnectionFile(source: Omit<ConnectionSource, 'readFile'>): string {
  return connectionFileOf(BUNDLE_IDENTIFIER, source);
}

function connectionFileOf(
  identifier: string,
  { env, platform, homeDir }: Omit<ConnectionSource, 'readFile'>,
): string {
  if (platform === 'darwin') {
    return join(homeDir, 'Library', 'Application Support', identifier, 'api.json');
  }
  if (platform === 'win32') {
    return join(env['APPDATA'] ?? join(homeDir, 'AppData', 'Roaming'), identifier, 'api.json');
  }
  return join(env['XDG_DATA_HOME'] ?? join(homeDir, '.local', 'share'), identifier, 'api.json');
}

/** Resolves the URL and token, or throws a `ConnectionError` that says how to fix it. */
export async function resolveConnection(source: ConnectionSource): Promise<Connection> {
  const fromEnv = connectionFromEnv(source.env);
  if (fromEnv) return fromEnv;
  const named = source.env['ATLAS_CONNECTION_FILE'];
  if (named) return parseConnectionFile(await readConnectionFile(source, named), named);
  const { text, file } = await readDefaultConnectionFile(source);
  return parseConnectionFile(text, file);
}

/** DFAI's file, or Atlas's when DFAI has not written one. */
async function readDefaultConnectionFile(
  source: ConnectionSource,
): Promise<{ text: string; file: string }> {
  const file = defaultConnectionFile(source);
  try {
    return { text: await readConnectionFile(source, file), file };
  } catch (missing) {
    // Only a missing file falls back: any other failure is DFAI's file, and the one to fix.
    if (!(missing instanceof MissingFileError)) throw missing;
    const legacy = connectionFileOf(LEGACY_BUNDLE_IDENTIFIER, source);
    try {
      return { text: await readConnectionFile(source, legacy), file: legacy };
    } catch {
      // What to do is turn DFAI's API on, whatever stopped Atlas's old file being read.
      throw missing;
    }
  }
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
      throw new MissingFileError(`DFAI's API has not been turned on yet (no ${file}). ${TURN_ON}`);
    }
    throw new ConnectionError(`Could not read ${file} (${errorCode(error) ?? 'unknown error'}).`);
  }
}

/** Validates the file's shape. Its token never appears in a message. */
export function parseConnectionFile(text: string, file: string): Connection {
  const malformed = (why: string) =>
    new ConnectionError(`${file} is not a valid DFAI connection file: ${why}. ${TURN_ON}`);
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
  if (enabled === false) throw new ConnectionError(`DFAI's API is turned off. ${TURN_ON}`);
  return { baseUrl: `http://127.0.0.1:${port as number}`, token };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}
