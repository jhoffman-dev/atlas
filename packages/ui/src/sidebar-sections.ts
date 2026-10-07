import { useCallback, useMemo, useState } from 'react';
import { canMoveSection, movedSection, sectionOrder, type SidebarSectionId } from '@atlas/domain';

/**
 * Where a viewer's collapsed sections are remembered.
 *
 * Per-viewer convenience rather than vault data — which section you had shut
 * says nothing about the notes — so it does not belong in a file. It is still
 * I/O, so the component takes it as a port and the composition root supplies
 * the browser one.
 */
export type SectionStore = {
  /** `null` when nothing has been remembered, which is not an error. */
  read: () => readonly SidebarSectionId[] | null;
  write: (collapsed: readonly SidebarSectionId[]) => void;
};

/**
 * The order the sections were put in, which the vault keeps; unlike which are
 * shut, it is the same wherever the vault is opened.
 */
export interface SectionOrder {
  /** As the vault's settings hold it; null when it was never chosen. */
  readonly saved: readonly SidebarSectionId[] | null;
  /** Left out, the sections cannot be moved. */
  readonly onChange?: (order: readonly SidebarSectionId[]) => void;
}

const UNCHOSEN: SectionOrder = { saved: null };

/**
 * Which sections are open, the order they are shown in, and how to open, shut
 * or move one. The order itself is the domain's to work out; open or shut, a
 * section keeps its place in it.
 *
 * What is remembered is the collapsed sections rather than the open ones, so a
 * section added in a later version arrives open instead of hidden behind a
 * setting nobody set.
 */
export function useSidebarSections(
  store: SectionStore,
  order: SectionOrder = UNCHOSEN,
): {
  shown: readonly SidebarSectionId[];
  isExpanded: (section: SidebarSectionId) => boolean;
  toggle: (section: SidebarSectionId) => void;
  /** Null when the sections cannot be moved. */
  move: ((args: { id: SidebarSectionId; to: number }) => void) | null;
  /** Whether a move would change what is shown; one that would not is not made. */
  canMove: (args: { id: SidebarSectionId; to: number }) => boolean;
} {
  const [collapsed, remember] = useState<ReadonlySet<SidebarSectionId>>(
    () => new Set(store.read() ?? []),
  );
  const { saved, onChange } = order;
  const chosen = useMemo(() => sectionOrder(saved), [saved]);

  const toggle = useCallback(
    (section: SidebarSectionId) => {
      const next = new Set(collapsed);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      // Outside the state updater on purpose: React may run an updater twice,
      // and the write would then happen twice.
      store.write([...next]);
      remember(next);
    },
    [collapsed, store],
  );

  const isExpanded = useCallback(
    (section: SidebarSectionId) => !collapsed.has(section),
    [collapsed],
  );

  const canMove = useCallback(
    ({ id, to }: { id: SidebarSectionId; to: number }) => canMoveSection({ order: chosen, id, to }),
    [chosen],
  );

  const move = useMemo(
    () =>
      onChange === undefined
        ? null
        : ({ id, to }: { id: SidebarSectionId; to: number }) => {
            // A move that changes nothing on screen writes nothing.
            if (!canMove({ id, to })) return;
            onChange(movedSection({ order: chosen, id, to }));
          },
    [onChange, canMove, chosen],
  );

  return { shown: chosen, isExpanded, toggle, move, canMove };
}
