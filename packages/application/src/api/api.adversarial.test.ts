/**
 * Adversarial pass on the API router (A15-02). Each `describe` names the
 * invariant it attacks. Tests in the "FAILING" blocks prove a bug and are left
 * red on purpose until it is fixed; the rest pin guards that held.
 */

import { describe, expect, it } from 'vitest';
import { VaultAccessError } from '../vault/ports.ts';
import { apiFixture, bodyOf, codeOf, encoded, TODAY } from '../testing/api-fixture.ts';

/** Frontmatter that closes on the last byte of the file, with no newline after `---`. */
const CLOSED_AT_EOF = '---\nstatus: todo\n---';

type Fixture = ReturnType<typeof apiFixture>;

/** Another writer creates `path` straight after the router lists the vault. */
function createdRightAfterListing(api: Fixture, path: string): void {
  const listing = api.deps.fs.listNotes;
  api.deps = {
    ...api.deps,
    fs: {
      ...api.deps.fs,
      listNotes: async (options) => {
        const notes = await listing(options);
        api.files.set(path, { text: '# made elsewhere\n', modified: 5000 });
        return notes;
      },
    },
  };
}

/** As APFS and NTFS do by default: a create refuses a name differing only in case. */
function caseInsensitiveHost(api: Fixture): void {
  const creating = api.deps.fs.createNote;
  api.deps = {
    ...api.deps,
    fs: {
      ...api.deps.fs,
      createNote: async (args) => {
        const lower = args.path.toLowerCase();
        if ([...api.files.keys()].some((path) => path.toLowerCase() === lower)) {
          throw new VaultAccessError('a note with that name already exists');
        }
        return creating(args);
      },
    },
  };
}

describe('FAILING: a body write never changes the note’s properties', () => {
  it('append keeps frontmatter that closes at end of file without a newline', async () => {
    const api = apiFixture({ files: { 'Call.md': CLOSED_AT_EOF } });

    const response = await api.send({
      method: 'POST',
      path: '/v1/notes/Call.md/append',
      body: { markdown: 'Rang, no answer.' },
    });

    expect(response.status).toBe(200);
    expect(bodyOf(response)['note']).toMatchObject({ properties: { status: 'todo' } });
  });

  it('body replace keeps frontmatter that closes at end of file without a newline', async () => {
    const api = apiFixture({ files: { 'Call.md': CLOSED_AT_EOF } });
    const modified = api.files.get('Call.md')?.modified;

    const response = await api.send({
      method: 'PUT',
      path: '/v1/notes/Call.md/body',
      body: { markdown: 'New body.\n', ifModified: modified },
    });

    expect(response.status).toBe(200);
    expect(bodyOf(response)['note']).toMatchObject({ properties: { status: 'todo' } });
  });

  it('create from a template whose frontmatter closes at end of file keeps its properties', async () => {
    const api = apiFixture({ files: { '.atlas/templates/Task.md': CLOSED_AT_EOF } });

    const response = await api.send({
      method: 'POST',
      path: '/v1/notes',
      body: { name: 'Call Sam', template: 'Task', body: 'About the lease.\n' },
    });

    expect(response.status).toBe(201);
    expect(bodyOf(response)['note']).toMatchObject({ properties: { status: 'todo' } });
  });

  it('append to an empty note cannot turn the appended text into frontmatter', async () => {
    const api = apiFixture({ files: { 'Empty.md': '' } });

    const response = await api.send({
      method: 'POST',
      path: '/v1/notes/Empty.md/append',
      body: { markdown: '---\ntype: Invoice\n---\n' },
    });

    expect(response.status).toBe(200);
    expect(bodyOf(response)['note']).toMatchObject({ type: null, properties: {} });
  });
});

