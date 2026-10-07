/**
 * The read-only automations routes, attacked as a token holder or a
 * prompt-injected MCP client would: every route, every odd rule and every odd
 * id must write nothing; a log must not hand out this machine's paths; an id
 * must name the rule the disk's log file names.
 */

import { describe, expect, it } from 'vitest';
import { newLogText, type LogEntry } from '@atlas/domain';
import type { HostVaultFsPort } from '../vault/ports.ts';
import { apiFixture, bodyOf, codeOf, encoded } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';

const rule = (fields: Record<string, unknown>) =>
  jsonNote({ atlas: 'automation', enabled: true, ...fields });

const TYPE = jsonNote({
  name: 'task',
  label: 'Task',
  properties: {
    status: { kind: 'select', options: ['todo', 'doing', 'done'] },
    due: { kind: 'date' },
  },
});

type Api = ReturnType<typeof apiFixture>;

function vault(files: Record<string, string>): Api {
  const markdown = jsonMarkdown();
  return apiFixture({ files, markdown, index: { query: atlasQueryIndex({ files, markdown }) } });
}

const MUTATING = [
  'createNote',
  'createFolder',
  'moveEntry',
  'trashEntry',
  'writeTextFile',
  'writeBinaryFile',
] as const satisfies readonly (keyof HostVaultFsPort)[];

/** Every call to a method that could change the disk, whether or not the fake lets it land. */
function spyOnWrites(api: Api): string[] {
  const calls: string[] = [];
  const fs = { ...api.deps.fs } as Record<string, unknown>;
  for (const method of MUTATING) {
    const real = fs[method] as (...args: unknown[]) => unknown;
    fs[method] = (...args: unknown[]) => {
      calls.push(`${method} ${JSON.stringify(args[0])}`);
      return real(...args);
    };
  }
  api.deps = { ...api.deps, fs: fs as unknown as HostVaultFsPort };
  return calls;
}

const list = (api: Api) => api.send({ method: 'GET', path: '/v1/automations' });
const logOf = (api: Api, id: string, query: Record<string, string> = {}) =>
  api.send({ method: 'GET', path: `/v1/automations/${encoded(id)}/log`, query });
const dryRun = (api: Api, id: string) =>
  api.send({ method: 'POST', path: `/v1/automations/${encoded(id)}/dry-run` });

describe('automations API writes nothing', () => {
  const tasks = (count: number, status: string) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, at) => [
        `tasks/T${String(at).padStart(4, '0')}.md`,
        jsonNote({ type: 'task', status, due: '2026-01-01' }),
      ]),
    );
  const FILES: Record<string, string> = {
    '.atlas/types/task.md': TYPE,
    // Written id.
    '.atlas/automations/Tidy.md': rule({
      id: 'tidy',
      name: 'Tidy',
      when: 'daily at 03:00',
      which: 'FROM task WHERE status = done',
      do: 'archive',
    }),
    // No id: the app would stamp one and mark it first seen.
    '.atlas/automations/Legacy.md': rule({
      name: 'Legacy',
      when: 'every 1 hour',
      which: 'FROM task WHERE status = done',
      do: 'archive',
    }),
    // Pins @today.
    '.atlas/automations/Overdue.md': rule({
      id: 'overdue',
      name: 'Overdue',
      when: 'manually',
      which: 'FROM task WHERE due < @today',
      do: 'set',
      set: { status: 'doing' },
    }),
    // Past the cap.
    '.atlas/automations/Everything.md': rule({
      id: 'everything',
      name: 'Everything',
      when: 'on app open',
      which: 'FROM task',
      do: 'set',
      set: { status: 'todo' },
    }),
    // Broken, and a copy sharing an id.
    '.atlas/automations/Broken.md': rule({ name: 'Broken', which: 'FROM task', do: 'archive' }),
    '.atlas/automations/Tidy copy.md': rule({
      id: 'tidy',
      name: 'Tidy copy',
      when: 'manually',
      which: 'FROM task',
      do: 'archive',
    }),
    // A query that does not read.
    '.atlas/automations/Bad query.md': rule({
      id: 'bad',
      name: 'Bad query',
      when: 'manually',
      which: 'FROM tsk WHERE',
      do: 'archive',
    }),
    // An id that is also a log's folder name.
    '.atlas/automations/Log.md': rule({
      id: 'log',
      name: 'Log',
      when: 'manually',
      which: 'FROM task',
      do: 'archive',
    }),
    ...tasks(600, 'done'),
  };
  const IDS = [
    'tidy',
    'TIDY',
    'Legacy',
    'overdue',
    'everything',
    'Broken',
    'Tidy copy',
    'bad',
    'log',
    '..',
    '.',
    '../types/task',
    'tidy/../tidy',
    '%2F',
    'Tidy.md',
    'x'.repeat(5000),
  ];

  it('no route calls a single mutating fs method, for any rule or id', async () => {
    const api = vault(FILES);
    const calls = spyOnWrites(api);

    expect((await list(api)).status).toBe(200);
    const reached = new Map<string, string | null>();
    for (const id of IDS) {
      await logOf(api, id);
      await logOf(api, id, { limit: '100' });
      reached.set(id, codeOf(await dryRun(api, id)));
    }

    // The sweep got past the lookup for every kind of rule, so a write had every chance.
    expect(Object.fromEntries([...reached].slice(0, 9))).toEqual({
      tidy: null,
      TIDY: null,
      Legacy: null,
      overdue: null,
      everything: null,
      Broken: 'invalid',
      // The copy's file sorts first, so it holds the id `tidy`; the original is the broken one.
      'Tidy copy': 'not_found',
      bad: 'query_failed',
      log: null,
    });
    expect(calls).toEqual([]);
    expect(api.writes).toEqual([]);
  });

  it('the dry run of a rule past the cap answers the cap, not every match', async () => {
    const api = vault(FILES);

    const response = await dryRun(api, 'everything');

    expect(response.status).toBe(200);
    const { plan } = bodyOf(response) as { plan: { notes: unknown[]; capped: boolean } };
    expect(plan.notes).toHaveLength(500);
    expect(plan.capped).toBe(true);
  });
});

