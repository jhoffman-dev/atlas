import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { HISTORY_LIMIT, type NavigationPlace } from './navigation-history.ts';
import { MAX_PANES } from './pane-layout.ts';
import { parseRememberedWorkspace, rememberWorkspace } from './remember-workspace.ts';
import {
  CLOSED_LIMIT,
  closeTab,
  EMPTY_WORKSPACE,
  newTab,
  openInActiveTab,
  openInNewTab,
  openInSplit,
  pinTab,
  splitWithTab,
  type Workspace,
} from './workspace.ts';

/** Adversarial attack on PR #337: the remembered workspace, fuzzed. */

const VAULT = 'vault:willow-creek';

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function brokenInvariant(ws: Workspace): string | null {
  if (ws.panes.length < 1 || ws.panes.length > MAX_PANES) return `pane count ${ws.panes.length}`;
  if (!Number.isInteger(ws.focused) || ws.focused < 0 || ws.focused >= ws.panes.length) {
    return `focused ${ws.focused}`;
  }
  const ids: string[] = [];
  for (const pane of ws.panes) {
    if (pane.tabs.length === 0) return 'empty pane';
    if (!pane.tabs.some((tab) => tab.id === pane.active)) return 'active names no tab';
    const flags = pane.tabs.map((tab) => tab.pinned);
    if (flags.includes(false) && flags.lastIndexOf(true) > flags.indexOf(false)) return 'pin order';
    for (const tab of pane.tabs) {
      ids.push(tab.id);
      if (typeof tab.id !== 'string' || tab.id === '') return 'bad id';
      if (typeof tab.pinned !== 'boolean') return 'bad pinned';
      const { back, current, forward } = tab.history;
      if (!Array.isArray(back) || !Array.isArray(forward)) return 'bad history';
      if (back.length > HISTORY_LIMIT || forward.length > HISTORY_LIMIT)
        return 'history over limit';
      for (const place of [...back, ...forward, ...(current === null ? [] : [current])]) {
        if (place === null || typeof place !== 'object' || typeof place.kind !== 'string') {
          return 'bad place';
        }
        if (place.kind === 'note') {
          const path = place.path as string;
          if (
            path === '' ||
            path.startsWith('/') ||
            path.includes('\\') ||
            path.split('/').includes('..')
          ) {
            return `bad vault path ${path}`;
          }
        }
      }
    }
  }
  if (new Set(ids).size !== ids.length) return 'duplicate ids';
  if (!Number.isSafeInteger(ws.nextId) || ws.nextId < 1) return `nextId ${ws.nextId}`;
  if (ws.closed.length !== 0) return 'closed stack restored';
  return null;
}

