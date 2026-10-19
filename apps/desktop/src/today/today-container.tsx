import { TodayPage } from '@atlas/ui';
import { localClock } from '../today.ts';
import type { PageContainerProps } from '../workspace/page-wiring.ts';
import { useToday } from './use-today.ts';

/** What the Today page needs from the window beyond what every page is handed. */
export interface TodayWiring {
  /** The saved view titled Today, which the page links to, when the vault has one. */
  readonly view: { readonly title: string; readonly onOpen: () => void } | null;
  readonly onOpenDailyNote: () => void;
}

/**
 * The Today page as a tab (#111, tab-model.md PR B): it reads the day's
 * tasks itself, so a tick or a read landing draws this and not the window.
 * Drawn only while it is the shown tab, and read afresh each time it is;
 * what is settling, and the last change's undo, are the window's per vault
 * (`pages.holds`), so a tab switched back to sees the tick still landing.
 */
export function TodayContainer({ wiring, chrome }: PageContainerProps) {
  const { pages, pane } = wiring;
  const today = useToday({
    ports: pages.ports,
    editors: pane.editors,
    clock: localClock,
    types: pane.types,
    vaultKey: pane.vault,
    indexKey: pane.indexKey,
    indexReady: pages.indexReady,
    open: true,
    onSettled: pages.onSettled,
    activity: pane.activity,
    held: pages.holds.today,
  });
  return (
    <TodayPage
      {...today.page}
      view={pages.today.view}
      onOpen={pages.openNote}
      onOpenInbox={() => pages.openPage({ kind: 'inbox' })}
      onOpenReview={() => pages.openPage({ kind: 'review' })}
      onOpenDailyNote={pages.today.onOpenDailyNote}
      {...chrome}
    />
  );
}
