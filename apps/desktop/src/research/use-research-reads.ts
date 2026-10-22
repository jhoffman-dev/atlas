import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HighlightChoices, HighlightEntry, LibraryChoices, LibraryEntry } from '@dfai/domain';
import {
  HIGHLIGHTS_SCOPE,
  LIBRARY_SCOPE,
  readHighlights,
  readLibrary,
  refreshHighlights,
  refreshLibrary,
  type HighlightsRead,
  type IndexPort,
  type LibraryRead,
} from '@dfai/application';
import { scopedReadKey, scopedReadMeta } from '../reads/query-client.ts';
import { readState, type ReadState } from '../reads/read-state.ts';

/** What a research list reads through: the index, once it is ready, of the open vault. */
export interface ResearchReadPorts {
  readonly index: Pick<IndexPort, 'query'>;
  readonly vault: string | null;
  readonly ready: boolean;
}

/** What a page lists: the rows, and what its filters offer of them, read together and kept. */
export interface LibraryList {
  readonly entries: readonly LibraryEntry[];
  readonly choices: LibraryChoices;
}

export interface HighlightList {
  readonly entries: readonly HighlightEntry[];
  readonly choices: HighlightChoices;
}

/**
 * Every literature note, read once and kept (ADR-0040) until the index has
 * news of one, or of a project they are filed under (`LIBRARY_SCOPE`).
 */
export function useLibraryRead({ index, vault, ready }: ResearchReadPorts): ReadState<LibraryList> {
  const { data, error } = useQuery({
    queryKey: scopedReadKey(vault ?? '', 'library'),
    queryFn: () => readLibrary({ index }),
    meta: scopedReadMeta(LIBRARY_SCOPE, false, (previous: LibraryRead, changes) =>
      refreshLibrary({ index, previous, changes }),
    ),
    enabled: ready && vault !== null,
  });
  return useMemo(
    () =>
      readState({ data, error }, 'The Library could not be read', ({ entries, choices }) => ({
        entries,
        choices,
      })),
    [data, error],
  );
}

/** Every highlight, read once and kept until the index has news of a literature note (`HIGHLIGHTS_SCOPE`). */
export function useHighlightsRead({
  index,
  vault,
  ready,
}: ResearchReadPorts): ReadState<HighlightList> {
  const { data, error } = useQuery({
    queryKey: scopedReadKey(vault ?? '', 'all-highlights'),
    queryFn: () => readHighlights({ index }),
    meta: scopedReadMeta(HIGHLIGHTS_SCOPE, false, (previous: HighlightsRead, changes) =>
      refreshHighlights({ index, previous, changes }),
    ),
    enabled: ready && vault !== null,
  });
  return useMemo(
    () =>
      readState({ data, error }, 'The highlights could not be read', ({ entries, choices }) => ({
        entries,
        choices,
      })),
    [data, error],
  );
}
