import { AtlasCallError, AtlasClient, NOT_RUNNING } from './client.ts';
import { ConnectionError, type Connection } from './connection.ts';
import { closedPort, errorBody, startFakeAtlas, type FakeAtlas } from './testing/fake-atlas.ts';

/** A timeout is no answer, not a refusal: the write may be on disk already. */
const MAY_HAVE_LANDED =
  'A write may already have landed: read the note before retrying, or it may be made twice.';

const TOKEN = 'secret-token-1';
const NOTE = {
  path: 'Tasks/Call Sam.md',
  title: 'Call Sam',
  type: 'task',
  modified: 1700,
  properties: {},
  body: '',
};

let atlas: FakeAtlas;

beforeEach(async () => {
  atlas = await startFakeAtlas(() => ({ status: 200, body: { note: NOTE } }));
});

afterEach(async () => {
  await atlas.close();
});

function clientFor(connect: () => Promise<Connection>, timeoutMs?: number) {
  return new AtlasClient({ connect, ...(timeoutMs !== undefined && { timeoutMs }) });
}

const fixed = () => clientFor(async () => ({ baseUrl: atlas.baseUrl, token: TOKEN }));

async function callError(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AtlasCallError);
  return (error as Error).message;
}

describe('a path segment that is only dots', () => {
  // `new URL` resolves `.` and `..` (and `%2E%2E`) segments, so one would ask
  // another route than the one named: each is refused before any request.
  const client = () => fixed();
  it.each([
    ['readNote', () => client().readNote('..')],
    ['backlinks', () => client().backlinks('.')],
    ['setProperties', () => client().setProperties('..', { set: {} })],
    ['append', () => client().append('..', { markdown: 'x' })],
    ['replaceBody', () => client().replaceBody('..', { markdown: 'x', ifModified: 1 })],
    ['runView', () => client().runView('..')],
    ['calendar', () => client().calendar('.', {})],
    ['refreshSource', () => client().refreshSource('..')],
    ['artifactThumbnail', () => client().artifactThumbnail('..')],
    ['writeArtifactFile path', () => client().writeArtifactFile('..', 'a.html', { text: '' })],
    ['writeArtifactFile name', () => client().writeArtifactFile('A.md', '..', { text: '' })],
    ['writeNoteImage path', () => client().writeNoteImage('.', 'a.png', { text: '' })],
    ['writeNoteImage name', () => client().writeNoteImage('A.md', '..', { text: '' })],
  ])('is refused by %s', async (_, call) => {
    expect(await callError(call())).toMatch(/\./);
    expect(atlas.requests).toEqual([]);
  });

  it('is sent for a tag with its optional #, so it stays on the tag route', async () => {
    await fixed().taggedNotes('..', {});
    await fixed().renameTag('.', { to: 'x', dryRun: true });
    expect(atlas.requests.map((request) => request.url)).toEqual([
      '/v1/tags/%23../notes',
      '/v1/tags/%23./rename',
    ]);
  });
});

describe('AtlasClient requests', () => {
  it('reads a note with the path encoded as one segment and the bearer token', async () => {
    const answer = await fixed().readNote('Tasks/Call Sam.md');
    expect(answer).toEqual({ note: NOTE });
    expect(atlas.requests).toEqual([
      {
        method: 'GET',
        url: '/v1/notes/Tasks%2FCall%20Sam.md',
        authorization: `Bearer ${TOKEN}`,
        contentType: undefined,
        body: null,
      },
    ]);
  });

  it('sends a JSON body for writes', async () => {
    await fixed().replaceBody('A/B.md', { markdown: '# Hi', ifModified: 5 });
    expect(atlas.requests[0]).toMatchObject({
      method: 'PUT',
      url: '/v1/notes/A%2FB.md/body',
      contentType: 'application/json',
      body: { markdown: '# Hi', ifModified: 5 },
    });
  });

  it('puts defined query parameters in the query string and leaves the rest out', async () => {
    atlas.respondWith(() => ({ status: 200, body: { notes: [], next: null } }));
    await fixed().listNotes({ folder: 'Projects/Active', limit: 10 });
    expect(atlas.requests[0]?.url).toBe('/v1/notes?folder=Projects%2FActive&limit=10');
  });

  it('reports whether the daily note was created from the status', async () => {
    atlas.respondWith(() => ({ status: 201, body: { note: NOTE } }));
    expect(await fixed().daily()).toEqual({ note: NOTE, created: true });
    atlas.respondWith(() => ({ status: 200, body: { note: NOTE } }));
    expect(await fixed().daily()).toEqual({ note: NOTE, created: false });
  });
});

