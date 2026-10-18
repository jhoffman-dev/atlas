import type { GraphScope } from '../graph/graph-scope.ts';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import {
  HISTORY_LIMIT,
  type NavigationHistory,
  type NavigationPlace,
} from './navigation-history.ts';
import { MAX_PANES, parseRememberedPanes } from './pane-layout.ts';
import type { Pane, Tab, Workspace } from './workspace.ts';

/**
 * The workspace as it goes into storage and comes back (tab-model.md §2).
 *
 * Versioned, so a later shape can tell this one apart; it holds places only,
 * each validated on read, since storage is hand-editable and a stale or
 * malformed entry should cost one tab rather than the window. A place has no
 * field a secret could sit in (ADR-0017), so nothing here needs scrubbing.
 */
export const WORKSPACE_FORMAT_VERSION = 1;

export interface RememberedWorkspace {
  readonly version: typeof WORKSPACE_FORMAT_VERSION;
  readonly vault: string;
  readonly focused: number;
  readonly panes: readonly {
    readonly active: string;
    readonly tabs: readonly {
      readonly id: string;
      readonly pinned: boolean;
      readonly history: NavigationHistory;
    }[];
  }[];
}

/** The workspace as it goes into storage, against the vault it belongs to. */
export function rememberWorkspace({
  workspace,
  vaultKey,
}: {
  workspace: Workspace;
  vaultKey: string;
}): RememberedWorkspace {
  return {
    version: WORKSPACE_FORMAT_VERSION,
    vault: vaultKey,
    focused: workspace.focused,
    panes: workspace.panes.map((pane) => ({
      active: pane.active,
      tabs: pane.tabs.map(({ id, pinned, history }) => ({ id, pinned, history })),
    })),
  };
}

/**
 * The workspace remembered for a vault, out of whatever was stored.
 *
 * Only for the vault it was remembered against: the paths are relative to a
 * vault, and restoring one vault's tabs into another would open them on notes
 * that are not there. The unversioned `{ vault, paths, focused }` the split
 * was stored as before tabs upgrades to one tab per pane. Anything else
 * unrecognised reads as nothing remembered, and a bad tab or pane is dropped,
 * because the layout is a convenience and a stale one should cost a tab
 * rather than an error.
 */
export function parseRememberedWorkspace(remembered: unknown, vaultKey: string): Workspace | null {
  if (!isRecord(remembered) || remembered.vault !== vaultKey) return null;
  if (!('version' in remembered)) return upgradeSplit(remembered, vaultKey);
  if (remembered.version !== WORKSPACE_FORMAT_VERSION || !Array.isArray(remembered.panes)) {
    return null;
  }
  const seen = new Set<string>();
  const panes = remembered.panes
    .map((pane) => readPane(pane, seen))
    .filter((pane): pane is Pane => pane !== null)
    .slice(0, MAX_PANES);
  if (panes.length === 0) return null;
  const focused = remembered.focused;
  return {
    panes,
    focused:
      typeof focused === 'number' &&
      Number.isInteger(focused) &&
      focused >= 0 &&
      focused < panes.length
        ? focused
        : 0,
    nextId: nextIdAfter(seen),
    closed: [],
  };
}

/** The old split, as one tab per pane on the note the pane held. */
function upgradeSplit(remembered: unknown, vaultKey: string): Workspace | null {
  const layout = parseRememberedPanes(remembered, vaultKey);
  if (layout === null) return null;
  const panes = layout.paths.map((path, index): Pane => {
    const id = `t${index + 1}`;
    const current: NavigationPlace | null = path === null ? null : { kind: 'note', path };
    return {
      tabs: [{ id, pinned: false, history: { back: [], current, forward: [] } }],
      active: id,
    };
  });
  return { panes, focused: layout.focused, nextId: panes.length + 1, closed: [] };
}

function readPane(value: unknown, seen: Set<string>): Pane | null {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return null;
  const read = value.tabs
    .map((tab) => readTab(tab, seen))
    .filter((tab): tab is Tab => tab !== null);
  if (read.length === 0) return null;
  const tabs = [...read.filter((tab) => tab.pinned), ...read.filter((tab) => !tab.pinned)];
  const active = tabs.some((tab) => tab.id === value.active)
    ? (value.active as string)
    : (tabs[0] as Tab).id;
  return { tabs, active };
}

function readTab(value: unknown, seen: Set<string>): Tab | null {
  if (!isRecord(value)) return null;
  const { id, pinned, history } = value;
  if (typeof id !== 'string' || id === '' || seen.has(id) || !isRecord(history)) return null;
  seen.add(id);
  return { id, pinned: pinned === true, history: readHistory(history) };
}

function readHistory(value: Record<string, unknown>): NavigationHistory {
  const places = (held: unknown) =>
    Array.isArray(held)
      ? held.map(readPlace).filter((place): place is NavigationPlace => place !== null)
      : [];
  return {
    back: places(value.back).slice(-HISTORY_LIMIT),
    current: readPlace(value.current),
    forward: places(value.forward).slice(0, HISTORY_LIMIT),
  };
}

/** A place that came back from storage, rebuilt field by field, or null if it is not one. */
function readPlace(value: unknown): NavigationPlace | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case 'note': {
      const path = readPath(value.path);
      return path === null ? null : { kind: 'note', path };
    }
    case 'type':
      return typeof value.name === 'string' && value.name !== ''
        ? { kind: 'type', name: value.name }
        : null;
    case 'graph': {
      const scope = readScope(value.scope);
      return scope === null ? null : { kind: 'graph', scope };
    }
    case 'tags':
      return typeof value.tag === 'string' || value.tag === null
        ? { kind: 'tags', tag: value.tag }
        : null;
    case 'query':
    case 'archive':
    case 'inbox':
    case 'review':
    case 'today':
    case 'automations':
    case 'activity':
    case 'templates':
    case 'terms':
      return { kind: value.kind };
    default:
      return null;
  }
}

function readScope(value: unknown): GraphScope | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'vault') return { kind: 'vault' };
  if (value.kind !== 'note' || (value.depth !== 1 && value.depth !== 2)) return null;
  const path = readPath(value.path);
  return path === null ? null : { kind: 'note', path, depth: value.depth };
}

function readPath(value: unknown): VaultPath | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    return createVaultPath(value);
  } catch {
    // A hand-edited or stale path that no longer parses costs the place it
    // sat in, which is what a deleted note costs anyway.
    return null;
  }
}

/** One past the highest id of this module's own making; other ids are left alone. */
function nextIdAfter(ids: ReadonlySet<string>): number {
  let highest = 0;
  for (const id of ids) {
    const match = /^t(\d+)$/.exec(id);
    if (match !== null) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
