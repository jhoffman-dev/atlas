// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createVaultPath, type NavigationPlace, type PaneLayout } from '@atlas/domain';
import { useMainView } from '../main-view.ts';
import { placeName } from './place-name.ts';
import { mainViewPlace, useNavigation } from './use-navigation.ts';
import { usePanes, type PaneLayoutStore } from './use-panes.ts';

const alpha = createVaultPath('alpha.md');
const beta = createVaultPath('beta.md');
const gamma = createVaultPath('gamma.md');

const store: PaneLayoutStore = { read: () => null, write: () => {} };
const nameOf = (place: NavigationPlace) =>
  placeName(place, {
    titleOf: (path) => path.replace(/\.md$/, ''),
    typeLabelOf: (name) => name.toUpperCase(),
    tagNameOf: (key) => (key === 'idea' ? 'Idea' : key),
  });

/** The panes, the page over them and Back/Forward, wired as the app wires them. */
function useWindow() {
  const panes = usePanes({ store, vaultKey: '/vault' });
  const main = useMainView();
  const navigation = useNavigation({ panes, mainView: main.view, open: main, nameOf });
  return { panes, main, navigation };
}

const render = () => renderHook(useWindow).result;
const layoutOf = (result: ReturnType<typeof render>): PaneLayout => result.current.panes.layout;

describe('useNavigation', () => {
  it('records every note a pane shows, and steps back and forward through them', () => {
    const result = render();
    act(() => result.current.panes.openInFocusedPane(alpha));
    act(() => result.current.panes.openInFocusedPane(beta));

    expect(result.current.navigation.historyFor(0)).toMatchObject({ back: 'alpha', forward: null });

    act(() => result.current.navigation.back());
    expect(layoutOf(result).paths).toEqual([alpha]);
    expect(result.current.navigation.historyFor(0)).toMatchObject({ back: null, forward: 'beta' });

    act(() => result.current.navigation.forward());
    expect(layoutOf(result).paths).toEqual([beta]);
  });

  it('does nothing when there is nowhere to go', () => {
    const result = render();
    act(() => result.current.panes.openInFocusedPane(alpha));
    act(() => result.current.navigation.back());
    expect(layoutOf(result).paths).toEqual([alpha]);
  });

  it('counts the page over the panes as a step of the focused pane, and goes back under it', () => {
    const result = render();
    act(() => result.current.panes.openInFocusedPane(alpha));
    act(() => result.current.main.openType('task'));

    expect(result.current.navigation.historyFor(0).back).toBe('alpha');
    act(() => result.current.navigation.back());
    expect(result.current.main.view).toEqual({ kind: 'panes' });
    expect(layoutOf(result).paths).toEqual([alpha]);

    act(() => result.current.navigation.forward());
    expect(result.current.main.view).toMatchObject({ kind: 'type', name: 'task' });
  });

  it('goes back to the graph and the query page by opening them again', () => {
    const result = render();
    act(() => result.current.main.openGraph({ kind: 'vault' }));
    act(() => result.current.main.openQuery());
    act(() => result.current.panes.openInFocusedPane(alpha));
    act(() => result.current.main.showPanes());

    act(() => result.current.navigation.back());
    expect(result.current.main.view).toEqual({ kind: 'query' });
    act(() => result.current.navigation.back());
    expect(result.current.main.view).toEqual({ kind: 'graph', scope: { kind: 'vault' } });
  });

  it('goes back from one tag to the tag before, then to every tag', () => {
    const result = render();
    act(() => result.current.main.openTags(null));
    act(() => result.current.main.openTags('idea'));
    act(() => result.current.main.openTags('para/area'));

    act(() => result.current.navigation.back());
    expect(result.current.main.view).toEqual({ kind: 'tags', tag: 'idea' });
    act(() => result.current.navigation.back());
    expect(result.current.main.view).toEqual({ kind: 'tags', tag: null });
  });

  it('keeps each pane its own history, and a closed pane takes its history with it', () => {
    const result = render();
    act(() => result.current.panes.openInFocusedPane(alpha));
    act(() => result.current.panes.toggleSplit());
    act(() => result.current.panes.openInPane({ pane: 1, path: beta }));
    act(() => result.current.panes.openInPane({ pane: 0, path: gamma }));

    expect(result.current.navigation.historyFor(0).back).toBe('alpha');
    expect(result.current.navigation.historyFor(1).back).toBe('alpha');

    act(() => result.current.panes.close(0));
    // What was pane 1 is now the only pane, with its own Back.
    expect(layoutOf(result).paths).toEqual([beta]);
    expect(result.current.navigation.historyFor(0)).toMatchObject({ back: 'alpha', forward: null });
  });

  it('forgets a deleted note, and follows a moved one', () => {
    const result = render();
    act(() => result.current.panes.openInFocusedPane(alpha));
    act(() => result.current.panes.openInFocusedPane(beta));
    act(() => result.current.panes.openInFocusedPane(gamma));
    act(() => result.current.navigation.back());

    act(() => result.current.panes.closeNotes([gamma]));
    expect(result.current.navigation.historyFor(0).forward).toBeNull();

    act(() =>
      result.current.panes.followMove({ from: alpha, to: createVaultPath('Notes/alpha.md') }),
    );
    expect(result.current.navigation.historyFor(0).back).toBe('Notes/alpha');
    act(() => result.current.navigation.back());
    expect(layoutOf(result).paths).toEqual([createVaultPath('Notes/alpha.md')]);
  });

  it('goes back to the Terms page, and forward from it, by the way it was opened', () => {
    const result = render();
    act(() => result.current.panes.openInFocusedPane(alpha));
    act(() => result.current.main.openTerms());
    act(() => result.current.main.showPanes());
    expect(result.current.navigation.historyFor(0)).toMatchObject({ back: 'Terms' });

    act(() => result.current.navigation.back());
    expect(result.current.main.termsOpen).toBe(true);
    act(() => result.current.navigation.forward());
    expect(result.current.main.termsOpen).toBe(false);
  });

  it('goes back to the Proposals page, and forward from it, by the way it was opened', () => {
    const result = render();
    act(() => result.current.panes.openInFocusedPane(alpha));
    act(() => result.current.main.openProposals());
    act(() => result.current.main.showPanes());
    expect(result.current.navigation.historyFor(0)).toMatchObject({ back: 'Proposals' });

    act(() => result.current.navigation.back());
    expect(result.current.main.proposalsOpen).toBe(true);
    act(() => result.current.navigation.forward());
    expect(result.current.main.proposalsOpen).toBe(false);
  });
});

