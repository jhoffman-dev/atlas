import { describe, expect, it } from 'vitest';
import { closingInStages } from './closing-stages.ts';

function fakeClosing() {
  const handlers: (() => Promise<void>)[] = [];
  return {
    handlers,
    port: {
      beforeClose: async (task: () => Promise<void>) => {
        handlers.push(task);
        return () => {};
      },
    },
  };
}

describe('closingInStages', () => {
  it('registers one handler, and runs every first task before any last one', async () => {
    const { handlers, port } = fakeClosing();
    const stages = closingInStages(port);
    const order: string[] = [];
    let finishSync = () => {};
    await stages.last.beforeClose(async () => void order.push('flush log'));
    await stages.first.beforeClose(
      () =>
        new Promise<void>((resolve) => {
          finishSync = () => {
            order.push('sync');
            resolve();
          };
        }),
    );
    expect(handlers).toHaveLength(1);
    const closing = handlers[0]?.();
    await Promise.resolve();
    expect(order).toEqual([]);
    finishSync();
    await closing;
    expect(order).toEqual(['sync', 'flush log']);
  });

  it('still runs the last stage when a first task fails, and forgets a task that stops', async () => {
    const { handlers, port } = fakeClosing();
    const stages = closingInStages(port);
    const order: string[] = [];
    const stop = await stages.first.beforeClose(async () => void order.push('stopped'));
    await stages.first.beforeClose(async () => {
      throw new Error('offline');
    });
    await stages.last.beforeClose(async () => void order.push('flush log'));
    stop();
    await handlers[0]?.();
    expect(order).toEqual(['flush log']);
  });
});
