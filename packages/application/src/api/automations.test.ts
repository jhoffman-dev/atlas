/**
 * Automations through the API (P25), read-only: the rules and their state as
 * the Automations page lists them, a rule's log, and a dry run that writes
 * nothing. Running, undoing and editing stay in the app (ADR-0016).
 */

import { describe, expect, it } from 'vitest';
import { newLogText, VAULT_WALK_DEPTH, type LogEntry } from '@atlas/domain';
import { apiFixture, bodyOf, codeOf, encoded, OTHER_VAULT, VAULT } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';

const rule = (fields: Record<string, unknown>) =>
  jsonNote({ atlas: 'automation', enabled: true, ...fields });

const TIDY = rule({
  id: 'tidy',
  name: 'Tidy done tasks',
  when: 'daily at 03:00',
  which: 'FROM task WHERE status = done',
  do: 'archive',
});
const FINISH = rule({
  id: 'finish',
  name: 'Finish doing',
  when: 'manually',
  which: 'FROM task WHERE status = doing',
  do: 'set',
  set: { status: 'done' },
});

const RAN: LogEntry = {
  kind: 'run',
  at: '2026-09-21T03:00:04',
  trigger: 'schedule',
  done: [{ kind: 'archived', from: 'tasks/Old.md' as never, to: 'Archive/tasks/Old.md' as never }],
  left: [{ path: '.atlas/x.md' as never, reason: 'Atlas keeps its own files as they are.' }],
  capped: false,
};
const FAILED: LogEntry = {
  kind: 'failed',
  at: '2026-09-22T03:00:01',
  trigger: 'schedule',
  problem: 'No type called tsk.',
};

const FILES: Record<string, string> = {
  '.atlas/types/task.md': jsonNote({
    name: 'task',
    label: 'Task',
    properties: { status: { kind: 'select', options: ['todo', 'doing', 'done'] } },
  }),
  '.atlas/automations/Tidy done tasks.md': TIDY,
  '.atlas/automations/Finish doing.md': FINISH,
  '.atlas/automations/log/tidy.md': newLogText('Tidy done tasks', [RAN, FAILED]),
  '.atlas/automations/Broken.md': rule({ name: 'Broken', which: 'FROM task', do: 'archive' }),
  'tasks/A.md': jsonNote({ type: 'task', status: 'doing' }),
  'tasks/B.md': jsonNote({ type: 'task', status: 'done' }),
  'tasks/C.md': jsonNote({ type: 'task', status: 'done' }),
};

/** A note as deep as the walk reaches: the Archive's folder would put it past, so it is passed over. */
const DEEP = (name: string) => `${'d/'.repeat(VAULT_WALK_DEPTH)}${name}.md`;

type Api = ReturnType<typeof apiFixture>;

function vault(files: Record<string, string> = FILES): Api {
  const markdown = jsonMarkdown();
  return apiFixture({ files, markdown, index: { query: atlasQueryIndex({ files, markdown }) } });
}

const list = (api: Api) => api.send({ method: 'GET', path: '/v1/automations' });
const logOf = (api: Api, id: string, query: Record<string, string> = {}) =>
  api.send({ method: 'GET', path: `/v1/automations/${encoded(id)}/log`, query });
const dryRun = (api: Api, id: string) =>
  api.send({ method: 'POST', path: `/v1/automations/${encoded(id)}/dry-run` });

