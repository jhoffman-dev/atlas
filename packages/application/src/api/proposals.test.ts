/**
 * Proposals through the API (P29-02): listed, accepted and rejected by the
 * Proposals page's own use-cases, each route naming its vault, writing in
 * user space only, and never saving someone's typing (ADR-0016).
 */

import { describe, expect, it } from 'vitest';
import { apiFixture, bodyOf, codeOf, encoded, OTHER_VAULT, TODAY } from '../testing/api-fixture.ts';
import { jsonLinesMarkdown, jsonLinesNote } from '../testing/proposal-vault.ts';

const PROPOSAL = 'Inbox/Proposals/Send the payroll file.md';
const TASK = 'Send Mara the payroll file.md';

const proposal = (more: Record<string, unknown> = {}) =>
  jsonLinesNote({
    type: 'proposal',
    kind: 'task',
    confidence: 'high',
    source: '[[2026-10-01 Standup#^t0003]]',
    made_by: 'after-meeting · run 1',
    payload: {
      title: 'Send Mara the payroll file',
      properties: { meeting: '[[2026-10-01 Standup]]' },
    },
    ...more,
  });

function vault(files: Record<string, string> = {}) {
  return apiFixture({ files: { [PROPOSAL]: proposal(), ...files }, markdown: jsonLinesMarkdown() });
}

const answer = (path: string, verb: 'accept' | 'reject') => ({
  method: 'POST' as const,
  path: `/v1/proposals/${encoded(path)}/${verb}`,
});

const propertiesOf = (api: ReturnType<typeof vault>, path: string) => {
  const text = api.files.get(path)?.text ?? '';
  return jsonLinesMarkdown().frontmatterProperties(/^---\n[\s\S]*?\n---\n/.exec(text)?.[0] ?? null);
};

describe('GET /v1/proposals', () => {
  it('lists the open proposals with what each would write, and the ones it cannot read', async () => {
    const api = vault({
      'Inbox/Proposals/Odd.md': proposal({ kind: 'meeting' }),
      'Inbox/Proposals/Done.md': proposal({ state: 'rejected' }),
    });
    const response = await api.send({ method: 'GET', path: '/v1/proposals' });

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toEqual({
      proposals: [
        {
          path: PROPOSAL,
          kind: 'task',
          headline: 'Send Mara the payroll file',
          confidence: 'high',
          source: '[[2026-10-01 Standup#^t0003]]',
          madeBy: 'after-meeting · run 1',
          payload: {
            title: 'Send Mara the payroll file',
            properties: { meeting: '[[2026-10-01 Standup]]' },
          },
          modified: expect.any(Number),
        },
      ],
      stranded: [
        {
          path: 'Inbox/Proposals/Done.md',
          headline: 'Send Mara the payroll file',
          state: 'rejected',
        },
      ],
      unreadable: [{ path: 'Inbox/Proposals/Odd.md', problem: expect.stringMatching(/no kind/) }],
    });
  });

  it('answers no_vault when no vault is open', async () => {
    const api = vault();
    api.open = null;
    expect(codeOf(await api.send({ method: 'GET', path: '/v1/proposals' }))).toBe('no_vault');
  });
});

describe('POST /v1/proposals/{path}/accept', () => {
  it('makes the task, archives the proposal as accepted, and logs the write', async () => {
    const api = vault();
    const response = await api.send(answer(PROPOSAL, 'accept'));

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toEqual({
      accepted: {
        proposal: PROPOSAL,
        headline: 'Send Mara the payroll file',
        archivedAt: `Archive/${PROPOSAL}`,
        archiveProblem: null,
        wrote: [{ kind: 'created', path: TASK }],
      },
    });
    expect(propertiesOf(api, TASK)).toMatchObject({
      type: 'task',
      source: '[[2026-10-01 Standup#^t0003]]',
    });
    expect(propertiesOf(api, `Archive/${PROPOSAL}`)).toMatchObject({
      state: 'accepted',
      answered_via: 'api',
      archived: TODAY,
    });
    expect(api.activity.reports).toHaveLength(1);
    expect(api.activity.reports[0]?.message).toMatch(/^POST v1\/proposals\/\{path\}\/accept/);
  });

  it('answers conflict, writing nothing, when a note is already where the task would go', async () => {
    const api = vault({ [TASK]: 'By hand.\n' });
    const response = await api.send(answer(PROPOSAL, 'accept'));

    expect(codeOf(response)).toBe('conflict');
    expect(JSON.stringify(response.body)).toContain('There is already a note at');
    expect(api.writes).toEqual([]);
  });

  it('answers conflict for a proposal already decided', async () => {
    const api = vault({ [PROPOSAL]: proposal({ state: 'accepted' }) });
    expect(codeOf(await api.send(answer(PROPOSAL, 'accept')))).toBe('conflict');
  });

  it('refuses a note outside Inbox/Proposals as invalid, and one that is not there as not_found', async () => {
    const api = vault({ 'Notes/Plan.md': proposal() });
    expect(codeOf(await api.send(answer('Notes/Plan.md', 'accept')))).toBe('invalid');
    expect(codeOf(await api.send(answer('Inbox/Proposals/Gone.md', 'accept')))).toBe('not_found');
    expect(codeOf(await api.send(answer('.atlas/Inbox/Proposals/X.md', 'accept')))).toBe('invalid');
    expect(api.writes).toEqual([]);
  });

  it('finds the proposal however its path is cased', async () => {
    const api = vault();
    const response = await api.send(answer(PROPOSAL.toLowerCase(), 'accept'));
    expect(response.status).toBe(200);
  });

  it('leaves a proposal with typing unsaved in Atlas alone, as unsaved_in_app', async () => {
    const api = vault();
    api.deps = {
      ...api.deps,
      movingNotes: {
        ...api.deps.movingNotes,
        state: (path) => (path === PROPOSAL ? 'dirty' : 'closed'),
      },
    };
    expect(codeOf(await api.send(answer(PROPOSAL, 'accept')))).toBe('unsaved_in_app');
    expect(api.writes).toEqual([]);
  });

  it('answers no_vault when another vault is opened while it answers', async () => {
    const api = vault();
    const listed = api.deps.fs.listNotes;
    api.deps = {
      ...api.deps,
      fs: {
        ...api.deps.fs,
        listNotes: async (options) => {
          api.open = OTHER_VAULT;
          return listed(options);
        },
      },
    };
    expect(codeOf(await api.send(answer(PROPOSAL, 'accept')))).toBe('no_vault');
    expect(api.files.has(TASK)).toBe(false);
  });
});

describe('POST /v1/proposals/{path}/reject', () => {
  it('archives the proposal as rejected, writing nothing it proposed', async () => {
    const api = vault();
    const response = await api.send(answer(PROPOSAL, 'reject'));

    expect(bodyOf(response)).toEqual({
      rejected: { proposal: PROPOSAL, archivedAt: `Archive/${PROPOSAL}`, archiveProblem: null },
    });
    expect(propertiesOf(api, `Archive/${PROPOSAL}`)).toMatchObject({
      state: 'rejected',
      answered_via: 'api',
    });
    expect(api.files.has(TASK)).toBe(false);
  });

  it('answers conflict for a proposal already decided', async () => {
    const api = vault({ [PROPOSAL]: proposal({ state: 'rejected' }) });
    expect(codeOf(await api.send(answer(PROPOSAL, 'reject')))).toBe('conflict');
  });
});
