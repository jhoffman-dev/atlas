import { describe, expect, it } from 'vitest';
import { QueryObserver } from '@tanstack/react-query';
import type { VaultRead } from '@atlas/application';
import { createWindowQueryClient, vaultReadKey } from './query-client.ts';
import { createReadInvalidator } from './read-invalidator.ts';

/** A window's cache with one vault's reads shown, counting how often each is read. */
function shownReads(vaults: readonly string[] = ['/one']) {
  const client = createWindowQueryClient();
  const reads = new Map<string, number>();
  const unsubscribes: (() => void)[] = [];
  for (const vault of vaults) {
    for (const read of ['graph', 'tags', 'types', 'templates'] as const) {
      const name = `${vault}:${read}`;
      const observer = new QueryObserver(client, {
        queryKey: vaultReadKey(vault, read),
        queryFn: async () => {
          reads.set(name, (reads.get(name) ?? 0) + 1);
          return reads.get(name);
        },
      });
      unsubscribes.push(observer.subscribe(() => {}));
    }
  }
  const settledReads = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return Object.fromEntries(reads);
  };
  return { client, settledReads, stop: () => unsubscribes.forEach((stop) => stop()) };
}

describe('the window’s whole-vault reads, told what changed', () => {
  it('reads again at once only what it is told, of the vault it is told', async () => {
    const { client, settledReads, stop } = shownReads(['/one', '/two']);
    const reads = createReadInvalidator({ client });
    await settledReads();

    reads.invalidate('/one', ['types']);

    expect(await settledReads()).toEqual({
      '/one:graph': 1,
      '/one:tags': 1,
      '/one:types': 2,
      '/one:templates': 1,
      '/two:graph': 1,
      '/two:tags': 1,
      '/two:types': 1,
      '/two:templates': 1,
    });
    stop();
  });

  it('holds what the index changed until it has news, then reads each once', async () => {
    const { client, settledReads, stop } = shownReads();
    const reads = createReadInvalidator({ client });
    await settledReads();

    reads.invalidateWithIndex('/one', ['graph']);
    reads.invalidateWithIndex('/one', ['graph', 'tags']);
    expect((await settledReads())['/one:graph']).toBe(1);

    reads.indexMoved('/one');
    const after = await settledReads();
    expect(after['/one:graph']).toBe(2);
    expect(after['/one:tags']).toBe(2);
    expect(after['/one:types']).toBe(1);

    // News with nothing held reads nothing.
    reads.indexMoved('/one');
    expect((await settledReads())['/one:graph']).toBe(2);
    stop();
  });

  it('holds each vault’s reads for its own news', async () => {
    const { client, settledReads, stop } = shownReads(['/one', '/two']);
    const reads = createReadInvalidator({ client });
    await settledReads();

    reads.invalidateWithIndex('/one', ['graph']);
    reads.indexMoved('/two');
    expect((await settledReads())['/one:graph']).toBe(1);
    stop();
  });

  it('reads nothing for a change that touched nothing', async () => {
    const { client, settledReads, stop } = shownReads();
    const reads = createReadInvalidator({ client });
    await settledReads();

    reads.invalidate('/one', []);
    reads.invalidateWithIndex('/one', new Set<VaultRead>());
    reads.indexMoved('/one');

    expect(Object.values(await settledReads())).toEqual([1, 1, 1, 1]);
    stop();
  });

  it('drops a vault’s reads as it closes, and what was waiting for it', async () => {
    const { client, settledReads, stop } = shownReads();
    const reads = createReadInvalidator({ client });
    await settledReads();
    reads.invalidateWithIndex('/one', ['graph']);

    reads.forget('/one');

    expect(reads.waitingFor('/one').size).toBe(0);
    expect(client.getQueryCache().findAll({ queryKey: ['vault', '/one'] })).toEqual([]);
    stop();
  });

  it('drops a read already under way when told it changed, rather than joining it', async () => {
    const client = createWindowQueryClient();
    const answers: ((value: string) => void)[] = [];
    const observer = new QueryObserver(client, {
      queryKey: vaultReadKey('/one', 'types'),
      queryFn: () => new Promise<string>((resolve) => answers.push(resolve)),
    });
    const stop = observer.subscribe(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(answers).toHaveLength(1);

    createReadInvalidator({ client }).invalidate('/one', ['types']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(answers).toHaveLength(2);
    answers[1]?.('after the save');
    answers[0]?.('before the save');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.getQueryData(vaultReadKey('/one', 'types'))).toBe('after the save');
    stop();
  });
});

describe('what is waiting', () => {
  it('is what the index changed, until it has news', () => {
    const reads = createReadInvalidator({ client: createWindowQueryClient() });

    reads.invalidateWithIndex('/one', ['graph']);
    reads.invalidateWithIndex('/one', ['tags']);
    expect([...reads.waitingFor('/one')].sort()).toEqual(['graph', 'tags']);
    expect([...reads.waitingFor('/two')]).toEqual([]);

    reads.indexMoved('/one');
    expect([...reads.waitingFor('/one')]).toEqual([]);
  });
});

describe('a read that failed', () => {
  it('is read again on the vault’s next news, and one that worked is not', async () => {
    const client = createWindowQueryClient();
    let typeReads = 0;
    let graphReads = 0;
    const failing = new QueryObserver(client, {
      queryKey: vaultReadKey('/one', 'types'),
      queryFn: async () => {
        typeReads += 1;
        if (typeReads === 1) throw new Error('the disk was busy');
        return 'types';
      },
    });
    const working = new QueryObserver(client, {
      queryKey: vaultReadKey('/one', 'graph'),
      queryFn: async () => (graphReads += 1),
    });
    const stops = [failing.subscribe(() => {}), working.subscribe(() => {})];
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.getQueryState(vaultReadKey('/one', 'types'))?.status).toBe('error');

    const reads = createReadInvalidator({ client });
    reads.indexMoved('/two');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(typeReads).toBe(1);

    reads.indexMoved('/one');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(typeReads).toBe(2);
    expect(client.getQueryData(vaultReadKey('/one', 'types'))).toBe('types');
    expect(graphReads).toBe(1);
    stops.forEach((stop) => stop());
  });
});