describe("the log never hands out this machine's paths", () => {
  // As the runner writes them: an index refusal's words, and the host's words for a note it could not change.
  const FAILED: LogEntry = {
    kind: 'failed',
    at: '2026-09-22T03:00:01',
    trigger: 'schedule',
    problem: 'unable to open database file /Users/j/Vault/.atlas-cache/index.sqlite',
  };
  const RAN: LogEntry = {
    kind: 'run',
    at: '2026-09-21T03:00:04',
    trigger: 'schedule',
    done: [],
    left: [
      {
        path: 'tasks/A.md' as never,
        reason: 'Permission denied (os error 13): /Users/j/Vault/tasks/A.md',
      },
    ],
    capped: false,
  };
  const FILES: Record<string, string> = {
    '.atlas/types/task.md': TYPE,
    '.atlas/automations/Tidy.md': rule({
      id: 'tidy',
      name: 'Tidy',
      when: 'daily at 03:00',
      which: 'FROM task WHERE status = done',
      do: 'archive',
    }),
    '.atlas/automations/log/tidy.md': newLogText('Tidy', [RAN, FAILED]),
  };

  it("a failed run's problem is answered without the index's absolute path", async () => {
    const response = await logOf(vault(FILES), 'tidy');

    expect(response.status).toBe(200);
    const [failed] = (bodyOf(response) as { entries: Record<string, unknown>[] }).entries;
    expect(failed?.['kind']).toBe('failed');
    expect(JSON.stringify(failed)).not.toContain('/Users/j');
  });

  it("a note a run left alone is answered without the host's absolute path", async () => {
    const response = await logOf(vault(FILES), 'tidy');

    const entries = (bodyOf(response) as { entries: Record<string, unknown>[] }).entries;
    const run = entries.find((entry) => entry['kind'] === 'run');
    expect(JSON.stringify(run)).not.toContain('/Users/j');
  });

  it("the list's last run summary is answered without the index's absolute path", async () => {
    const response = await list(vault(FILES));

    expect(response.status).toBe(200);
    expect(JSON.stringify(bodyOf(response))).not.toContain('/Users/j');
  });
});

describe('an id names what its log file names', () => {
  const NFC = 'Café';
  const NFD = 'Café';
  const cafe = (id: string, name: string) =>
    rule({ id, name, when: 'manually', which: 'FROM task WHERE status = done', do: 'archive' });

  it('finds a rule by its id written in the other Unicode form, as the disk would', async () => {
    const api = vault({
      '.atlas/types/task.md': TYPE,
      '.atlas/automations/Cafe.md': cafe(NFC, 'Cafe'),
    });

    const response = await logOf(api, NFD);

    expect(codeOf(response)).toBeNull();
    expect(response.status).toBe(200);
  });

  it('lists two rules whose ids differ only in Unicode form as one rule and one broken', async () => {
    const api = vault({
      '.atlas/types/task.md': TYPE,
      '.atlas/automations/One.md': cafe(NFC, 'One'),
      '.atlas/automations/Two.md': cafe(NFD, 'Two'),
    });

    const body = bodyOf(await list(api)) as { automations: unknown[]; broken: unknown[] };

    // On a disk that ignores the form, both ids name one log file: each would undo the other's runs.
    expect(body.automations).toHaveLength(1);
    expect(body.broken).toHaveLength(1);
  });
});

describe('log limit', () => {
  const FILES: Record<string, string> = {
    '.atlas/types/task.md': TYPE,
    '.atlas/automations/Tidy.md': rule({
      id: 'tidy',
      name: 'Tidy',
      when: 'daily at 03:00',
      which: 'FROM task',
      do: 'archive',
    }),
  };

  it.each([
    '0',
    '-1',
    '101',
    '1.5',
    '1e1',
    ' 5',
    '',
    'NaN',
    'Infinity',
    '0x10',
    '99999999999999999999',
  ])('refuses limit=%j with invalid', async (limit) => {
    expect(codeOf(await logOf(vault(FILES), 'tidy', { limit }))).toBe('invalid');
  });
});
