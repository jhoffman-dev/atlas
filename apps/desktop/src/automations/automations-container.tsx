import type { ComponentProps } from 'react';
import { LoadedLater } from '../page-frame-fallback.tsx';
import { automationsScreen } from '../pages-on-first-use.ts';
import { localClock } from '../today.ts';
import type { PageContainerProps } from '../workspace/page-wiring.ts';
import { useIndexKey } from '../index/index-status-store.ts';

const AutomationsScreen = automationsScreen.Component;

/**
 * What the Automations page needs from the window: the rules as
 * `useAutomations` runs them, and the ports it writes through. That hook
 * stays the window's, since the clock runs the rules whatever page shows, so
 * the page draws with the window.
 */
export type AutomationsWiring = Pick<
  ComponentProps<typeof AutomationsScreen>,
  'automations' | 'ports'
>;

/** The Automations page as a tab (P29, tab-model.md PR B). */
export function AutomationsContainer({ wiring, chrome }: PageContainerProps) {
  const { pages, pane } = wiring;
  // Still read again on every news of the index: what it reads is not yet scoped (#325).
  const indexKey = useIndexKey(pane.indexStatus, pane.vault);
  return (
    <LoadedLater chrome={chrome}>
      <AutomationsScreen
        automations={pages.automations.automations}
        ports={pages.automations.ports}
        clock={localClock}
        indexKey={indexKey}
        activity={pane.activity}
        onOpenNote={pages.openNote}
        {...chrome}
      />
    </LoadedLater>
  );
}
