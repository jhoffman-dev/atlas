import { createStore, type StoreApi } from 'zustand';
import type { VaultPath } from '@atlas/domain';
import type { AcceptedProposal } from '@atlas/application';
import type { ProposalNotice } from '@atlas/ui';
import { createAnswerQueue, type AnswerQueue } from './answer-queue.ts';

/** What the last answer left to say, and the accepts it offers to take back. */
export interface ProposalsSaid {
  readonly notice: ProposalNotice;
  readonly undo: readonly AcceptedProposal[];
}

/** What every Inbox tab's Proposals section draws from. */
export interface ProposalWritesState {
  /** The proposals answered since the list was last read: taken off it at once, given back should the answer fail. */
  readonly answered: ReadonlySet<VaultPath>;
  readonly said: ProposalsSaid | null;
  /** One more each time the queue drains, so the list is read again after it. */
  readonly drained: number;
}

/**
 * The Proposals' answers in flight, held by the window for the vault rather
 * than by the tab that gave them (tab-model.md, PR B): one queue whichever
 * tab answers (#166), and every tab sees an answered proposal as gone and
 * keeps the last answer's undo. The hook reads the store by selector.
 */
export interface ProposalWrites {
  readonly store: StoreApi<ProposalWritesState>;
  readonly queue: AnswerQueue;
  /** What the tab showing the section does once the queue drains: set by the hook as it renders. */
  readonly held: { onDrained: () => void };
}

export function createProposalWrites(): ProposalWrites {
  const held = { onDrained: () => {} };
  const store = createStore<ProposalWritesState>()(() => ({
    answered: new Set<VaultPath>(),
    said: null,
    drained: 0,
  }));
  return {
    store,
    queue: createAnswerQueue(() => {
      held.onDrained();
      store.setState((state) => ({ drained: state.drained + 1 }));
    }),
    held,
  };
}