describe('mainViewPlace', () => {
  it('is null while the panes show, and the page otherwise', () => {
    expect(mainViewPlace({ kind: 'panes' })).toBeNull();
    expect(mainViewPlace({ kind: 'type', name: 'task', mode: 'edit' })).toEqual({
      kind: 'type',
      name: 'task',
    });
    expect(mainViewPlace({ kind: 'query' })).toEqual({ kind: 'query' });
    expect(mainViewPlace({ kind: 'tags', tag: 'idea' })).toEqual({ kind: 'tags', tag: 'idea' });
    expect(mainViewPlace({ kind: 'activity' })).toEqual({ kind: 'activity' });
    expect(mainViewPlace({ kind: 'terms' })).toEqual({ kind: 'terms' });
    expect(mainViewPlace({ kind: 'inbox' })).toEqual({ kind: 'inbox' });
    expect(mainViewPlace({ kind: 'proposals' })).toEqual({ kind: 'proposals' });
  });
});

describe('placeName', () => {
  it('names each kind of place as its own bar does', () => {
    expect(nameOf({ kind: 'note', path: alpha })).toBe('alpha');
    expect(nameOf({ kind: 'inbox' })).toBe('Inbox');
    expect(nameOf({ kind: 'type', name: 'task' })).toBe('TASK');
    expect(nameOf({ kind: 'graph', scope: { kind: 'vault' } })).toBe('Graph');
    expect(nameOf({ kind: 'graph', scope: { kind: 'note', path: beta, depth: 1 } })).toBe(
      'Graph around beta',
    );
    expect(nameOf({ kind: 'query' })).toBe('Query');
    expect(nameOf({ kind: 'tags', tag: null })).toBe('Tags');
    expect(nameOf({ kind: 'tags', tag: 'idea' })).toBe('#Idea');
    expect(nameOf({ kind: 'tags', tag: 'tag me' })).toBe('#tag me#');
    expect(nameOf({ kind: 'terms' })).toBe('Terms');
    expect(nameOf({ kind: 'proposals' })).toBe('Proposals');
  });
});
