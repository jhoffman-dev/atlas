/**
 * Adversarial tests for GET /v1/types/{name}/views and the chat's
 * atlas_list_type_views (issue #11). The virtual default's `path` promises
 * "where it would be written"; these hold it to that, and the chat tool to
 * the API's error codes.
 */

import { describe, expect, it } from 'vitest';
import { runReadTool } from '../chat/read-tools.ts';
import { apiFixture, bodyOf, encoded } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';

const TASK = jsonNote({ name: 'task', label: 'Task', properties: { status: 'text' } });
const PROJECT = jsonNote({ name: 'project', label: 'Project', properties: {} });

function vault(files: Record<string, string> = {}) {
  return apiFixture({
    markdown: jsonMarkdown(),
    files: { '.atlas/types/task.md': TASK, '.atlas/types/project.md': PROJECT, ...files },
  });
}

async function virtualPath(api: ReturnType<typeof vault>, name: string): Promise<string> {
  const response = await api.send({ method: 'GET', path: `/v1/types/${encoded(name)}/views` });
  const [only] = bodyOf(response)['views'] as { path: string; virtual: boolean }[];
  expect(only?.virtual).toBe(true);
  return only?.path ?? '';
}

describe('GET /v1/types/{name}/views: the virtual default is where the app would write it', () => {
  it('does not name the path of a view lifted to Today/Inbox, which the app counts as taken', async () => {
    // A Project view whose file is "Task table.md" but whose title is "Inbox":
    // lifted out of catalog.views, so the route's taken paths miss it, while
    // the app's write (use-type-views: viewPaths ∪ savedViews) sees it and
    // writes "Task table 2.md".
    const api = vault({
      '.atlas/views/Task table.md': jsonNote({
        atlas: 'view',
        type: 'project',
        layout: 'table',
        title: 'Inbox',
      }),
    });

    expect(await virtualPath(api, 'task')).toBe('.atlas/views/Task table 2.md');
  });

  it('does not name a file that already exists in .atlas/views but is not a view', async () => {
    // No frontmatter, so the catalogue never reads it; createNote "fails
    // rather than overwriting", so this path can never be written.
    const api = vault({ '.atlas/views/Task table.md': '# Scratch notes\n' });

    expect(await virtualPath(api, 'task')).not.toBe('.atlas/views/Task table.md');
  });

  it('does not name a path that differs from a taken one only by Unicode normalisation', async () => {
    // APFS looks names up normalisation-insensitively: an NFC "Café table.md"
    // is the existing NFD file, so writing it fails.
    const cafe = jsonNote({ name: 'cafe', label: 'Café', properties: {} });
    const api = vault({
      '.atlas/types/cafe.md': cafe,
      '.atlas/views/Café table.md': jsonNote({
        atlas: 'view',
        type: 'project',
        layout: 'table',
      }),
    });

    const path = await virtualPath(api, 'cafe');

    expect(path.normalize('NFC')).not.toBe('.atlas/views/Café table.md');
  });
});

describe('chat atlas_list_type_views', () => {
  it('refuses a call with no type as invalid, not as a route that does not exist', async () => {
    const api = vault();

    const result = await runReadTool({
      call: { id: 'c1', name: 'atlas_list_type_views', input: {} },
      api: api.deps,
      requestId: 'r1',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/^invalid:/);
  });

  it('refuses a non-string type as invalid rather than looking up "[object Object]"', async () => {
    const api = vault();

    const result = await runReadTool({
      call: { id: 'c1', name: 'atlas_list_type_views', input: { type: { name: 'task' } } },
      api: api.deps,
      requestId: 'r1',
    });

    expect(result.content).toMatch(/^invalid:/);
  });

  it('answers parseable JSON for a type with many views (the tool has no limit to ask for fewer)', async () => {
    const files: Record<string, string> = {};
    for (let at = 0; at < 400; at += 1) {
      files[`.atlas/views/Task view number ${String(at).padStart(3, '0')}.md`] = jsonNote({
        atlas: 'view',
        type: 'task',
        layout: 'table',
        order: at + 1,
      });
    }
    const api = vault(files);

    const result = await runReadTool({
      call: { id: 'c1', name: 'atlas_list_type_views', input: { type: 'task' } },
      api: api.deps,
      requestId: 'r1',
    });

    expect(result.isError).toBe(false);
    expect(() => JSON.parse(result.content) as unknown).not.toThrow();
  });
});
