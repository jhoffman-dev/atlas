import { createStore, type StoreApi } from 'zustand';
import { createVaultPath, type DuplicatePair, type VaultPath } from '@atlas/domain';
import {
  applyPeopleMerge,
  dismissPossibleDuplicate,
  loadPeople,
  loadPossibleDuplicates,
  peopleMergeSummary,
  previewPeopleMerge,
  type ActivityLog,
  type MergePorts,
  type PeopleMergePreview,
  type PeopleMergeRequest,
  type SettingsWriter,
} from '@atlas/application';
import type { MergePersonChoice } from '@atlas/ui';
import type { Overlay } from '../overlay.ts';
import type { Toasts } from '../toasts/toasts.ts';
import { personChoice } from './people-merge-views.ts';

/** Where a merge is: picking who to keep, being worked out, asked about, being made, or refused. */
export type MergeFlow =
  | {
      readonly kind: 'picking';
      /** The people to merge, whose page or rows asked: the one kept is picked from everyone else. */
      readonly subjects: readonly VaultPath[];
      readonly choices: readonly MergePersonChoice[];
    }
  | { readonly kind: 'checking'; readonly request: PeopleMergeRequest }
  | { readonly kind: 'previewed'; readonly preview: PeopleMergePreview }
  | { readonly kind: 'merging'; readonly preview: PeopleMergePreview }
  | { readonly kind: 'refused'; readonly message: string };

/** The list of people who may be one: being read, read, or not readable. */
export type DuplicatesFlow =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly pairs: readonly DuplicatePair[] }
  | { readonly kind: 'failed'; readonly message: string };

export interface PeopleMergeState {
  readonly merge: MergeFlow | null;
  /** Whether the merge was asked for from the list, which offers to keep the other one and comes back to the list. */
  readonly fromList: boolean;
  readonly duplicates: DuplicatesFlow;
  /** The people chosen in a People table now, for ⌘K's "Merge selected people…". */
  readonly chosen: readonly VaultPath[];
}

export type PeopleMergeStore = StoreApi<PeopleMergeState>;

export function createPeopleMergeStore(): PeopleMergeStore {
  return createStore<PeopleMergeState>()(() => ({
    merge: null,
    fromList: false,
    duplicates: { kind: 'loading' },
    chosen: [],
  }));
}

/** What the merge commands read at the moment they run: the vault open now, and the window's own. */
export interface PeopleMergeDeps {
  readonly ports: MergePorts;
  readonly settings: SettingsWriter;
  readonly notePaths: readonly VaultPath[];
  readonly overlay: { show(overlay: Overlay): void; hide(overlay: Overlay): void };
  readonly toasts: Pick<Toasts, 'show'>;
  readonly activity: Pick<ActivityLog, 'record'>;
  /** Re-reads the index after the merge wrote notes. */
  readonly onChanged: () => void;
  /** Lets go of the panes showing people who went to the Trash. */
  readonly closeNotes: (paths: readonly VaultPath[]) => void;
  readonly openActivity: () => void;
}

/** Why ⌘K's "Merge selected people…" has no one to merge. */
const NOTHING_CHOSEN =
  'No people are selected. Tick the people to merge in the Person table, or a People view with Select on, then try again.';

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** The merge's commands: steady for the store's life, reading `deps()` when they run. */
export interface PeopleMergeCommands {
  /** "Merge into…" on a person's page: asks who to keep. */
  mergeInto(subject: VaultPath): void;
  /** "Merge…" on rows chosen in a People table: asks who to merge them all into. */
  mergeMany(subjects: readonly VaultPath[]): void;
  /** Says which people a People table has chosen now; none when it lets go. */
  noteChosen(paths: readonly VaultPath[]): void;
  /** ⌘K's "Merge selected people…": the people chosen now, or why there are none. */
  mergeChosen(): void;
  pick(keep: string): void;
  /** From the list: merges a pair, keeping its first person until swapped. */
  mergePair(key: string): void;
  swap(): void;
  confirm(): void;
  closeMerge(): void;
  findDuplicates(): void;
  dismiss(key: string): void;
  closeDuplicates(): void;
}