describe('FAILING: daily and capture answer, never fault, when the name is taken meanwhile', () => {
  it('daily answers with today’s note when it appears between listing and creating', async () => {
    const api = apiFixture();
    createdRightAfterListing(api, `${TODAY}.md`);

    const response = await api.send({ method: 'POST', path: '/v1/daily' });

    expect(response.status).toBe(200);
    expect(bodyOf(response)['note']).toMatchObject({ path: `${TODAY}.md` });
  });

  it('capture numbers the task when its name appears between listing and creating', async () => {
    const api = apiFixture();
    createdRightAfterListing(api, 'Call Sam.md');

    const response = await api.send({
      method: 'POST',
      path: '/v1/capture',
      body: { text: 'Call Sam' },
    });

    expect(response.status).toBe(201);
    expect(bodyOf(response)['note']).toMatchObject({ path: 'Call Sam 2.md' });
  });

  it('capture numbers a task whose name differs only in case on a case-insensitive disk', async () => {
    const api = apiFixture({ files: { 'Call Sam.md': '# Call Sam\n' } });
    caseInsensitiveHost(api);

    const response = await api.send({
      method: 'POST',
      path: '/v1/capture',
      body: { text: 'call sam' },
    });

    expect(response.status).toBe(201);
    expect(codeOf(response)).toBeNull();
  });
});

describe('FAILING: capture never makes a note the vault hides', () => {
  // noteFileName strips leading dots, then trims, which can expose a new one.
  it.each([['. .env'], ['. .atlas'], ['  . .hidden']])(
    'capture of %j lands in user space',
    async (text) => {
      const api = apiFixture();

      const response = await api.send({ method: 'POST', path: '/v1/capture', body: { text } });

      expect(response.status).toBe(201);
      expect(api.writes.map((write) => write.path.startsWith('.'))).toEqual([false]);
    },
  );
});

describe('FAILING: /v1/sql only ever reads the index', () => {
  // A read-only SQLite connection still runs these: ATTACH opens any database
  // file the app can read, and VACUUM INTO writes a new file anywhere
  // (checked against sqlite 3.51 with `sqlite3 -readonly`).
  it.each([
    ["ATTACH DATABASE '/Users/j/Other/.atlas-cache/index.db' AS other"],
    ["VACUUM INTO '/Users/j/Library/LaunchAgents/x.plist'"],
    ['DETACH DATABASE other'],
  ])('refuses %s without handing it to the index', async (sql) => {
    const ran: string[] = [];
    const api = apiFixture({
      index: {
        query: async (text) => {
          ran.push(text);
          return { columns: [], rows: [], truncated: false };
        },
      },
    });

    const response = await api.send({ method: 'POST', path: '/v1/sql', body: { sql } });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(ran).toEqual([]);
  });
});

describe('a request path can only name a note in user space', () => {
  it.each([
    ['..%2Fx.md'],
    ['%2e%2e%2Fx.md'],
    ['a%2F..%2F..%2Fx.md'],
    ['..%5Cx.md'],
    ['a%5C..%5Cx.md'],
    ['%2Fetc%2Fx.md'],
    ['C%3A%5Cx.md'],
    ['C%3Ax.md'],
    ['x%00.md'],
    ['.%2Fx.md'],
    ['.atlas%2Ftypes%2FTask.md'],
    ['.ATLAS%2Ftypes%2FTask.md'],
    ['.git%2Fx.md'],
    ['a%2F.obsidian%2Fx.md'],
    ['..%20%2Fx.md'],
    ['...%2Fx.md'],
    ['x.md.'],
    ['%E0%A4%A.md'],
  ])('refuses %s on every write route and writes nothing', async (segment) => {
    const api = apiFixture({ files: { 'x.md': '# x\n' } });
    const routes = [
      { method: 'PATCH', path: `/v1/notes/${segment}/properties`, body: { set: { a: 1 } } },
      { method: 'POST', path: `/v1/notes/${segment}/append`, body: { markdown: 'x' } },
      { method: 'PUT', path: `/v1/notes/${segment}/body`, body: { markdown: 'x', ifModified: 1 } },
    ] as const;

    for (const route of routes) {
      const response = await api.send(route);
      expect(codeOf(response), `${route.method} ${route.path}`).toBe('invalid');
    }
    expect(api.writes).toEqual([]);
  });

  it('decodes once, so a double-encoded climb is a literal (absent) name, not a climb', async () => {
    const api = apiFixture({ files: { 'x.md': '# x\n' } });

    const response = await api.send({ method: 'GET', path: `/v1/notes/${encoded('%2e%2e/x.md')}` });

    expect(codeOf(response)).toBe('not_found');
  });

  it.each([['../x'], ['.atlas'], ['.ATLAS/types'], ['a/.git'], ['/abs'], ['a\\b']])(
    'refuses create in folder %s',
    async (folder) => {
      const api = apiFixture();
      const response = await api.send({ method: 'POST', path: '/v1/notes', body: { folder } });
      expect(codeOf(response)).toBe('invalid');
      expect(api.writes).toEqual([]);
    },
  );

  it.each([['../../x'], ['a/b'], ['.hidden'], ['..'], ['x\n---\ntype: y'], ['C:\\x']])(
    'keeps a created note named %j at the top of its folder, in user space, or refuses it',
    async (name) => {
      const api = apiFixture();
      const response = await api.send({ method: 'POST', path: '/v1/notes', body: { name } });
      expect([201, 400]).toContain(response.status);
      for (const written of api.writes) {
        expect(written.path).not.toContain('/');
        expect(written.path.startsWith('.')).toBe(false);
      }
    },
  );

  it('cannot use a template name to read outside the templates folder', async () => {
    const api = apiFixture({ files: { 'Secret.md': 'secret\n' } });
    const response = await api.send({
      method: 'POST',
      path: '/v1/notes',
      body: { template: '../../Secret' },
    });
    expect(codeOf(response)).toBe('not_found');
    expect(api.writes).toEqual([]);
  });

  it('runs a view only from .atlas views or user space, never from a hidden folder', async () => {
    const api = apiFixture({ files: { '.atlas/.git/v.md': '---\nview: table\n---\n' } });
    const response = await api.send({
      method: 'POST',
      path: `/v1/views/${encoded('.atlas/.git/v.md')}/run`,
    });
    expect(codeOf(response)).toBe('invalid');
  });

  it('a forged cursor pointing into .atlas is refused, never paged from (A20-04)', async () => {
    const api = apiFixture({ files: { '.atlas/types/Task.md': 'x', 'z.md': 'z' } });
    const cursor = btoa('.atlas');
    const response = await api.send({ method: 'GET', path: '/v1/notes', query: { cursor } });
    expect(codeOf(response)).toBe('invalid');
    expect(bodyOf(response)['notes']).toBeUndefined();
  });
});

