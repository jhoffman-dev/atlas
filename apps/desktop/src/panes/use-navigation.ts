import { useCallback, useEffect, useMemo } from 'react';
import {
  backPlace,
  forwardPlace,
  goBack,
  goForward,
  historyOf,
  visit,
  type NavigationHistory,
  type NavigationPlace,
} from '@atlas/domain';
import type { PageHistory } from '@atlas/ui';
import type { MainView } from '../main-view.ts';
import type { PanesView } from './use-panes.ts';

/** The ways to show a place again, which are the ways it was opened. */
export interface PlaceOpeners {
  readonly showPanes: () => void;
  readonly openType: (name: string) => void;
  readonly openGraph: (scope: Extract<NavigationPlace, { kind: 'graph' }>['scope']) => void;
  readonly openQuery: () => void;
  readonly openTags: (tag: string | null) => void;
  readonly openArchive: () => void;
  readonly openAutomations: () => void;
  readonly openActivity: () => void;
  readonly openTemplates: () => void;
  readonly openProposals: () => void;
}

/** The page over the panes as a place Back can return to; null while the panes show. */
export function mainViewPlace(view: MainView): NavigationPlace | null {
  switch (view.kind) {
    case 'panes':
      return null;
    case 'type':
      return { kind: 'type', name: view.name };
    case 'graph':
      return { kind: 'graph', scope: view.scope };
    case 'query':
      return { kind: 'query' };
    case 'tags':
      return { kind: 'tags', tag: view.tag };
    case 'archive':
      return { kind: 'archive' };
    case 'automations':
      return { kind: 'automations' };
    case 'activity':
      return { kind: 'activity' };
    case 'templates':
      return { kind: 'templates' };
    case 'proposals':
      return { kind: 'proposals' };
  }
}

/**
 * Back and Forward for every pane (U-09).
 *
 * Whatever a pane comes to show is recorded as a visit — however it was
 * opened, so no call site has to remember to. The page over the panes counts
 * as the focused pane's, since it is shown in that pane's place. Going back
 * or forward opens the place the way it was first opened; the visit that
 * follows is already current, so it records nothing.
 */
export function useNavigation({
  panes,
  mainView,
  open,
  nameOf,
}: {
  panes: PanesView;
  mainView: MainView;
  open: PlaceOpeners;
  /** What a place is called, for the tooltip saying where Back goes. */
  nameOf: (place: NavigationPlace) => string;
}) {
  const { layout, histories, setHistory, openInPane, focus } = panes;
  const overPanes = useMemo(() => mainViewPlace(mainView), [mainView]);

  useEffect(() => {
    layout.paths.forEach((held, pane) => {
      const place: NavigationPlace | null =
        overPanes !== null && pane === layout.focused
          ? overPanes
          : held === null
            ? null
            : { kind: 'note', path: held };
      if (place === null) return;
      setHistory({ pane, history: visit(historyOf(histories, pane), place) });
    });
  }, [layout, overPanes, histories, setHistory]);

  const show = useCallback(
    (pane: number, place: NavigationPlace) => {
      if (place.kind === 'note') {
        open.showPanes();
        openInPane({ pane, path: place.path });
        return;
      }
      focus(pane);
      if (place.kind === 'type') open.openType(place.name);
      else if (place.kind === 'graph') open.openGraph(place.scope);
      else if (place.kind === 'tags') open.openTags(place.tag);
      else if (place.kind === 'archive') open.openArchive();
      else if (place.kind === 'automations') open.openAutomations();
      else if (place.kind === 'activity') open.openActivity();
      else if (place.kind === 'templates') open.openTemplates();
      else if (place.kind === 'proposals') open.openProposals();
      else open.openQuery();
    },
    [open, openInPane, focus],
  );

  const step = useCallback(
    (pane: number, move: (history: NavigationHistory) => NavigationHistory) => {
      const was = historyOf(histories, pane);
      const next = move(was);
      if (next === was || next.current === null) return;
      setHistory({ pane, history: next });
      show(pane, next.current);
    },
    [histories, setHistory, show],
  );

  const historyFor = useCallback(
    (pane: number): PageHistory => {
      const history = historyOf(histories, pane);
      const back = backPlace(history);
      const forward = forwardPlace(history);
      return {
        back: back === null ? null : nameOf(back),
        forward: forward === null ? null : nameOf(forward),
        onBack: () => step(pane, goBack),
        onForward: () => step(pane, goForward),
      };
    },
    [histories, nameOf, step],
  );

  return useMemo(
    () => ({
      /** A pane's Back and Forward, for its page bar. */
      historyFor,
      /** Back in the pane being worked in: ⌘[ and the mouse's back button. */
      back: () => step(layout.focused, goBack),
      /** Forward in the pane being worked in: ⌘] and the mouse's forward button. */
      forward: () => step(layout.focused, goForward),
    }),
    [historyFor, step, layout.focused],
  );
}
