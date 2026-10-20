import type { ComponentProps } from 'react';
import { LoadedLater } from '../page-frame-fallback.tsx';
import { automationsScreen } from '../pages-on-first-use.ts';
import { localClock } from '../today.ts';
import type { PageContainerProps } from '../workspace/page-wiring.ts';
import { useIndexKey } from '../index/index-status-store.ts';
import { useAutomationsController, type AutomationsStore } from './automations-store.ts';

const AutomationsScreen = automationsScreen.Component;

/**
 * What the Automations page needs from the window: where the runner says the
 * rules stand (`AutomationsRunner`, #326), and the ports it writes through.
 * The runner is the window's, since the clock runs the rules whatever page
 * shows; the page reads it from the store, so it draws with the rules, not
 * with the window.
 */
export interface AutomationsWiring {
  readonly store: AutomationsStore;
  readonly ports: ComponentProps<typeof AutomationsScreen>['ports'];
}

/** The Automations page as a tab (P29, tab-model.md PR B). */
export function AutomationsContainer({ wiring, chrome }: PageContainerProps) {
  const { pages, pane } = wiring;
  const automations = useAutomationsController(pages.automations.store);
  // The rule editor's query builder still reads again on every news of the index (#325).
  const indexKey = useIndexKey(pane.indexStatus, pane.vault);
  if (automations === null) return null;
  return (
    <LoadedLater chrome={chrome}>
      <AutomationsScreen
        automations={automations}
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