describe('GET /v1/automations', () => {
  it('lists each rule as its file says it, with its last and next run, sorted by name', async () => {
    const response = await list(vault());

    expect(response.status).toBe(200);
    const { automations } = bodyOf(response) as { automations: Record<string, unknown>[] };
    expect(automations.map((automation) => automation['name'])).toEqual([
      'Finish doing',
      'Tidy done tasks',
    ]);
    expect(automations[1]).toEqual({
      id: 'tidy',
      name: 'Tidy done tasks',
      path: '.atlas/automations/Tidy done tasks.md',
      enabled: true,
      when: 'daily at 03:00',
      which: 'FROM task WHERE status = done',
      olderThanDays: null,
      do: 'archive',
      set: null,
      schedule: 'Every day at 03:00',
      action: 'Archive',
      lastRun: {
        at: '2026-09-22T03:00:01',
        kind: 'failed',
        trigger: 'schedule',
        summary: 'No type called tsk.',
      },
      // Counted from its last scheduled run, as the app's clock counts it.
      nextRun: '2026-09-23T03:00:00',
      paused: null,
    });
    expect(automations[0]).toMatchObject({
      id: 'finish',
      do: 'set',
      set: { status: 'done' },
      action: 'Set status to done',
      lastRun: null,
      nextRun: null,
    });
  });

  it('lists a rule its file cannot be read as broken, with why, and never as a rule', async () => {
    const { broken } = bodyOf(await list(vault())) as { broken: unknown[] };

    expect(broken).toEqual([
      {
        path: '.atlas/automations/Broken.md',
        name: 'Broken',
        problem:
          'Say when it runs: daily at 03:00, every 6 hours, on app open, manually, ' +
          'or when a note appears, like a meeting is created or changed.',
      },
    ]);
  });

  it("says why the app's clock has paused a rule, and gives it no next run until run by hand", async () => {
    const api = vault();
    api.automations.set(VAULT.absolutePath, {
      watchingSince: '2026-09-22T08:00:00',
      pauses: new Map([
        ['tidy', { reason: 'Paused: its log could not be written.', retryAt: null }],
      ]),
    });

    const { automations } = bodyOf(await list(api)) as { automations: Record<string, unknown>[] };

    expect(automations[1]).toMatchObject({
      paused: 'Paused: its log could not be written.',
      nextRun: null,
    });
  });

  it("says why a rule is paused without this machine's paths", async () => {
    const api = vault();
    const reason =
      'Paused: Its log could not be written (Permission denied: /Users/j/Vault/.atlas/automations/log/tidy.md). Run it by hand to try again.';
    api.automations.set(VAULT.absolutePath, {
      watchingSince: '2026-09-22T08:00:00',
      pauses: new Map([['tidy', { reason, retryAt: null }]]),
    });

    const { automations } = bodyOf(await list(api)) as { automations: Record<string, unknown>[] };

    expect(automations[1]?.['paused']).toBe(
      'Paused: Its log could not be written (Permission denied: <path>). Run it by hand to try again.',
    );
  });

  it('counts a never-run rule from when the app began watching the vault', async () => {
    const files = {
      ...FILES,
      '.atlas/automations/Hourly.md': rule({
        id: 'hourly',
        name: 'Hourly',
        when: 'every 6 hours',
        which: 'FROM task',
        do: 'archive',
      }),
    };
    const api = vault(files);
    const hourly = async () =>
      ((bodyOf(await list(api)) as { automations: Record<string, unknown>[] }).automations.find(
        (automation) => automation['id'] === 'hourly',
      ) ?? {})['nextRun'];

    // Not watched yet: counted from now, 09:00.
    expect(await hourly()).toBe('2026-09-22T15:00:00');
    api.automations.set(VAULT.absolutePath, {
      watchingSince: '2026-09-22T05:00:00',
      pauses: new Map(),
    });
    expect(await hourly()).toBe('2026-09-22T11:00:00');
    // Another vault's runner is not this vault's.
    api.automations.clear();
    api.automations.set(OTHER_VAULT.absolutePath, {
      watchingSince: '2026-09-22T05:00:00',
      pauses: new Map(),
    });
    expect(await hourly()).toBe('2026-09-22T15:00:00');
  });

  it('answers an empty list for a vault with no automations', async () => {
    const response = await list(vault({ 'tasks/A.md': jsonNote({ type: 'task' }) }));

    expect(bodyOf(response)).toEqual({ automations: [], broken: [] });
  });

  it('refuses with no_vault when the vault is switched while it reads', async () => {
    const api = vault();
    const readNotes = api.deps.fs.readNotes;
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        readNotes: async (paths) => {
          api.open = OTHER_VAULT;
          return readNotes(paths);
        },
      },
    };

    expect(codeOf(await list(api))).toBe('no_vault');
  });
});

