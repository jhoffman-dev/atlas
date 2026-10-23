/**
 * Regressions found attacking the assistant tools (#535, P32-04) at the API
 * and chat edges: an `about` the full-text index cannot tokenize, an entity
 * spelt as the case-insensitive disk spells it, and answers too big for one
 * chat answer.
 */

import { describe, expect, it } from 'vitest';
import type { ApiAssistantMeetings } from './contract.ts';
import { apiFixture, bodyOf } from '../testing/api-fixture.ts';
import {
  ASSISTANT_API_FILES,
  ASSISTANT_TODAY,
  assistantApi,
  jsonNote,
  MARA,
  MIGRATION,
} from '../testing/assistant-vault.ts';
import { ftsSearch } from '../testing/fts-search.ts';
import { jsonMarkdown } from '../testing/json-markdown.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { runReadTool, TOOL_RESULT_CHARACTERS } from '../chat/read-tools.ts';

const get = (path: string, query: Record<string, string>) => ({
  method: 'GET' as const,
  path,
  query,
});

async function meetingsAbout(about: string) {
  const { api } = assistantApi();
  const response = await api.send(get('/v1/assistant/meetings', { entity: MARA, about }));
  const body = bodyOf(response)['meetingQuotes'] as unknown as ApiAssistantMeetings;
  return { status: response.status, body };
}

/** The fixture vault behind the router, grown by `extra` and indexed with it, on the pinned day. */
function apiWith(extra: Record<string, string>, caseInsensitive = false) {
  const markdown = jsonMarkdown();
  const files = { ...ASSISTANT_API_FILES, ...extra };
  const run = atlasQueryIndex({ files, markdown, modified: {} });
  const api = apiFixture({
    files,
    markdown,
    caseInsensitive,
    index: {
      query: (sql, parameters) =>
        run(sql.replaceAll("date('now', 'localtime'", `date('${ASSISTANT_TODAY}'`), parameters),
      search: ftsSearch(files),
    },
  });
  api.today = ASSISTANT_TODAY;
  return api;
}

const titles = (body: ApiAssistantMeetings) => body.meetings.map((meeting) => meeting.title);

describe('an about holding what the index does not tokenize', () => {
  it('finds the same meetings for "bank 🚀" as for "bank"', async () => {
    const plain = await meetingsAbout('bank');
    expect(titles(plain.body).length).toBeGreaterThan(0);
    const withEmoji = await meetingsAbout('bank 🚀');
    expect(withEmoji.status).toBe(200);
    expect(titles(withEmoji.body)).toEqual(titles(plain.body));
  });

  it('finds the same meetings for "bank * file" as for "bank file"', async () => {
    const plain = await meetingsAbout('bank file');
    expect(titles(plain.body).length).toBeGreaterThan(0);
    const starred = await meetingsAbout('bank * file');
    expect(starred.status).toBe(200);
    expect(titles(starred.body)).toEqual(titles(plain.body));
  });
});

describe('an entity as a case-insensitive disk spells it', () => {
  it('answers about a note the notes route opens by the same spelling', async () => {
    const api = apiWith({}, true);
    const spelt = 'people/mara quill.md';
    const note = await api.send(get(`/v1/notes/${encodeURIComponent(spelt)}`, {}));
    expect(note.status).toBe(200);
    const loops = await api.send(get('/v1/assistant/open-loops', { entity: spelt }));
    expect(loops.status).not.toBe(404);
  });
});

describe('a brief too big for one chat answer', () => {
  it('cuts whole items of its lists, so the model still reads a brief, never a broken start', async () => {
    const long = 'a very long task title about the Larkspur Payroll cut-over '.repeat(3);
    const tasks: Record<string, string> = {};
    for (let at = 0; at < 150; at += 1) {
      tasks[`Tasks/${long}${at}.md`] = jsonNote({
        type: 'task',
        status: 'next-action',
        project: '[[Payroll Migration]]',
      });
    }
    const api = apiWith(tasks);
    const result = await runReadTool({
      call: { id: 'c1', name: 'atlas_brief', input: { entity: MIGRATION } },
      api: api.deps,
      requestId: 'r1',
    });
    expect(result.isError).toBe(false);
    expect(result.content.length).toBeLessThanOrEqual(TOOL_RESULT_CHARACTERS + 100);
    const parsed = JSON.parse(result.content) as Record<string, unknown>;
    // Cut to `{ cut, start: "{\"brief\":{…" }`, the model gets half a JSON text as a string.
    expect(parsed['start']).toBeUndefined();
    const brief = parsed['brief'] as { openTasks: unknown[]; truncated: boolean };
    expect(brief.truncated).toBe(true);
    expect(brief.openTasks.length).toBeGreaterThan(0);
    expect(brief.openTasks.length).toBeLessThan(50);
    expect(parsed['cut']).toMatchObject({ list: 'brief.openTasks', of: 50 });
  });

  it('cuts the open loops the same way', async () => {
    const long = 'a very long task title about the Larkspur Payroll cut-over '.repeat(4);
    const tasks: Record<string, string> = {};
    for (let at = 0; at < 150; at += 1) {
      tasks[`Tasks/${long}${at}.md`] = jsonNote({
        type: 'task',
        status: 'next-action',
        project: '[[Payroll Migration]]',
      });
    }
    const result = await runReadTool({
      call: { id: 'c1', name: 'atlas_open_loops', input: { entity: MIGRATION } },
      api: apiWith(tasks).deps,
      requestId: 'r1',
    });
    const parsed = JSON.parse(result.content) as { openLoops: { truncated: boolean } };
    expect(result.content.length).toBeLessThanOrEqual(TOOL_RESULT_CHARACTERS + 100);
    expect(parsed.openLoops.truncated).toBe(true);
  });
});
