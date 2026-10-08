import { describe, expect, it } from 'vitest';
import { recordingActivity } from '../testing/fake-activity.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { syncIndex } from './sync-index.ts';

function setUp(
  index = fakeIndexPort({ stats: async () => ({ notes: 40, properties: 3, links: 2 }) }),
) {
  const steps: string[] = [];
  const watched = {
    ...index,
    open: async () => {
      steps.push('open');
      return { fresh: false };
    },
    clear: async () => void steps.push('clear'),
  };
  const activity = recordingActivity();
  const sync = (fromScratch: boolean) =>
    syncIndex({
      fs: fakeVaultFs(),
      index: watched,
      markdown: fakeMarkdown(),
      fromScratch,
      activity,
    });
  return { steps, activity, sync };
}

describe('syncIndex', () => {
  it('opens, brings the index up to date and answers what it holds, saying nothing', async () => {
    const { steps, activity, sync } = setUp();
    expect((await sync(false)).stats).toEqual({ notes: 40, properties: 3, links: 2 });
    expect(steps).toEqual(['open']);
    expect(activity.reports).toEqual([]);
  });

  it('rebuilds from nothing and records it', async () => {
    const { steps, activity, sync } = setUp();
    await sync(true);
    expect(steps).toEqual(['open', 'clear']);
    expect(activity.reports).toEqual([
      { level: 'info', kind: 'index', message: 'Rebuilt the index: 40 notes.', subject: null },
    ]);
  });

  it('records a failure as an error, without the machine path, and passes it on', async () => {
    const failing = fakeIndexPort({
      open: () => Promise.reject(new Error('unable to open /Users/j/Vault/.atlas/index.sqlite')),
    });
    const activity = recordingActivity();
    await expect(
      syncIndex({
        fs: fakeVaultFs(),
        index: failing,
        markdown: fakeMarkdown(),
        fromScratch: false,
        activity,
      }),
    ).rejects.toThrow('unable to open');
    expect(activity.reports).toEqual([
      {
        level: 'error',
        kind: 'index',
        message: 'The index could not be brought up to date. unable to open <path>',
        subject: null,
      },
    ]);
  });

  it('says a rebuild failed as a rebuild', async () => {
    const failing = fakeIndexPort({ clear: () => Promise.reject(new Error('locked')) });
    const activity = recordingActivity();
    await expect(
      syncIndex({
        fs: fakeVaultFs(),
        index: failing,
        markdown: fakeMarkdown(),
        fromScratch: true,
        activity,
      }),
    ).rejects.toThrow('locked');
    expect(activity.reports[0]?.message).toBe('The index could not be rebuilt. locked');
  });
});
