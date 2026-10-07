/**
 * Adversarial edges of the read-only template routes (issue #16): which
 * template a name means, what reading one can reach, and whether what it
 * answers is what `POST /v1/notes { template }` would start a note with.
 */

import { describe, expect, it } from 'vitest';
import { apiFixture, bodyOf, codeOf, encoded } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';

const PERSON = jsonNote({ name: 'person', label: 'Person', properties: { role: 'text' } });

function vault(files: Record<string, string> = {}) {
  return apiFixture({
    markdown: jsonMarkdown(),
    files: {
      '.atlas/types/person.md': PERSON,
      '.atlas/templates/Meeting.md': '# Agenda\n',
      '.atlas/settings.md': '---\napiToken: secret\n---\n',
      ...files,
    },
  });
}

type Api = ReturnType<typeof vault>;

const readRaw = (api: Api, rawSegment: string) =>
  api.send({ method: 'GET', path: `/v1/templates/${rawSegment}` });
const read = (api: Api, name: string) => readRaw(api, encoded(name));
const templateOf = (response: Awaited<ReturnType<typeof read>>) =>
  bodyOf(response)['template'] as Record<string, unknown>;
const create = (api: Api, body: Record<string, unknown>) =>
  api.send({ method: 'POST', path: '/v1/notes', body });

describe('which template a name means', () => {
  it('of two names differing only in case, answers the one nearer the top of the folder', async () => {
    const api = vault({ '.atlas/templates/Old/meeting.md': '# Old agenda\n' });

    const response = await read(api, 'Meeting');

    expect(templateOf(response)).toMatchObject({
      path: '.atlas/templates/Meeting.md',
      body: '# Agenda\n',
    });
  });

  it('of two names differing only in case, POST /v1/notes starts from the one nearer the top', async () => {
    const api = vault({ '.atlas/templates/Old/meeting.md': '# Old agenda\n' });

    await create(api, { name: 'Standup', template: 'Meeting' });

    expect(api.files.get('Standup.md')?.text).toBe('# Agenda\n');
  });

  it('of two names differing only by a leading space, answers the one nearer the top', async () => {
    const api = vault({ '.atlas/templates/Old/ Meeting.md': '# Old agenda\n' });

    const response = await read(api, 'Meeting');

    expect(templateOf(response)).toMatchObject({
      path: '.atlas/templates/Meeting.md',
      body: '# Agenda\n',
    });
  });

  it('reads the same template POST /v1/notes uses, whatever the case of two duplicates', async () => {
    const api = vault({ '.atlas/templates/Old/meeting.md': '# Old agenda\n' });

    const response = await read(api, 'MEETING');
    await create(api, { name: 'Standup', template: 'MEETING' });

    expect(api.files.get('Standup.md')?.text).toBe(templateOf(response)['body']);
  });

  it('lists a template whose name differs only in case from another once each', async () => {
    const api = vault({ '.atlas/templates/Old/meeting.md': '# Old agenda\n' });

    const listed = bodyOf(await api.send({ method: 'GET', path: '/v1/templates' }));
    const paths = (listed['templates'] as { path: string }[]).map((row) => row.path);

    expect(paths.sort()).toEqual([
      '.atlas/templates/Meeting.md',
      '.atlas/templates/Old/meeting.md',
    ]);
  });
});

describe('what a read can reach', () => {
  it.each([
    ['a path-shaped name', 'Old/Meeting'],
    ['a dot', '.'],
    ['a parent', '..'],
    ['a climb out to settings', '../settings'],
    ['the type folder', '../types/person'],
    ['an extension', 'Meeting.md'],
    ['whitespace only', '   '],
    ['a very long name', 'M'.repeat(10_000)],
    ['a NUL', 'Meet\u0000ing'],
  ])('answers not_found for %s, never a file outside the templates', async (_label, name) => {
    const api = vault({ '.atlas/templates/Old/Meeting.md': '# Old\n' });
    const response = await read(api, name);
    expect(codeOf(response)).toBe('not_found');
  });

  it('answers not_found for an encoded slash climbing out of the folder', async () => {
    const response = await readRaw(vault(), '..%2Fsettings');
    expect(codeOf(response)).toBe('not_found');
  });

  it('does not offer a markdown file kept under .git or node_modules inside the templates', async () => {
    const api = vault({
      '.atlas/templates/.git/Leak.md': '# leak\n',
      '.atlas/templates/node_modules/Pkg.md': '# pkg\n',
    });

    expect(codeOf(await read(api, 'Leak'))).toBe('not_found');
    expect(codeOf(await read(api, 'Pkg'))).toBe('not_found');
  });

  it('does not offer a file that is not markdown', async () => {
    const api = vault({ '.atlas/templates/Notes.txt': 'plain\n' });
    expect(codeOf(await read(api, 'Notes'))).toBe('not_found');
  });

  it('writes nothing even when a read is not_found or invalid', async () => {
    const api = vault();
    await read(api, '..');
    await readRaw(api, '%E0%A4%A');
    expect(api.writes).toEqual([]);
  });
});

describe('a read answers what a note made from the template starts with', () => {
  async function readThenCreate(text: string) {
    const api = vault({ '.atlas/templates/Odd.md': text });
    const template = templateOf(await read(api, 'Odd'));
    await create(api, { name: 'Made', template: 'Odd' });
    const note = bodyOf(await api.send({ method: 'GET', path: `/v1/notes/${encoded('Made.md')}` }));
    return { template, note: note['note'] as Record<string, unknown> };
  }

  it.each([
    ['plain frontmatter', '---\ntype: person\nrole: x\n---\n\n## Met\n'],
    ['CRLF line endings', '---\r\ntype: person\r\n---\r\n\r\n## Met\r\n'],
    ['a byte-order mark', '﻿---\ntype: person\n---\n\n## Met\n'],
    ['an unclosed fence', '---\ntype: person\n\n## Met\n'],
    ['an empty file', ''],
  ])('with %s', async (_label, text) => {
    const { template, note } = await readThenCreate(text);
    expect({ properties: template['properties'], body: template['body'] }).toEqual({
      properties: note['properties'],
      body: note['body'],
    });
  });
});