/** A random JSON-ish value, biased towards the shapes the parser looks for. */
function randomValue(random: () => number, depth: number): unknown {
  const int = (max: number) => Math.floor(random() * max);
  const pick = <T>(from: readonly T[]): T => from[int(from.length)]!;
  const scalars: unknown[] = [
    null,
    true,
    false,
    0,
    -1,
    1,
    1.5,
    NaN,
    Infinity,
    -0,
    '',
    't1',
    't2',
    't01',
    't9007199254740993',
    '__proto__',
    'constructor',
    'note',
    'graph',
    'tags',
    'today',
    '../escape.md',
    '/abs.md',
    'C:\\win.md',
    'a\\b.md',
    './x.md',
    'ok.md',
    'nested/ok.md',
    'a\u0000b.md',
    'ünïcödé.md',
    1,
    2,
  ];
  if (depth <= 0 || random() < 0.3) return pick(scalars);
  if (random() < 0.35) {
    return Array.from({ length: int(5) }, () => randomValue(random, depth - 1));
  }
  const keys = [
    'version',
    'vault',
    'focused',
    'panes',
    'active',
    'tabs',
    'id',
    'pinned',
    'history',
    'back',
    'current',
    'forward',
    'kind',
    'path',
    'name',
    'scope',
    'depth',
    'tag',
    'paths',
    '__proto__',
    'constructor',
    'prototype',
  ];
  const record: Record<string, unknown> = {};
  for (let at = int(6); at > 0; at -= 1) {
    Object.defineProperty(record, pick(keys), {
      value: randomValue(random, depth - 1),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  if (random() < 0.6) record.vault = VAULT;
  if (random() < 0.5) record.version = pick([1, 1, 2, '1', 0]);
  return record;
}

function parseOrThrow(value: unknown): Workspace | null {
  // Through JSON too, so `__proto__` arrives as an own key the way storage hands it back.
  return parseRememberedWorkspace(JSON.parse(JSON.stringify(value) ?? 'null'), VAULT);
}

describe('attack-337: parseRememberedWorkspace under fuzz', () => {
  it('never throws, and returns null or a workspace that satisfies the invariants', () => {
    for (let seed = 1; seed <= 3000; seed += 1) {
      const random = seeded(seed);
      const value = randomValue(random, 6);
      let result: Workspace | null;
      try {
        result = parseOrThrow(value);
        const direct = parseRememberedWorkspace(value, VAULT);
        if (direct !== null) {
          const broken = brokenInvariant(direct);
          if (broken !== null) throw new Error(broken);
        }
      } catch (failure) {
        throw new Error(`seed ${seed}: threw ${String(failure)}`, { cause: failure });
      }
      if (result !== null) {
        const broken = brokenInvariant(result);
        if (broken !== null)
          throw new Error(`seed ${seed}: ${broken} from ${JSON.stringify(value)}`);
      }
    }
  });

  it('never throws on deeply nested input', () => {
    let deep: unknown = { kind: 'note', path: 'ok.md' };
    for (let at = 0; at < 5000; at += 1) deep = { current: deep, back: [deep] };
    const value = {
      version: 1,
      vault: VAULT,
      panes: [{ active: 't1', tabs: [{ id: 't1', history: deep }] }],
    };
    expect(() => parseRememberedWorkspace(value, VAULT)).not.toThrow();
  });

  it('a prototype-keyed record gains nothing on Object.prototype', () => {
    const raw = `{"version":1,"vault":"${VAULT}","__proto__":{"polluted":true},"panes":[{"active":"t1","tabs":[{"id":"t1","history":{"__proto__":{"current":{"kind":"today"}}}}]}]}`;
    const result = parseRememberedWorkspace(JSON.parse(raw), VAULT);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(result?.panes[0]!.tabs[0]!.history.current).toBeNull();
  });

  it('caps a huge history at HISTORY_LIMIT both ways', () => {
    const place = (at: number) => ({ kind: 'note', path: `n${at}.md` });
    const value = {
      version: 1,
      vault: VAULT,
      focused: 0,
      panes: [
        {
          active: 't1',
          tabs: [
            {
              id: 't1',
              pinned: false,
              history: {
                back: Array.from({ length: 10_000 }, (_, at) => place(at)),
                current: place(-1),
                forward: Array.from({ length: 10_000 }, (_, at) => place(at)),
              },
            },
          ],
        },
      ],
    };
    const tab = parseRememberedWorkspace(value, VAULT)!.panes[0]!.tabs[0]!;
    expect(tab.history.back).toHaveLength(HISTORY_LIMIT);
    expect(tab.history.forward).toHaveLength(HISTORY_LIMIT);
    expect(tab.history.back.at(-1)).toEqual(place(9999));
  });

  it('reads a huge tab count with duplicate ids as unique ids', () => {
    const tabs = Array.from({ length: 5000 }, (_, at) => ({ id: `t${at % 100}`, history: {} }));
    const ws = parseRememberedWorkspace(
      { version: 1, vault: VAULT, panes: [{ active: 't3', tabs }] },
      VAULT,
    )!;
    expect(ws.panes[0]!.tabs).toHaveLength(100);
    expect(brokenInvariant(ws)).toBeNull();
  });

  it.each(['../up.md', '/abs.md', 'a\\b.md', 'C:/x.md', 'a/../b.md', './a.md', 'a\u0000.md'])(
    'drops a note place on the invalid vault path %j',
    (path) => {
      const value = {
        version: 1,
        vault: VAULT,
        panes: [
          { active: 't1', tabs: [{ id: 't1', history: { current: { kind: 'note', path } } }] },
        ],
      };
      expect(
        parseRememberedWorkspace(value, VAULT)?.panes[0]!.tabs[0]!.history.current ?? null,
      ).toBeNull();
    },
  );

  it.each([
    ['a number id', { id: 1, history: {} }],
    ['a string history', { id: 't1', history: 'today' }],
    ['a numeric place kind', { id: 't1', history: { current: { kind: 1 } } }],
    ['a number path', { id: 't1', history: { current: { kind: 'note', path: 7 } } }],
  ])('treats %s as nothing usable', (_label, tab) => {
    const ws = parseRememberedWorkspace(
      { version: 1, vault: VAULT, panes: [{ active: 't1', tabs: [tab] }] },
      VAULT,
    );
    if (ws !== null) expect(ws.panes[0]!.tabs[0]!.history.current).toBeNull();
  });

  it('a wrong version reads as nothing remembered', () => {
    const good = rememberWorkspace({ workspace: EMPTY_WORKSPACE, vaultKey: VAULT });
    for (const version of [0, 2, '1', null, 1.0000001]) {
      expect(parseRememberedWorkspace({ ...good, version }, VAULT)).toBeNull();
    }
  });

  it('an active id that names nothing shows the first tab', () => {
    const value = {
      version: 1,
      vault: VAULT,
      panes: [
        {
          active: 'nowhere',
          tabs: [
            { id: 'tA', history: {} },
            { id: 'tB', history: {} },
          ],
        },
      ],
    };
    expect(parseRememberedWorkspace(value, VAULT)!.panes[0]!.active).toBe('tA');
  });

  it('a stored id at 2^53 does not let the next minted id repeat it', () => {
    const value = {
      version: 1,
      vault: VAULT,
      panes: [{ active: 't9007199254740992', tabs: [{ id: 't9007199254740992', history: {} }] }],
    };
    const ws = parseRememberedWorkspace(value, VAULT)!;
    expect(`t${ws.nextId}`).not.toBe('t9007199254740992');
    expect(Number.isSafeInteger(ws.nextId)).toBe(true);
  });

  it('a stored id with hundreds of digits leaves a finite nextId', () => {
    const id = `t${'9'.repeat(400)}`;
    const value = {
      version: 1,
      vault: VAULT,
      panes: [{ active: id, tabs: [{ id, history: {} }] }],
    };
    const ws = parseRememberedWorkspace(value, VAULT)!;
    expect(Number.isFinite(ws.nextId)).toBe(true);
  });

  it('after restoring a huge stored id, two new tabs get two different ids', () => {
    const id = `t${'9'.repeat(400)}`;
    const value = {
      version: 1,
      vault: VAULT,
      panes: [{ active: id, tabs: [{ id, history: {} }] }],
    };
    const ws = newTab(newTab(parseRememberedWorkspace(value, VAULT)!));
    const ids = ws.panes[0]!.tabs.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('attack-337: rememberWorkspace → parseRememberedWorkspace', () => {
  const notes = ['Barn', 'Silo', 'Meadow'].map((name) => createVaultPath(`farm/${name}.md`));
  const at = (index: number): NavigationPlace => ({ kind: 'note', path: notes[index]! });

  function sample(): Workspace {
    let ws = openInActiveTab(EMPTY_WORKSPACE, at(0));
    ws = openInActiveTab(ws, { kind: 'graph', scope: { kind: 'note', path: notes[1]!, depth: 2 } });
    ws = openInActiveTab(ws, { kind: 'tags', tag: null });
    ws = openInNewTab(ws, { kind: 'tags', tag: 'harvest' });
    ws = pinTab(ws, { pane: 0, id: ws.panes[0]!.active });
    ws = openInSplit(ws, { kind: 'type', name: 'task' });
    ws = openInNewTab(ws, at(2));
    return ws;
  }

  it('is identity on panes, focus and nextId for a valid workspace, through JSON', () => {
    const ws = sample();
    const back = parseRememberedWorkspace(
      JSON.parse(JSON.stringify(rememberWorkspace({ workspace: ws, vaultKey: VAULT }))),
      VAULT,
    );
    expect(back).toEqual({ ...ws, closed: [] });
  });

  it('keeps nextId past a tab that was minted then closed (no id reused after relaunch)', () => {
    let ws = newTab(sample());
    const lastMinted = ws.panes[ws.focused]!.active;
    ws = closeTab(ws, { pane: ws.focused, id: lastMinted });
    const back = parseRememberedWorkspace(
      JSON.parse(JSON.stringify(rememberWorkspace({ workspace: ws, vaultKey: VAULT }))),
      VAULT,
    )!;
    expect(back.nextId).toBe(ws.nextId);
  });

  it('does not persist the closed stack', () => {
    let ws = sample();
    ws = closeTab(ws, { pane: 1, id: ws.panes[1]!.active });
    expect(ws.closed.length).toBeGreaterThan(0);
    expect(ws.closed.length).toBeLessThanOrEqual(CLOSED_LIMIT);
    const stored = rememberWorkspace({ workspace: ws, vaultKey: VAULT });
    expect(JSON.stringify(stored)).not.toContain(ws.closed[0]!.id + '"');
    expect(parseRememberedWorkspace(stored, VAULT)!.closed).toEqual([]);
  });

  it('upgrades the old split to one tab per pane with valid invariants', () => {
    const ws = parseRememberedWorkspace(
      { vault: VAULT, paths: ['farm/Barn.md', '../bad.md', 'x.md'], focused: 1 },
      VAULT,
    )!;
    expect(brokenInvariant(ws)).toBeNull();
    expect(ws.panes).toHaveLength(2);
    expect(ws.focused).toBe(1);
    expect(ws.panes[0]!.tabs[0]!.history.current).toEqual(at(0));
    expect(ws.panes[1]!.tabs[0]!.history.current).toBeNull();
    expect(splitWithTab(ws)).toBe(ws);
  });
});
