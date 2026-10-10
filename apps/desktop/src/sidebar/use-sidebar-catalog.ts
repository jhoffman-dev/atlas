import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { objectTypeIcon, type ObjectType, type QuickView, type QuickViewId } from '@atlas/domain';
import {
  countNotesByType,
  countQuickViews,
  loadSidebarCatalog,
  type IndexPort,
  type MarkdownPort,
  type SidebarCatalog,
  type VaultFsPort,
} from '@atlas/application';
import type { SidebarQuickView, SidebarType } from '@atlas/ui';

const NOTHING: SidebarCatalog = {
  views: [],
  dashboards: [],
  favorites: [],
  quick: [],
  savedViews: [],
  queryViews: [],
  takenViewPaths: [],
};

/**
 * What the derived sections of the sidebar show, reloaded whenever the vault or
 * its index changes.
 *
 * Nothing here is a second list: every section is read back from the files and
 * the index each time, so starring a note in one place and opening it in
 * another cannot disagree.
 */
export function useSidebarCatalog({
  fs,
  markdown,
  index,
  types,
  notePaths,
  vaultKey,
  changeKey,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  index: IndexPort;
  types: readonly ObjectType[];
  /** Every note in the vault, so a link in a query view's text names the note it means. */
  notePaths: readonly string[];
  vaultKey: string | null;
  /** Changes when the vault's files do, so a new view shows up without a restart. */
  changeKey: string;
}): {
  catalog: SidebarCatalog;
  sidebarTypes: readonly SidebarType[];
  quick: readonly SidebarQuickView[];
} {
  const [catalog, setCatalog] = useState<SidebarCatalog>(NOTHING);
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map());
  const [quickCounts, setQuickCounts] = useState<ReadonlyMap<QuickViewId, number>>(new Map());
  // Read when a count runs, not a reason to run one: the tree re-reads the
  // notes on the same change that moves `changeKey`, which recounts already.
  const notePathsNow = useRef(notePaths);
  notePathsNow.current = notePaths;

  const load = useCallback(() => {
    if (vaultKey === null) {
      setCatalog(NOTHING);
      setCounts(new Map());
      return;
    }
    loadSidebarCatalog({ fs, markdown, index })
      .then((next) =>
        // The same quick views keep the same list, so their counts — which
        // already re-run on the change that set this load off — do not run twice.
        setCatalog((was) =>
          sameQuickViews(was.quick, next.quick) ? { ...next, quick: was.quick } : next,
        ),
      )
      .catch(() => {
        // The catalogue is rebuilt on the next change; an empty section reads
        // better than an error where the vault should be.
        setCatalog(NOTHING);
      });
  }, [fs, markdown, index, vaultKey]);

  useEffect(load, [load, changeKey]);

  useEffect(() => {
    let cancelled = false;
    countNotesByType({ index, types })
      .then((counted) => {
        if (!cancelled) setCounts(counted);
      })
      .catch(() => {
        // Already handled per type inside the use-case; nothing to add here.
      });
    return () => {
      cancelled = true;
    };
  }, [index, types, changeKey]);

  useEffect(() => {
    let cancelled = false;
    countQuickViews({
      fs,
      markdown,
      index,
      quick: catalog.quick,
      types,
      notePaths: notePathsNow.current,
    })
      .then((counted) => {
        if (!cancelled) setQuickCounts(counted);
      })
      .catch(() => {
        // Already handled per view inside the use-case: a view it cannot count
        // simply shows no count.
      });
    return () => {
      cancelled = true;
    };
  }, [fs, markdown, index, catalog.quick, types, changeKey]);

  const sidebarTypes = types.map((type) => ({
    name: type.name,
    label: type.label,
    count: counts.get(type.name) ?? 0,
    icon: objectTypeIcon(type),
  }));

  const quick = useMemo(
    () => catalog.quick.map(({ id, entry }) => ({ id, entry, count: quickCounts.get(id) ?? null })),
    [catalog.quick, quickCounts],
  );

  return { catalog, sidebarTypes, quick };
}

function sameQuickViews(was: readonly QuickView[], next: readonly QuickView[]): boolean {
  return (
    was.length === next.length &&
    was.every((view, at) => view.id === next[at]?.id && view.entry.path === next[at]?.entry.path)
  );
}