describe('GET /v1/automations/{id}/log', () => {
  it("answers the rule's log newest first, each entry in full", async () => {
    const response = await logOf(vault(), 'tidy');

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toEqual({
      automation: { id: 'tidy', name: 'Tidy done tasks' },
      entries: [
        {
          kind: 'failed',
          at: '2026-09-22T03:00:01',
          heading: 'Ran on schedule, and could not',
          summary: 'No type called tsk.',
          trigger: 'schedule',
          problem: 'No type called tsk.',
          done: [],
          left: [],
        },
        {
          kind: 'run',
          at: '2026-09-21T03:00:04',
          heading: 'Ran on schedule',
          summary: 'Archived 1 note. Left 1 alone.',
          trigger: 'schedule',
          capped: false,
          done: [{ kind: 'archived', from: 'tasks/Old.md', to: 'Archive/tasks/Old.md' }],
          left: [{ path: '.atlas/x.md', reason: 'Atlas keeps its own files as they are.' }],
        },
      ],
      truncated: false,
    });
  });

  it('answers an undo with the run it undid and what it put back, and turning on as itself', async () => {
    const entries: LogEntry[] = [
      { kind: 'seen', at: '2026-09-20T08:00:00' },
      { kind: 'turnedOn', at: '2026-09-20T09:00:00' },
      {
        kind: 'undo',
        at: '2026-09-21T10:00:00',
        of: '2026-09-21T03:00:04',
        done: [
          {
            kind: 'restored',
            path: 'tasks/A.md' as never,
            key: 'status',
            before: { value: 'done' },
            after: { value: 'doing' },
          },
        ],
        left: [],
      },
    ];
    const files = { ...FILES, '.atlas/automations/log/finish.md': newLogText('Finish', entries) };

    const body = bodyOf(await logOf(vault(files), 'finish'));

    expect(body['entries']).toEqual([
      {
        kind: 'undo',
        at: '2026-09-21T10:00:00',
        heading: 'Undid the run of 2026-09-21 03:00:04',
        summary: 'Restored 1 note.',
        of: '2026-09-21T03:00:04',
        done: [
          {
            kind: 'restored',
            path: 'tasks/A.md',
            key: 'status',
            before: { value: 'done' },
            after: { value: 'doing' },
          },
        ],
        left: [],
      },
      expect.objectContaining({ kind: 'turnedOn', heading: 'Turned on', done: [], left: [] }),
      expect.objectContaining({ kind: 'seen', heading: 'First seen', done: [], left: [] }),
    ]);
  });

  it('keeps to limit, newest first, and says there is more', async () => {
    const body = bodyOf(await logOf(vault(), 'tidy', { limit: '1' }));

    expect((body['entries'] as { at: string }[]).map((entry) => entry.at)).toEqual([
      '2026-09-22T03:00:01',
    ]);
    expect(body['truncated']).toBe(true);
  });

  it('finds a rule whatever the case of its id, and answers an empty log for one never run', async () => {
    const body = bodyOf(await logOf(vault(), 'FINISH'));

    expect(body).toEqual({
      automation: { id: 'finish', name: 'Finish doing' },
      entries: [],
      truncated: false,
    });
  });

  it('refuses an unknown id with not_found', async () => {
    const response = await logOf(vault(), 'nope');

    expect(response.status).toBe(404);
    expect(codeOf(response)).toBe('not_found');
  });

  it('refuses a very long unknown id without echoing all of it', async () => {
    const response = await logOf(vault(), 'x'.repeat(5000));

    expect(codeOf(response)).toBe('not_found');
    const { message } = (bodyOf(response) as { error: { message: string } }).error;
    expect(message).toContain('xxxx');
    expect(message.length).toBeLessThan(200);
  });

  it('refuses a broken rule with invalid, saying why it cannot be read', async () => {
    const response = await logOf(vault(), 'Broken');

    expect(codeOf(response)).toBe('invalid');
    expect(JSON.stringify(bodyOf(response))).toContain('Say when it runs');
  });

  it('refuses a limit out of range, and an id that is not validly encoded', async () => {
    expect(codeOf(await logOf(vault(), 'tidy', { limit: '0' }))).toBe('invalid');
    expect(codeOf(await logOf(vault(), 'tidy', { limit: '101' }))).toBe('invalid');
    const response = await vault().send({ method: 'GET', path: '/v1/automations/%E0%A4/log' });
    expect(codeOf(response)).toBe('invalid');
  });

  it('refuses with no_vault when the vault is switched while it reads', async () => {
    const api = vault();
    const readNotes = api.deps.fs.readNotes;
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        readNotes: async (paths) => {
          if (paths.some((path) => path.includes('/log/'))) api.open = OTHER_VAULT;
          return readNotes(paths);
        },
      },
    };

    expect(codeOf(await logOf(api, 'tidy'))).toBe('no_vault');
  });
});

