/**
 * Items pushed from callbacks, read back as an async iterable: how a program's
 * lines, which arrive as events, become a stream a `for await` can read.
 */
export interface EventQueue<T> {
  push(item: T): void;
  /** No more items. With an error, reading throws it once the items before it are read. */
  close(error: Error | null): void;
  drain(): AsyncGenerator<T, void, undefined>;
}

export function createEventQueue<T>(): EventQueue<T> {
  const items: T[] = [];
  let closed: { error: Error | null } | null = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  return {
    push(item) {
      if (closed !== null) return;
      items.push(item);
      notify();
    },
    close(error) {
      if (closed !== null) return;
      closed = { error };
      notify();
    },
    async *drain() {
      for (;;) {
        const next = items.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        if (closed !== null) {
          if (closed.error !== null) throw closed.error;
          return;
        }
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
}
