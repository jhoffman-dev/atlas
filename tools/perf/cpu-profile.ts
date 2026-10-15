/**
 * Reading a CPU profile taken through the Chrome DevTools Protocol (#217):
 * where the main thread's time went, by function, so a slow action names its
 * cause instead of being guessed at. WebKit, the engine the app ships in, has
 * no profiler Playwright can drive; Chromium's is used for the "why", and
 * WebKit's frame timings for the "how long".
 */

/** A profile as `Profiler.stop` returns it. */
export interface CpuProfile {
  readonly nodes: readonly {
    readonly id: number;
    readonly callFrame: {
      readonly functionName: string;
      readonly url: string;
      readonly lineNumber: number;
    };
    readonly children?: readonly number[];
  }[];
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
}

/** One function's share of a profile, in milliseconds. */
export interface FunctionTime {
  readonly name: string;
  /** Time with this function on top of the stack. */
  readonly self: number;
  /** Time with this function anywhere on the stack. */
  readonly total: number;
}

const IDLE = new Set(['(idle)', '(program)', '(garbage collector)', '(root)']);

function frameName(frame: CpuProfile['nodes'][number]['callFrame']): string {
  const file = frame.url.split('/').at(-1) ?? '';
  return `${frame.functionName || '(anonymous)'} ${file}:${frame.lineNumber + 1}`;
}

/** The functions that took the most time, by total time, busiest first. */
export function busiestFunctions(profile: CpuProfile, limit = 30): FunctionTime[] {
  const parent = new Map<number, number>();
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) parent.set(child, node.id);
  }
  const self = new Map<string, number>();
  const total = new Map<string, number>();
  profile.samples.forEach((sample, index) => {
    const ms = (profile.timeDeltas[index + 1] ?? 0) / 1000;
    const top = byId.get(sample);
    if (top === undefined || IDLE.has(top.callFrame.functionName)) return;
    const topName = frameName(top.callFrame);
    self.set(topName, (self.get(topName) ?? 0) + ms);
    const seen = new Set<string>();
    for (let id: number | undefined = sample; id !== undefined; id = parent.get(id)) {
      const node = byId.get(id);
      if (node === undefined) break;
      const name = frameName(node.callFrame);
      if (seen.has(name) || IDLE.has(node.callFrame.functionName)) continue;
      seen.add(name);
      total.set(name, (total.get(name) ?? 0) + ms);
    }
  });
  return [...total]
    .map(([name, ms]) => ({ name, self: self.get(name) ?? 0, total: ms }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}
