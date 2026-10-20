import {
  WAITING_STATUS,
  type Clarification,
  type GtdStatus,
  type InboxItem,
  type InboxTask,
  type VaultPath,
} from '@atlas/domain';

/**
 * What a task's row holds before Done writes it (#112): only what was picked.
 * A date picked and then emptied is '' — the row asking for it to be cleared.
 */
export interface InboxDraft {
  readonly status?: GtdStatus;
  readonly project?: VaultPath;
  readonly waitingOn?: VaultPath;
  readonly defer?: string;
  readonly due?: string;
}

/** A date the row holds, as the change to make: none when it is what the task says already. */
function dayChange(picked: string | undefined, held: string | null): string | null | undefined {
  if (picked === undefined || picked === (held ?? '')) return undefined;
  return picked === '' ? null : picked;
}

/**
 * The row's picks as one clarification — only what differs from what the task
 * says — or null when Done would change nothing.
 */
export function clarificationOf(task: InboxTask, draft: InboxDraft): Clarification | null {
  const defer = dayChange(draft.defer, task.defer);
  const due = dayChange(draft.due, task.due);
  const clarification: Clarification = {
    ...(draft.status !== undefined && draft.status !== task.status && { status: draft.status }),
    ...(draft.project !== undefined &&
      draft.project !== task.project && { project: draft.project }),
    // A person picked while the row said Waiting is not written once it no longer asks who.
    ...(asksWhoItWaitsOn(task, draft) &&
      draft.waitingOn !== undefined &&
      draft.waitingOn !== task.waitingOn && { waitingOn: draft.waitingOn }),
    ...(defer !== undefined && { defer }),
    ...(due !== undefined && { due }),
  };
  return Object.keys(clarification).length === 0 ? null : clarification;
}

/** Whether the row asks who the task waits on: it is, or is being made, Waiting. */
export function asksWhoItWaitsOn(task: InboxTask, draft: InboxDraft): boolean {
  return (draft.status ?? task.status) === WAITING_STATUS;
}

/**
 * The row focus goes to once the one at `path` is dealt with: the one after
 * it, the one before when it was last, null when it was the only one.
 */
export function rowAfter(items: readonly InboxItem[], path: VaultPath): VaultPath | null {
  const at = items.findIndex((item) => item.path === path);
  if (at === -1) return items[0]?.path ?? null;
  return (items[at + 1] ?? items[at - 1])?.path ?? null;
}

/**
 * The row focus goes to once the one at `path` has left the list — the rows
 * `before` it left, `after` — passing over any that left with it.
 */
export function rowAfterLeaving(
  before: readonly InboxItem[],
  after: readonly InboxItem[],
  path: VaultPath,
): VaultPath | null {
  const listed = new Set(after.map((item) => item.path));
  return rowAfter(
    before.filter((item) => item.path === path || listed.has(item.path)),
    path,
  );
}
