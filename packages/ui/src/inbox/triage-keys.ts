import {
  GTD_STATUS_LABELS,
  TRIAGE_KEYS,
  triageActionOf,
  type GtdStatus,
  type TriageAction,
  type TriageKey,
} from '@dfai/domain';

/** A key as the focused row draws it: its letter, its action and the word beside the letter. */
export interface TriageKeyShown extends TriageKey {
  readonly label: string;
  /** The status it writes, for the tint the button takes; null for a picker. */
  readonly status: GtdStatus | null;
}

/** Shorter than the status labels where the row is dense: "Next", not "Next Action"; "Done", not "Archive". */
const SHORT: Partial<Record<GtdStatus, string>> = { 'next-action': 'Next', archive: 'Done' };

function labelOf(action: TriageAction): string {
  if (action.kind === 'status') return SHORT[action.status] ?? GTD_STATUS_LABELS[action.status];
  return action.field === 'project' ? 'Project' : 'Schedule';
}

/** The keys a row offers in this vault: every triage key whose status its Task type declares. */
export function triageKeysShown(statuses: readonly GtdStatus[]): readonly TriageKeyShown[] {
  return TRIAGE_KEYS.flatMap((each) => {
    const action = triageActionOf(each.key, statuses);
    if (action === null) return [];
    return [
      { ...each, label: labelOf(action), status: action.kind === 'status' ? action.status : null },
    ];
  });
}
