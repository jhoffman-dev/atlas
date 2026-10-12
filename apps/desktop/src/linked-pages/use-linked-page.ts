import { useCallback, useEffect, useState } from 'react';
import {
  isLinkedPageType,
  type LinkedRange,
  type LinkedSectionId,
  type ObjectType,
} from '@atlas/domain';
import {
  readLinkedPage,
  type Clock,
  type IndexPort,
  type LinkedRangeStore,
  type LinkedSection,
} from '@atlas/application';

/** A page's linked sections, and the way to turn one between recent and all. */
export interface LinkedPage {
  /** Null until they have been read once for this page. */
  readonly sections: readonly LinkedSection[] | null;
  readonly setRange: (section: LinkedSectionId, range: LinkedRange) => void;
}

/** The sections read, and the page they were read for. */
interface Read {
  readonly notePath: string;
  readonly sections: readonly LinkedSection[];
}

/**
 * A linked page's sections (P30-06) for the note a pane holds: read from the
 * index whenever the page, its type, a section's range or `revision` — the
 * index's count of changes — moves, so a meeting arriving or a task ticked
 * anywhere reaches them. What was last read stays up while it is read again;
 * another page's sections are never shown in its place. Null where the note
 * is no linked page.
 */
export function useLinkedPage({
  index,
  clock,
  store,
  types,
  notePaths,
  notePath,
  typeName,
  revision,
}: {
  index: IndexPort;
  clock: Pick<Clock, 'today'>;
  store: LinkedRangeStore;
  types: readonly ObjectType[];
  notePaths: readonly string[];
  /** The note the pane holds; null for none, or one that is not a page of its type (a template). */
  notePath: string | null;
  typeName: string | null;
  revision: string;
}): LinkedPage | null {
  const pageType = typeName !== null && isLinkedPageType(typeName) ? typeName : null;
  const [read, setRead] = useState<Read | null>(null);
  // Counts the ranges changed, so a section turned to All is read again.
  const [turned, setTurned] = useState(0);

  useEffect(() => {
    if (notePath === null || pageType === null) return;
    let cancelled = false;
    readLinkedPage({
      index,
      clock,
      types,
      notePaths,
      notePath,
      typeName: pageType,
      ranges: store.read(pageType),
    })
      .then((sections) => {
        if (!cancelled) setRead({ notePath, sections });
      })
      .catch(() => {
        // Safe to ignore: each section reports its own unanswerable query; what
        // is left is a failure to reach the index at all, which the app's index
        // status already says, and the sections stay as they were last read.
      });
    return () => {
      cancelled = true;
    };
  }, [index, clock, store, types, notePaths, notePath, pageType, revision, turned]);

  const setRange = useCallback(
    (section: LinkedSectionId, range: LinkedRange) => {
      if (pageType === null) return;
      store.write(pageType, section, range);
      setTurned((count) => count + 1);
    },
    [store, pageType],
  );

  if (notePath === null || pageType === null) return null;
  return { sections: read?.notePath === notePath ? read.sections : null, setRange };
}