export function peopleMergeCommands(
  store: PeopleMergeStore,
  deps: () => PeopleMergeDeps,
): PeopleMergeCommands {
  const set = (merge: MergeFlow | null) => store.setState({ merge });
  const preview = (request: PeopleMergeRequest) => {
    set({ kind: 'checking', request });
    const { ports, notePaths } = deps();
    previewPeopleMerge({ ports, request, notePaths })
      .then((shown) => {
        if (!isChecking(store, request)) return;
        set(
          shown.refusal === null
            ? { kind: 'previewed', preview: shown }
            : { kind: 'refused', message: shown.refusal },
        );
      })
      .catch((cause: unknown) => {
        if (isChecking(store, request)) set({ kind: 'refused', message: message(cause) });
      });
  };
  const loadList = () => {
    store.setState({ duplicates: { kind: 'loading' } });
    loadPossibleDuplicates(deps().ports)
      .then((pairs) => store.setState({ duplicates: { kind: 'ready', pairs } }))
      .catch((cause: unknown) =>
        store.setState({ duplicates: { kind: 'failed', message: message(cause) } }),
      );
  };
  const backToList = () => {
    if (!store.getState().fromList) return;
    deps().overlay.show('people-duplicates');
    loadList();
  };
  /** Opens the merge on `subjects`, asking which other person to merge them all into. */
  const askWhoToKeep = (subjects: readonly VaultPath[]) => {
    const merging = [...new Set(subjects)];
    store.setState({ fromList: false });
    set({ kind: 'checking', request: { keep: merging[0]!, merge: [] } });
    deps().overlay.show('merge-people');
    loadPeople({ index: deps().ports.index })
      .then((people) => {
        const choices = people
          .map((person) => person.path)
          .filter((path) => !merging.includes(path))
          .map(personChoice)
          .sort((a, b) => a.name.localeCompare(b.name));
        set({ kind: 'picking', subjects: merging, choices });
      })
      .catch((cause: unknown) => set({ kind: 'refused', message: message(cause) }));
  };
  return {
    mergeInto(subject) {
      askWhoToKeep([subject]);
    },
    mergeMany(subjects) {
      askWhoToKeep(subjects);
    },
    noteChosen(paths) {
      store.setState({ chosen: [...paths] });
    },
    mergeChosen() {
      const { chosen } = store.getState();
      if (chosen.length > 0) {
        askWhoToKeep(chosen);
        return;
      }
      store.setState({ fromList: false });
      set({ kind: 'refused', message: NOTHING_CHOSEN });
      deps().overlay.show('merge-people');
    },
    pick(keep) {
      const flow = store.getState().merge;
      if (flow?.kind !== 'picking') return;
      const kept = createVaultPath(keep);
      preview({ keep: kept, merge: flow.subjects.filter((path) => path !== kept) });
    },
    mergePair(key) {
      const { duplicates } = store.getState();
      const pair =
        duplicates.kind === 'ready' ? duplicates.pairs.find((each) => each.key === key) : undefined;
      if (pair === undefined) return;
      store.setState({ fromList: true });
      // One dialog holds the screen at a time: the list gives way to the question.
      deps().overlay.hide('people-duplicates');
      deps().overlay.show('merge-people');
      preview({ keep: pair.left.path, merge: [pair.right.path] });
    },
    swap() {
      const flow = store.getState().merge;
      if (flow?.kind !== 'previewed' || flow.preview.merge.length !== 1) return;
      preview({ keep: flow.preview.merge[0]!, merge: [flow.preview.keep] });
    },
    confirm() {
      const flow = store.getState().merge;
      if (flow?.kind !== 'previewed') return;
      set({ kind: 'merging', preview: flow.preview });
      void merge(flow.preview);
    },
    closeMerge() {
      if (store.getState().merge?.kind === 'merging') return;
      set(null);
      deps().overlay.hide('merge-people');
      backToList();
    },
    findDuplicates() {
      deps().overlay.show('people-duplicates');
      loadList();
    },
    dismiss(key) {
      const { duplicates } = store.getState();
      if (duplicates.kind !== 'ready') return;
      const pair = duplicates.pairs.find((each) => each.key === key);
      if (pair === undefined) return;
      store.setState({
        duplicates: { kind: 'ready', pairs: duplicates.pairs.filter((each) => each !== pair) },
      });
      const { ports, settings } = deps();
      dismissPossibleDuplicate({
        ports,
        settings,
        pair: { left: pair.left.path, right: pair.right.path },
      }).catch((cause: unknown) => {
        store.setState({
          duplicates: { kind: 'failed', message: `Not remembered: ${message(cause)}` },
        });
      });
    },
    closeDuplicates() {
      deps().overlay.hide('people-duplicates');
    },
  };

  async function merge(shown: PeopleMergePreview) {
    const { ports, toasts, activity, onChanged, closeNotes, openActivity, overlay } = deps();
    try {
      const report = await applyPeopleMerge({ ports, preview: shown });
      closeNotes(report.trashed);
      const words = peopleMergeSummary(report);
      const ok = report.failures.length === 0;
      // A warning toast is kept in Activity by the toasts' host; a merge that went through is kept here.
      if (ok)
        activity.record({
          level: 'info',
          kind: 'save',
          message: words,
          subject: { kind: 'note', path: report.keep },
        });
      toasts.show({
        message: words,
        tone: ok ? 'change' : 'warning',
        action: { label: 'Activity', onClick: openActivity },
      });
      onChanged();
      set(null);
      overlay.hide('merge-people');
      backToList();
    } catch (cause) {
      set({ kind: 'refused', message: message(cause) });
    }
  }
}

function isChecking(store: PeopleMergeStore, request: PeopleMergeRequest): boolean {
  const flow = store.getState().merge;
  return flow?.kind === 'checking' && flow.request === request;
}
