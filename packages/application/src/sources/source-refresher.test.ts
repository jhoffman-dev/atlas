import { describe, expect, it } from 'vitest';
import { parseDatasource, type Datasource, type HttpRequest } from '@atlas/domain';
import { createActivityLog } from '../activity/activity-log.ts';
import { memoryActivityStore, recordingActivity } from '../testing/fake-activity.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { createSourceRefresher, type SourceRefreshArgs } from './source-refresher.ts';

const NOW = 1_700_000_000_000;

function source(url: string): Datasource {
  const parsed = parseDatasource({ atlas: 'source', format: 'json', url, into: 'X', type: 'x' });
  if (parsed === null) throw new Error('not a source');
  return parsed;
}

/** A refresh whose feed answers only when the test says so. */
function held(sourcePath: string, url = 'https://example.com/feed.json') {
  const fetched: HttpRequest[] = [];
  let answer: (text: string) => void = () => {};
  const args: SourceRefreshArgs = {
    fs: fakeVaultFs(),
    markdown: fakeMarkdown(),
    index: fakeIndexPort(),
    http: {
      get: ({ request }) => {
        fetched.push(request);
        return new Promise((resolve) => (answer = resolve));
      },
    },
    sqlite: { query: () => Promise.reject(new Error('no SQLite here')) },
    sourcePath,
    source: source(url),
    vault: '/Users/j/Vault',
    now: NOW,
  };
  return { args, fetched, answer: (text: string) => answer(text) };
}

describe('createSourceRefresher', () => {
  it('reads nothing for a source with a secret outside .atlas/sources, and reports why', async () => {
    const refresh = held('Feeds/GitHub.md', 'https://api.github.com/?t={{secret:github}}');

    const report = await createSourceRefresher({ activity: recordingActivity() }).refresh(
      refresh.args,
    );

    expect(refresh.fetched).toEqual([]);
    expect(report).toMatchObject({ ran: NOW, created: 0, error: expect.stringMatching(/github/) });
  });

  it('runs the same source from .atlas/sources', async () => {
    const refresh = held('.atlas/sources/GitHub.md', 'https://api.github.com/?t={{secret:github}}');

    const running = createSourceRefresher({ activity: recordingActivity() }).refresh(refresh.args);
    await expect.poll(() => refresh.fetched.length).toBe(1);
    refresh.answer('[]');

    expect(await running).toMatchObject({ error: null });
  });

  it('answers null for a second refresh of a source already under way', async () => {
    const refresher = createSourceRefresher({ activity: recordingActivity() });
    const refresh = held('Feed.md');

    const first = refresher.refresh(refresh.args);
    await expect.poll(() => refresh.fetched.length).toBe(1);

    expect(await refresher.refresh(refresh.args)).toBe(null);
    refresh.answer('[]');
    expect(await first).not.toBe(null);
  });

  it('keeps its own record of what is running: another refresher is not held up', async () => {
    const refresh = held('Feed.md');

    void createSourceRefresher({ activity: recordingActivity() }).refresh(refresh.args);
    await expect.poll(() => refresh.fetched.length).toBe(1);
    void createSourceRefresher({ activity: recordingActivity() }).refresh(refresh.args);

    await expect.poll(() => refresh.fetched.length).toBe(2);
  });
});

describe('a refresh in the Activity log', () => {
  it('records a refresh that ran, by the source note, never by its URL', async () => {
    const activity = recordingActivity();
    const refresh = held('.atlas/sources/GitHub.md', 'https://api.github.com/?t={{secret:github}}');
    const running = createSourceRefresher({ activity }).refresh(refresh.args);
    await expect.poll(() => refresh.fetched.length).toBe(1);
    refresh.answer('[]');
    await running;
    expect(activity.reports).toEqual([
      {
        level: 'info',
        kind: 'source',
        message: 'GitHub: Refreshed. 0 records, nothing changed.',
        subject: { kind: 'source', path: '.atlas/sources/GitHub.md' },
      },
    ]);
    expect(JSON.stringify(activity.reports)).not.toContain('api.github.com');
  });

  it('records a refresh that failed as an error, and why', async () => {
    const activity = recordingActivity();
    const refresh = held('Feed.md');
    const running = createSourceRefresher({ activity }).refresh(refresh.args);
    await expect.poll(() => refresh.fetched.length).toBe(1);
    refresh.answer('this is not json');
    await running;
    expect(activity.reports).toHaveLength(1);
    expect(activity.reports[0]).toMatchObject({ level: 'error', kind: 'source' });
    expect(activity.reports[0]?.message).toMatch(/^Feed: Refresh failed\. /);
  });

  it('records a refresh refused for where its note is', async () => {
    const activity = recordingActivity();
    const refresh = held('Feeds/GitHub.md', 'https://api.github.com/?t={{secret:github}}');
    await createSourceRefresher({ activity }).refresh(refresh.args);
    expect(activity.reports).toHaveLength(1);
    expect(activity.reports[0]).toMatchObject({ level: 'error', subject: { kind: 'source' } });
  });

  it('records nothing for a refresh turned away because one is under way', async () => {
    const activity = recordingActivity();
    const refresher = createSourceRefresher({ activity });
    const refresh = held('Feed.md');
    const first = refresher.refresh(refresh.args);
    await expect.poll(() => refresh.fetched.length).toBe(1);
    await refresher.refresh(refresh.args);
    expect(activity.reports).toEqual([]);
    refresh.answer('[]');
    await first;
    expect(activity.reports).toHaveLength(1);
  });
});

describe('a refresh in the Activity log, adversarial (U-28)', () => {
  it('keeps a refresh that finished after another vault opened in its own vault’s log', async () => {
    const files = memoryActivityStore();
    let open: string | null = '/Users/j/Vault';
    const activity = createActivityLog({
      store: files,
      clock: { now: () => NOW },
      vault: () => open,
      schedule: () => undefined,
      onError: (cause) => {
        throw cause;
      },
    });
    const refresh = held('.atlas/sources/GitHub.md');
    const running = createSourceRefresher({ activity }).refresh(refresh.args);
    await expect.poll(() => refresh.fetched.length).toBe(1);
    // The person opens another vault while the feed is still answering.
    open = '/Users/j/Other';
    refresh.answer('[]');
    await running;
    await activity.flush();
    expect(files.files.get('/Users/j/Other') ?? '').toBe('');
    expect(files.files.get('/Users/j/Vault') ?? '').toContain('GitHub: Refreshed.');
  });
});
