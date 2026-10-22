import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HighlightEntry, LibraryEntry } from '@dfai/domain';
import {
  HIGHLIGHTS_SCOPE,
  LIBRARY_SCOPE,
  loadAllHighlights,
  loadLibrary,
  type IndexPort,
} from '@dfai/application';
import { scopedReadKey, scopedReadMeta } from '../reads/query-client.ts';
import { readState, type ReadState } from '../reads/read-state.ts';

/** What a research list reads through: the index, once it is ready, of the open vault. */
export interface ResearchReadPorts {
  readonly index: Pick<IndexPort, 'query'>;
  readonly vault: string | null;
  readonly ready: boolean;
}

/**
 * Every literature note, read once and kept (ADR-0040) until the index has
 * news of one, or of a project they are filed under (`LIBRARY_SCOPE`).
 */
export function useLibraryRead({
  index,
  vault,
  ready,
}: ResearchReadPorts): ReadState<{ readonly entries: readonly LibraryEntry[] }> {
  const { data, error } = useQuery({
    queryKey: scopedReadKey(vault ?? '', 'library'),
    queryFn: () => loadLibrary({ index }),
    meta: scopedReadMeta(LIBRARY_SCOPE),
    enabled: ready && vault !== null,
  });
  return useMemo(
    () => readState({ data, error }, 'The Library could not be read', (entries) => ({ entries })),
    [data, error],
  );
}

/** Every highlight, read once and kept until the index has news of a literature note (`HIGHLIGHTS_SCOPE`). */
export function useHighlightsRead({
  index,
  vault,
  ready,
}: ResearchReadPorts): ReadState<{ readonly entries: readonly HighlightEntry[] }> {
  const { data, error } = useQuery({
    queryKey: scopedReadKey(vault ?? '', 'all-highlights'),
    queryFn: () => loadAllHighlights({ index }),
    meta: scopedReadMeta(HIGHLIGHTS_SCOPE),
    enabled: ready && vault !== null,
  });
  return useMemo(
    () =>
      readState({ data, error }, 'The highlights could not be read', (entries) => ({ entries })),
    [data, error],
  );
}