describe('POST /v1/automations/{id}/dry-run', () => {
  it('answers the notes an archive rule would take now, and writes nothing', async () => {
    const api = vault();
    const before = new Map([...api.files].map(([path, note]) => [path, note.text]));

    const response = await dryRun(api, 'tidy');

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toEqual({
      automation: { id: 'tidy', name: 'Tidy done tasks' },
      plan: {
        do: 'archive',
        set: null,
        summary: 'Would archive 2 notes.',
        notes: [
          { path: 'tasks/B.md', title: 'B' },
          { path: 'tasks/C.md', title: 'C' },
        ],
        passedOver: [],
        passedOverMore: 0,
        capped: false,
        cap: 500,
      },
    });
    expect(api.writes).toEqual([]);
    expect(api.flushed).toEqual([]);
    expect(api.followed).toEqual([]);
    expect(new Map([...api.files].map(([path, note]) => [path, note.text]))).toEqual(before);
  });

  it('answers what a set rule would set, leaving out notes that already hold it', async () => {
    const files = { ...FILES, 'tasks/D.md': jsonNote({ type: 'task', status: 'doing' }) };
    const api = vault(files);

    const { plan } = bodyOf(await dryRun(api, 'finish')) as { plan: Record<string, unknown> };

    expect(plan).toMatchObject({
      do: 'set',
      set: { status: 'done' },
      summary: 'Would change 2 notes.',
      notes: [
        { path: 'tasks/A.md', title: 'A' },
        { path: 'tasks/D.md', title: 'D' },
      ],
    });
    expect(api.writes).toEqual([]);
  });

  it('answers the notes it matched and would leave alone, with why', async () => {
    const files = { ...FILES, [DEEP('Z')]: jsonNote({ type: 'task', status: 'done' }) };

    const { plan } = bodyOf(await dryRun(vault(files), 'tidy')) as {
      plan: { notes: unknown[]; passedOver: { path: string; reason: string }[] };
    };

    expect(plan.notes).toHaveLength(2);
    expect(plan.passedOver).toEqual([
      {
        path: DEEP('Z'),
        reason: 'It is too many folders deep: in the Archive, Atlas would no longer read it.',
      },
    ]);
    expect(plan).toMatchObject({ passedOverMore: 0 });
  });

  it('answers at most 500 notes passed over, and counts the rest', async () => {
    const deep = Object.fromEntries(
      Array.from({ length: 620 }, (_, at) => [
        DEEP(`Z${String(at).padStart(4, '0')}`),
        jsonNote({ type: 'task', status: 'done' }),
      ]),
    );

    const response = await dryRun(vault({ ...FILES, ...deep }), 'tidy');

    const { plan } = bodyOf(response) as {
      plan: { notes: unknown[]; passedOver: unknown[]; passedOverMore: number };
    };
    expect(plan.notes).toHaveLength(2);
    expect(plan.passedOver).toHaveLength(500);
    expect(plan.passedOverMore).toBe(120);
  });

  it('answers a dry run for a rule that is turned off, as the app does', async () => {
    const files = {
      ...FILES,
      '.atlas/automations/Tidy done tasks.md': rule({
        id: 'tidy',
        name: 'Tidy done tasks',
        enabled: false,
        when: 'daily at 03:00',
        which: 'FROM task WHERE status = done',
        do: 'archive',
      }),
    };

    const response = await dryRun(vault(files), 'tidy');

    expect(response.status).toBe(200);
  });

  it('refuses a rule whose query does not read with query_failed, saying why', async () => {
    const files = {
      ...FILES,
      '.atlas/automations/Typo.md': rule({
        id: 'typo',
        name: 'Typo',
        when: 'manually',
        which: 'FROM tsk',
        do: 'archive',
      }),
    };
    const api = vault(files);

    const response = await dryRun(api, 'typo');

    expect(codeOf(response)).toBe('query_failed');
    expect(JSON.stringify(bodyOf(response))).toContain('tsk');
    expect(api.writes).toEqual([]);
  });

  it("answers query_failed without this machine's paths when the index refuses", async () => {
    const markdown = jsonMarkdown();
    const api = apiFixture({
      files: FILES,
      markdown,
      index: {
        query: async () => {
          throw new Error('unable to open /Users/j/Vault/.atlas-cache/index.db');
        },
      },
    });

    const response = await dryRun(api, 'tidy');

    expect(codeOf(response)).toBe('query_failed');
    expect(JSON.stringify(bodyOf(response))).not.toContain('/Users/j');
  });

  it('refuses an unknown id with not_found, and a broken rule with invalid', async () => {
    expect(codeOf(await dryRun(vault(), 'nope'))).toBe('not_found');
    expect(codeOf(await dryRun(vault(), 'broken'))).toBe('invalid');
  });

  it('refuses with no_vault when the vault is switched while the index answers', async () => {
    const api = vault();
    const query = api.deps.index.query;
    api.deps = {
      ...api.deps,
      index: {
        ...api.deps.index,
        query: async (sql, parameters) => {
          api.open = OTHER_VAULT;
          return query(sql, parameters);
        },
      },
    };

    const response = await dryRun(api, 'tidy');

    expect(codeOf(response)).toBe('no_vault');
    expect(api.writes).toEqual([]);
  });

  it('is not a route for GET, and running or undoing is no route at all', async () => {
    const api = vault();
    for (const request of [
      { method: 'GET' as const, path: '/v1/automations/tidy/dry-run' },
      { method: 'POST' as const, path: '/v1/automations/tidy/run' },
      { method: 'POST' as const, path: '/v1/automations/tidy/undo' },
      { method: 'POST' as const, path: '/v1/automations' },
      { method: 'GET' as const, path: '/v1/automations//log' },
    ]) {
      expect(codeOf(await api.send(request))).toBe('not_found_route');
    }
    expect(api.writes).toEqual([]);
  });
});
