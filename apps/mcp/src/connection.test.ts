import {
  ConnectionError,
  defaultConnectionFile,
  resolveConnection,
  type ConnectionSource,
} from './connection.ts';

const TOKEN = 'a'.repeat(64);
const MAC_FILE = '/Users/sam/Library/Application Support/dev.jhoffman.atlas/api.json';

function source(overrides: Partial<ConnectionSource> & { files?: Record<string, string> } = {}) {
  const { files = {}, ...rest } = overrides;
  const read: string[] = [];
  const src: ConnectionSource = {
    env: {},
    platform: 'darwin',
    homeDir: '/Users/sam',
    readFile: async (path) => {
      read.push(path);
      const text = files[path];
      if (text === undefined) throw Object.assign(new Error('nope'), { code: 'ENOENT' });
      return text;
    },
    ...rest,
  };
  return { src, read };
}

const file = (fields: Record<string, unknown>) => JSON.stringify(fields);

async function failure(src: ConnectionSource): Promise<string> {
  const error = await resolveConnection(src).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectionError);
  return (error as Error).message;
}

describe('resolveConnection', () => {
  it('reads port and token from the app data directory on macOS', async () => {
    const { src, read } = source({
      files: { [MAC_FILE]: file({ port: 27183, token: TOKEN, version: 1, enabled: true }) },
    });
    expect(await resolveConnection(src)).toEqual({
      baseUrl: 'http://127.0.0.1:27183',
      token: TOKEN,
    });
    expect(read).toEqual([MAC_FILE]);
  });

  it('accepts a file without "enabled", as the v1 doc writes it', async () => {
    const { src } = source({
      files: { [MAC_FILE]: file({ port: 1, token: TOKEN, version: 1 }) },
    });
    expect((await resolveConnection(src)).baseUrl).toBe('http://127.0.0.1:1');
  });

  it('reads the file named by ATLAS_CONNECTION_FILE instead', async () => {
    const { src, read } = source({
      env: { ATLAS_CONNECTION_FILE: '/tmp/api.json' },
      files: { '/tmp/api.json': file({ port: 5000, token: TOKEN, version: 1, enabled: true }) },
    });
    expect((await resolveConnection(src)).baseUrl).toBe('http://127.0.0.1:5000');
    expect(read).toEqual(['/tmp/api.json']);
  });

  it('prefers ATLAS_API_URL and ATLAS_API_TOKEN over any file, trimming a trailing slash', async () => {
    const { src, read } = source({
      env: { ATLAS_API_URL: 'http://localhost:9999/', ATLAS_API_TOKEN: 'env-token' },
    });
    expect(await resolveConnection(src)).toEqual({
      baseUrl: 'http://localhost:9999',
      token: 'env-token',
    });
    expect(read).toEqual([]);
  });

  it('refuses half an environment override rather than guessing the rest', async () => {
    const { src } = source({ env: { ATLAS_API_URL: 'http://localhost:9999' } });
    expect(await failure(src)).toMatch(/must be set together/);
  });

  it('says how to turn the API on when the file is missing', async () => {
    const { src } = source();
    const message = await failure(src);
    expect(message).toContain('has not been turned on');
    expect(message).toContain('Settings → Connections');
    expect(message).toContain(MAC_FILE);
  });

  it('says the API is off when the file says enabled: false, without leaking the token', async () => {
    const { src } = source({
      files: { [MAC_FILE]: file({ port: 27183, token: TOKEN, version: 1, enabled: false }) },
    });
    const message = await failure(src);
    expect(message).toMatch(/turned off.*Settings → Connections/);
    expect(message).not.toContain(TOKEN);
  });

  it('reports an unreadable file by its error code', async () => {
    const { src } = source({
      readFile: async () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      },
    });
    expect(await failure(src)).toMatch(/Could not read .*EACCES/);
  });

  it.each([
    ['not JSON', '{port', /not JSON/],
    ['not an object', '42', /not an object/],
    ['a newer version', file({ port: 1, token: TOKEN, version: 2 }), /version 2/],
    ['no port', file({ token: TOKEN, version: 1 }), /port/],
    ['a port out of range', file({ port: 70000, token: TOKEN, version: 1 }), /port/],
    ['a fractional port', file({ port: 1.5, token: TOKEN, version: 1 }), /port/],
    ['no token', file({ port: 1, version: 1 }), /token is missing/],
    ['an empty token', file({ port: 1, token: '', version: 1 }), /token is missing/],
  ])('rejects a malformed file: %s', async (_, text, expected) => {
    const { src } = source({ files: { [MAC_FILE]: text } });
    const message = await failure(src);
    expect(message).toMatch(expected);
    expect(message).not.toContain(TOKEN);
  });
});

describe('defaultConnectionFile', () => {
  it('follows Tauri appDataDir on Linux, honouring XDG_DATA_HOME', () => {
    expect(defaultConnectionFile({ env: {}, platform: 'linux', homeDir: '/home/sam' })).toBe(
      '/home/sam/.local/share/dev.jhoffman.atlas/api.json',
    );
    expect(
      defaultConnectionFile({ env: { XDG_DATA_HOME: '/data' }, platform: 'linux', homeDir: '/h' }),
    ).toBe('/data/dev.jhoffman.atlas/api.json');
  });

  it('uses APPDATA on Windows', () => {
    expect(
      defaultConnectionFile({ env: { APPDATA: '/roaming' }, platform: 'win32', homeDir: '/h' }),
    ).toMatch(/roaming.dev\.jhoffman\.atlas.api\.json$/);
  });
});
