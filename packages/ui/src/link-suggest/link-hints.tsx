import { createContext, useContext } from 'react';
import { NO_LINK_HINTS, type LinkHints } from '@dfai/domain';
import type { RelationChoice } from '../properties-panel.tsx';

/**
 * What a link field's suggestions know beyond the notes it was handed (#465):
 * each note's aliases and how much it is linked, and every note, for `[[` in
 * a plain text field. Read by the app only once a picker asks — `want` —
 * and again on the next opening once the index has changed.
 */
export interface LinkHintsSource {
  readonly hints: LinkHints;
  /** Every note a link may be offered to; null until read. */
  readonly notes: readonly RelationChoice[] | null;
  /** Why they could not be read, or null. */
  readonly problem: string | null;
  /** A picker opened: read them, unless already read from the index as it is. */
  readonly want: () => void;
}

const NOTHING_KNOWN: LinkHintsSource = {
  hints: NO_LINK_HINTS,
  notes: null,
  problem: null,
  want: () => {},
};

const LinkHintsContext = createContext<LinkHintsSource>(NOTHING_KNOWN);

/** Given by the app; without it, suggestions rank by title alone. */
export const LinkHintsProvider = LinkHintsContext.Provider;

/** Only an open picker reads this, so a read landing draws no closed one again. */
export function useLinkHints(): LinkHintsSource {
  return useContext(LinkHintsContext);
}
