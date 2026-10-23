/**
 * The assistant's routes (P32-04) through the router, over the fixture vault
 * with its types in `.atlas/types`: what each answers, that every item is
 * cited, that nothing is written, and that every bad parameter — a path out
 * of the vault, a day the calendar lacks, an `about` too long — is refused
 * before anything is read.
 */

import { describe, expect, it } from 'vitest';
import type { ApiAssistantMeetings, ApiBrief, ApiOpenLoops } from './contract.ts';
import { apiFixture, bodyOf, codeOf } from '../testing/api-fixture.ts';
import {
  ASSISTANT_API_FILES,
  ASSISTANT_TODAY,
  assistantApi,
  daysAgo,
  KICKOFF,
  MARA,
  MIGRATION,
} from '../testing/assistant-vault.ts';
import { jsonMarkdown } from '../testing/json-markdown.ts';

const FILES = ASSISTANT_API_FILES;

const get = (path: string, query: Record<string, string>) => ({
  method: 'GET' as const,
  path,
  query,
});

describe('GET /v1/assistant/brief', () => {
  it('briefs a person for a day, every item cited, writing nothing', async () => {
    const { api } = assistantApi();
    const response = await api.send(
      get('/v1/assistant/brief', { entity: MARA, date: ASSISTANT_TODAY }),
    );
    expect(response.status).toBe(200);
    const brief = bodyOf(response)['brief'] as ApiBrief;
    expect(brief.entity.cite.link).toBe('[[Mara Quill]]');
    expect(brief.date).toBe(ASSISTANT_TODAY);
    expect(brief.lastTouch?.path).toBe('Meetings/Cut-over review.md');
    expect(brief.followUps.map((task) => [task.path, task.source?.link])).toEqual([
      ['Tasks/Chase the bank.md', '[[Kickoff#^t0004]]'],
    ]);
    expect(brief.waitingFor.map((task) => task.cite.link)).toEqual(['[[Get the bank file]]']);
    expect(api.writes).toEqual([]);
  });

  it('answers the day on the app’s clock when no date is asked', async () => {
    const { api } = assistantApi();
    const response = await api.send(get('/v1/assistant/brief', { entity: MIGRATION }));
    expect(response.status).toBe(200);
    expect((bodyOf(response)['brief'] as ApiBrief).date).toBe('2026-09-22');
  });

  it('refuses a task: only a person, company, project, area or meeting has a brief', async () => {
    const { api } = assistantApi();
    const response = await api.send(
      get('/v1/assistant/brief', { entity: 'Tasks/Draft the plan.md' }),
    );
    expect(codeOf(response)).toBe('invalid');
    expect(JSON.stringify(response.body)).toContain('this is a task note');
  });
});

describe('GET /v1/assistant/open-loops', () => {
  it('answers a project’s open loops, each cited, writing nothing', async () => {
    const { api } = assistantApi();
    const response = await api.send(get('/v1/assistant/open-loops', { entity: MIGRATION }));
    expect(response.status).toBe(200);
    const loops = bodyOf(response)['openLoops'] as ApiOpenLoops;
    expect(loops.openTasks.map((task) => task.path)).toEqual(['Tasks/Draft the plan.md']);
    expect(loops.waitingFor.map((task) => task.path)).toEqual([
      'Tasks/Send the contract.md',
      'Tasks/Get the bank file.md',
    ]);
    expect(loops.followUps.map((task) => task.path)).toEqual(['Tasks/Chase the bank.md']);
    expect(api.writes).toEqual([]);
  });

  it('refuses a meeting', async () => {
    const { api } = assistantApi();
    const response = await api.send(get('/v1/assistant/open-loops', { entity: KICKOFF }));
    expect(codeOf(response)).toBe('invalid');
  });
});

describe('GET /v1/assistant/meetings', () => {
  it('quotes what a person said about something since a day, each turn cited by its block', async () => {
    const { api } = assistantApi();
    const response = await api.send(
      get('/v1/assistant/meetings', {
        entity: MARA,
        since: daysAgo(30),
        about: 'rollback',
        limit: '5',
      }),
    );
    expect(response.status).toBe(200);
    const said = bodyOf(response) as unknown as ApiAssistantMeetings;
    expect(said.speakers).toEqual(['Mara Quill', 'MQ']);
    expect(
      said.meetings.map((meeting) => [
        meeting.path,
        meeting.quotes.map((quote) => quote.cite.link),
      ]),
    ).toEqual([
      ['Meetings/Cut-over review.md', ['[[Cut-over review#Transcript]]']],
      [KICKOFF, ['[[Kickoff#^t0003]]']],
    ]);
    expect(api.writes).toEqual([]);
  });

  it('takes a blank about as none', async () => {
    const { api } = assistantApi();
    const response = await api.send(get('/v1/assistant/meetings', { entity: MARA, about: '   ' }));
    expect((bodyOf(response) as unknown as ApiAssistantMeetings).about).toBeNull();
  });
});

