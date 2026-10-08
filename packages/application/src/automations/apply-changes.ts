import {
  KeyAsWritten,
  messageWithoutPaths,
  stillAsLeft,
  type DoneAction,
  type PassedOver,
  type PriorValue,
  type VaultPath,
} from '@atlas/domain';
import type { ArchivePorts } from '../archive/archive-notes.ts';
import { setNoteProperties } from '../query/set-property.ts';
import { VaultChangedError } from './vault-guard.ts';

/** What changing notes' properties did: each change made, and each note left alone. */
export interface PropertyOutcome {
  readonly done: readonly DoneAction[];
  readonly left: readonly PassedOver[];
}

/** One property to change on one note, from what it was left at to what it is to be. */
export interface PropertyChange {
  readonly path: VaultPath;
  readonly key: string;
  /** Only change it while it still holds this; null to change it whatever it holds. */
  readonly expect: PriorValue | null;
  readonly to: PriorValue;
}

export const UNSAVED_TYPING = 'It is open in Atlas with unsaved typing, so it was left as it is.';

/**
 * Changes properties note by note, recording exactly what each held before so
 * it can be put back. A note with unsaved typing in a pane is never written —
 * the automation is not the person, and must not save what they are typing.
 * A change whose note has moved on from what was expected is left, and said so.
 */
export async function changeProperties({
  ports,
  changes,
  kind,
  today,
}: {
  ports: Pick<ArchivePorts, 'fs' | 'markdown' | 'editors'>;
  changes: readonly PropertyChange[];
  kind: 'set' | 'restored';
  /** `YYYY-MM-DD`, the run's day: a task a rule finishes is dated by it (ADR-0029). */
  today: string;
}): Promise<PropertyOutcome> {
  const done: DoneAction[] = [];
  const left: PassedOver[] = [];
  for (const [path, ofNote] of groupByNote(changes)) {
    if (ports.editors.state(path) === 'dirty') {
      left.push({ path, reason: UNSAVED_TYPING });
      continue;
    }
    try {
      const outcome = await changeNote({ ports, path, changes: ofNote, kind, today });
      done.push(...outcome.done);
      left.push(...outcome.left);
    } catch (cause) {
      // The reason is kept in the rule's log, which any tool can read.
      left.push({ path, reason: messageWithoutPaths(cause) });
      // Another vault is open: every note after this one would be refused the same way.
      if (cause instanceof VaultChangedError) break;
    }
  }
  return { done, left };
}

const PLAIN_KEY = /^[\p{L}_][\p{L}\p{N}_-]*(?: [\p{L}\p{N}_-]+)*$/u;

/**
 * What puts a property back as it was. A key that was there with nothing in
 * it (`status:`) goes back as that key, empty — writing null would take it
 * out, and the log would claim a restore that did not happen.
 */
function restoredValue(key: string, to: PriorValue): unknown {
  if ('absent' in to) return null;
  if (to.value !== null) return to.value;
  return new KeyAsWritten(`${PLAIN_KEY.test(key) ? key : JSON.stringify(key)}:\n`);
}

function groupByNote(changes: readonly PropertyChange[]): Map<VaultPath, PropertyChange[]> {
  const byNote = new Map<VaultPath, PropertyChange[]>();
  for (const change of changes)
    byNote.set(change.path, [...(byNote.get(change.path) ?? []), change]);
  return byNote;
}

/** One note's changes, in one write, deciding each against what the file holds as it is written. */
async function changeNote({
  ports,
  path,
  changes,
  kind,
  today,
}: {
  ports: Pick<ArchivePorts, 'fs' | 'markdown' | 'editors'>;
  path: VaultPath;
  changes: readonly PropertyChange[];
  kind: 'set' | 'restored';
  today: string;
}): Promise<PropertyOutcome> {
  const done: DoneAction[] = [];
  const left: PassedOver[] = [];
  // Held to the task rules as any write is: one the rules refuse is left, its reason in the log.
  await setNoteProperties({
    fs: ports.fs,
    markdown: ports.markdown,
    path,
    today,
    values: (properties) => {
      const written: Record<string, unknown> = {};
      for (const change of changes) {
        const before = priorOf(properties, change.key);
        if (change.expect !== null && !stillAsLeft(before, change.expect)) {
          left.push({
            path,
            reason: `Its ${change.key} has changed since, so it was left as it is.`,
          });
          continue;
        }
        if (stillAsLeft(before, change.to)) continue;
        written[change.key] = restoredValue(change.key, change.to);
        done.push({ kind, path, key: change.key, before, after: change.to });
      }
      return written;
    },
  });
  if (done.length > 0 && ports.editors.state(path) === 'clean') ports.editors.reload(path);
  return { done, left };
}

function priorOf(properties: Readonly<Record<string, unknown>>, key: string): PriorValue {
  return Object.hasOwn(properties, key) ? { value: properties[key] } : { absent: true };
}