describe('the router always answers, and says nothing about the machine it runs on', () => {
  it('answers internal when the host throws a non-Error carrying the vault root', async () => {
    const api = apiFixture();
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        readTextFile: () => Promise.reject('/Users/j/Vault/secret: EACCES'),
      },
    };

    const response = await api.send({ method: 'GET', path: '/v1/notes/a.md' });

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('/Users/j');
  });

  it.each([[null], [[]], ['str'], [42], [true]])('refuses a %j body as invalid', async (body) => {
    const api = apiFixture({ files: { 'a.md': 'a' } });
    const response = await api.send({ method: 'POST', path: '/v1/notes/a.md/append', body });
    expect(codeOf(response)).toBe('invalid');
  });

  it.each([['1.5'], [-1], [1.5], ['nope'], [Number.MAX_SAFE_INTEGER + 2]])(
    'refuses ifModified %j as invalid',
    async (ifModified) => {
      const api = apiFixture({ files: { 'a.md': 'a' } });
      const response = await api.send({
        method: 'POST',
        path: '/v1/notes/a.md/append',
        body: { markdown: 'x', ifModified },
      });
      expect(codeOf(response)).toBe('invalid');
      expect(api.writes).toEqual([]);
    },
  );

  it.each([['0'], ['-1'], ['1e9'], ['501'], ['1.0'], [' 5']])(
    'refuses list limit %j as invalid',
    async (limit) => {
      const response = await apiFixture().send({
        method: 'GET',
        path: '/v1/notes',
        query: { limit },
      });
      expect(codeOf(response)).toBe('invalid');
    },
  );

  it('an append with no ifModified is refused, not lost, when the note moved meanwhile', async () => {
    const api = apiFixture({ files: { 'a.md': 'a\n' } });
    const reading = api.deps.fs.readTextFile;
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        readTextFile: async (path) => {
          const read = await reading(path);
          api.files.set('a.md', { text: 'a\nedited\n', modified: 4242 });
          return read;
        },
      },
    };

    const response = await api.send({
      method: 'POST',
      path: '/v1/notes/a.md/append',
      body: { markdown: 'b' },
    });

    expect(codeOf(response)).toBe('conflict');
    expect(api.files.get('a.md')?.text).toBe('a\nedited\n');
  });
});