const ROUTES = ['/v1/assistant/brief', '/v1/assistant/open-loops', '/v1/assistant/meetings'];

describe('the assistant routes refuse a bad entity before reading anything', () => {
  const refusals: [string, string, string][] = [
    ['no entity', '', 'invalid'],
    ['a path out of the vault', '../Secrets/Mara.md', 'invalid'],
    ['a path that climbs back in', 'People/../../Mara Quill.md', 'invalid'],
    ['an absolute path', '/Users/j/Vault/People/Mara Quill.md', 'invalid'],
    ['a backslash path', 'People\\Mara Quill.md', 'invalid'],
    ['a null byte', 'People/Mara Quill.md\u0000.md', 'invalid'],
    ["DFAI's own folder", '.atlas/types/person.md', 'invalid'],
    ['a file that is not a note', 'People/Mara Quill.pdf', 'invalid'],
    ['a note the vault does not hold', 'People/Nobody.md', 'not_found'],
  ];

  for (const route of ROUTES) {
    for (const [what, entity, code] of refusals) {
      it(`${route}: ${what}`, async () => {
        const { api, asked } = assistantApi();
        const response = await api.send(get(route, entity === '' ? {} : { entity }));
        expect(codeOf(response)).toBe(code);
        expect(asked).toEqual([]);
      });
    }
  }
});

describe('the assistant routes refuse a bad parameter', () => {
  const refusals: [string, string, Record<string, string>][] = [
    ['brief', 'a day the calendar lacks', { date: '2026-02-30' }],
    ['brief', 'a day not written YYYY-MM-DD', { date: '2026-1-1' }],
    ['brief', 'a day with a time', { date: '2026-01-01T09:00' }],
    ['brief', 'a five-digit year', { date: '99999-01-01' }],
    ['meetings', 'a huge since', { since: `${'9'.repeat(4000)}-01-01` }],
    ['meetings', 'a since that is words', { since: 'last week' }],
    ['meetings', 'a since with spaces around it', { since: ' 2026-01-01 ' }],
    ['meetings', 'an about longer than a question', { about: 'x'.repeat(501) }],
    ['meetings', 'a limit of none', { limit: '0' }],
    ['meetings', 'a limit past the most', { limit: '51' }],
    ['meetings', 'a limit that is not a number', { limit: '10; DROP TABLE files' }],
  ];

  for (const [route, what, query] of refusals) {
    it(`${route}: ${what}`, async () => {
      const { api, asked } = assistantApi();
      const response = await api.send(get(`/v1/assistant/${route}`, { entity: MARA, ...query }));
      expect(codeOf(response)).toBe('invalid');
      expect(asked).toEqual([]);
    });
  }

  it('takes the far edges of the calendar it does have', async () => {
    const { api } = assistantApi();
    const response = await api.send(
      get('/v1/assistant/meetings', { entity: MARA, since: '9999-12-31' }),
    );
    expect(response.status).toBe(200);
    expect((bodyOf(response) as unknown as ApiAssistantMeetings).meetings).toEqual([]);
  });

  it('searches an about full of query syntax as words, never as syntax', async () => {
    const { api } = assistantApi();
    const response = await api.send(
      get('/v1/assistant/meetings', { entity: MARA, about: 'bank" OR file* NEAR(x) -- )' }),
    );
    expect(response.status).toBe(200);
  });
});

describe('the assistant routes, when the index cannot answer', () => {
  const failing = () =>
    apiFixture({
      files: FILES,
      markdown: jsonMarkdown(),
      index: {
        query: () => Promise.reject(new Error('unable to open /Users/j/Library/dfai/index.db')),
      },
    });

  it('say so without the machine’s paths', async () => {
    for (const route of ['/v1/assistant/brief', '/v1/assistant/open-loops']) {
      const response = await failing().send(get(route, { entity: MARA }));
      expect(codeOf(response)).toBe('query_failed');
      expect(JSON.stringify(response.body)).toContain('unable to open');
      expect(JSON.stringify(response.body)).not.toContain('/Users/j');
    }
  });

  it('say which section could not be answered when it is the only thing asked', async () => {
    const response = await failing().send(get('/v1/assistant/meetings', { entity: MARA }));
    expect(response.status).toBe(200);
    const said = bodyOf(response) as unknown as ApiAssistantMeetings;
    expect(said.meetings).toEqual([]);
    expect(said.problems).toEqual([{ section: 'meetings', problem: 'unable to open <path>' }]);
  });
});