describe('AtlasClient errors', () => {
  it.each([
    ['invalid', 400],
    ['not_found', 404],
    ['conflict', 409],
    ['unsaved_in_app', 409],
    ['exists', 409],
    ['query_failed', 422],
    ['internal', 500],
    ['no_vault', 503],
  ])('turns a %s error body into "code: message"', async (code, status) => {
    atlas.respondWith(() => ({ status, body: errorBody(code, 'what went wrong') }));
    expect(await callError(fixed().readNote('x.md'))).toBe(`${code}: what went wrong`);
  });

  it('warns, on a timeout answer, that a write may have landed and to read before retrying', async () => {
    atlas.respondWith(() => ({ status: 504, body: errorBody('timeout', 'no answer in 30 s') }));
    expect(await callError(fixed().readNote('x.md'))).toBe(
      `timeout: no answer in 30 s. ${MAY_HAVE_LANDED}`,
    );
  });

  it('reports a body it cannot read by status, not by parse error', async () => {
    atlas.respondWith(() => ({ status: 502, body: '<html>bad gateway</html>' }));
    expect(await callError(fixed().status())).toBe(
      'Atlas answered 502 with a body this server cannot read.',
    );
  });

  it('says Atlas is not running when the connection is refused', async () => {
    const port = await closedPort();
    const client = clientFor(async () => ({ baseUrl: `http://127.0.0.1:${port}`, token: TOKEN }));
    expect(await callError(client.status())).toBe(NOT_RUNNING);
  });

  it('gives up after its timeout when Atlas never answers', async () => {
    atlas.respondWith(() => ({ status: 200 })); // no body: the fake never answers
    const client = clientFor(async () => ({ baseUrl: atlas.baseUrl, token: TOKEN }), 50);
    expect(await callError(client.status())).toBe(
      `Atlas did not answer within 0.05 s. ${MAY_HAVE_LANDED}`,
    );
  });

  it.each([
    [
      'a socket error by its code',
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }),
      'ECONNRESET',
    ],
    ['anything else as a network error', new TypeError('fetch failed'), 'network error'],
  ])('reports %s', async (_, thrown, expected) => {
    const client = new AtlasClient({
      connect: async () => ({ baseUrl: 'http://127.0.0.1:1', token: TOKEN }),
      fetch: async () => {
        throw thrown;
      },
    });
    expect(await callError(client.status())).toBe(
      `Could not reach Atlas at http://127.0.0.1:1 (${expected}).`,
    );
  });

  it('passes a connection problem through as a tool-readable error', async () => {
    const client = clientFor(async () => {
      throw new ConnectionError('turn it on');
    });
    expect(await callError(client.status())).toBe('turn it on');
    expect(atlas.requests).toEqual([]);
  });

  it('lets an unexpected failure to connect propagate as it is', async () => {
    const client = clientFor(async () => {
      throw new RangeError('bug');
    });
    await expect(client.status()).rejects.toThrow(RangeError);
  });
});

describe('AtlasClient on 401', () => {
  const unauthorizedUnless = (token: string) =>
    atlas.respondWith((request) =>
      request.authorization === `Bearer ${token}`
        ? { status: 200, body: { note: NOTE } }
        : { status: 401, body: errorBody('unauthorized', 'Wrong token.') },
    );

  it('re-reads the connection and retries once with a rotated token', async () => {
    unauthorizedUnless('rotated');
    const tokens = ['stale', 'rotated'];
    const client = clientFor(async () => ({
      baseUrl: atlas.baseUrl,
      token: tokens.shift() ?? 'x',
    }));
    expect(await client.readNote('a.md')).toEqual({ note: NOTE });
    expect(atlas.requests.map((r) => r.authorization)).toEqual(['Bearer stale', 'Bearer rotated']);
  });

  it('does not retry when the token has not changed, and never echoes it', async () => {
    unauthorizedUnless('right');
    const client = clientFor(async () => ({ baseUrl: atlas.baseUrl, token: 'wrong-token' }));
    const message = await callError(client.readNote('a.md'));
    expect(message).toMatch(/^unauthorized: Wrong token\. The token .* was refused/);
    expect(message).not.toContain('wrong-token');
    expect(atlas.requests).toHaveLength(1);
  });
});
