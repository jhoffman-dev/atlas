/**
 * Which paths a request may name. This is the line between the API and the
 * rest of the disk, and between the API and Atlas's own configuration, so
 * every way of stepping over it is tried — and none may reach the filesystem.
 */

import { describe, expect, it } from 'vitest';
import { apiFixture, codeOf, encoded } from '../testing/api-fixture.ts';

const REFUSED: readonly [string, string][] = [
  ['climbs out of the vault', encoded('../secrets.md')],
  ['climbs out through a folder', encoded('Notes/../../secrets.md')],
  ['climbs out, encoded as dots', '%2e%2e%2Fsecrets.md'],
  ['climbs out, dots encoded in capitals', '%2E%2E%2fsecrets.md'],
  ['is absolute', encoded('/etc/passwd.md')],
  ['is a Windows drive path', encoded('C:/Users/secrets.md')],
  ['uses backslashes to climb', encoded('..\\secrets.md')],
  ['holds a null byte', encoded('Note\0.md')],
  ['is a "." segment', encoded('./Note.md')],
  ['points into .atlas', encoded('.atlas/types/task.md')],
  ['points into .atlas templates', encoded('.atlas/templates/Task.md')],
  ['points into a hidden folder', encoded('.obsidian/workspace.md')],
  ['points into git', encoded('.git/config.md')],
  ['points into node_modules', encoded('node_modules/x/README.md')],
  ['names a hidden note', encoded('.secret.md')],
  ['is not a note', encoded('Notes/picture.png')],
  ['has no extension', encoded('Notes/Call')],
  ['is badly percent-encoded', '%E0%A4%A.md'],
  ['is only a slash', '%2F'],
];

describe('a note path', () => {
  it.each(REFUSED)('is invalid when it %s', async (_, segment) => {
    const api = apiFixture();
    let touched = false;
    const reading = api.deps.fs.readTextFile;
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        readTextFile: async (path) => {
          touched = true;
          return reading(path);
        },
      },
    };

    const response = await api.send({ method: 'GET', path: `/v1/notes/${segment}` });

    expect(codeOf(response)).toBe('invalid');
    expect(response.status).toBe(400);
    expect(touched).toBe(false);
  });

  it.each(REFUSED)('refuses a write too when it %s', async (_, segment) => {
    const api = apiFixture();
    const response = await api.send({
      method: 'PUT',
      path: `/v1/notes/${segment}/body`,
      body: { markdown: 'x', ifModified: 1 },
    });

    expect(codeOf(response)).toBe('invalid');
    expect(api.writes).toEqual([]);
  });

  it('is decoded exactly once, so a doubly encoded ".." is only a strange name', async () => {
    const api = apiFixture({ files: { '%2e%2e/x.md': 'odd but inside' } });

    const response = await api.send({ method: 'GET', path: `/v1/notes/${encoded('%2e%2e/x.md')}` });

    expect(response.status).toBe(200);
  });

  it('reads a note in a folder, with spaces and accents in its name', async () => {
    const api = apiFixture({ files: { 'Tâches/Call Sam.md': '# Call\n' } });

    const response = await api.send({
      method: 'GET',
      path: `/v1/notes/${encoded('Tâches/Call Sam.md')}`,
    });

    expect(response.status).toBe(200);
  });

  it('accepts the extension in any case', async () => {
    const api = apiFixture({ files: { 'Old.MD': '# Old\n' } });
    const response = await api.send({ method: 'GET', path: '/v1/notes/Old.MD' });
    expect(response.status).toBe(200);
  });
});

describe('a view path', () => {
  it('may be in .atlas, where views live, for running', async () => {
    const api = apiFixture({ files: { '.atlas/views/Board.md': 'no frontmatter\n' } });

    const response = await api.send({
      method: 'POST',
      path: `/v1/views/${encoded('.atlas/views/Board.md')}/run`,
    });

    // Reached and read — it is simply not a view.
    expect(codeOf(response)).toBe('not_found');
  });

  it.each([
    ['climbs out of the vault', encoded('../x.md')],
    ['points into a hidden folder inside .atlas', encoded('.atlas/.git/x.md')],
    ['points into another hidden folder', encoded('.obsidian/x.md')],
    ['is not a note', encoded('.atlas/views/Board')],
  ])('is invalid when it %s', async (_, segment) => {
    const response = await apiFixture().send({ method: 'POST', path: `/v1/views/${segment}/run` });
    expect(codeOf(response)).toBe('invalid');
  });
});
