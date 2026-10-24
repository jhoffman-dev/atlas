import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { ASK_PLACE, askShortcut } from './ask-shortcut.ts';
import type { NavigationPlace } from './navigation-history.ts';
import {
  activateTab,
  activePlace,
  closeTab,
  EMPTY_WORKSPACE,
  openInActiveTab,
  openInNewTab,
  tabPlace,
  type Workspace,
} from './workspace.ts';

const plan: NavigationPlace = { kind: 'note', path: createVaultPath('Plan.md') };
const placesOf = (ws: Workspace) => (ws.panes[0]?.tabs ?? []).map((tab) => tabPlace(tab));

describe('askShortcut (⌘J, #37)', () => {
  it('opens Ask in the tab you are in, so Back returns to the note', () => {
    const ws = askShortcut(openInActiveTab(EMPTY_WORKSPACE, plan));
    expect(activePlace(ws)).toEqual(ASK_PLACE);
    expect(placesOf(ws)).toEqual([ASK_PLACE]);
  });

  it('on Ask, goes back to where you were', () => {
    const ws = askShortcut(askShortcut(openInActiveTab(EMPTY_WORKSPACE, plan)));
    expect(activePlace(ws)).toEqual(plan);
  });

  it('on an Ask with nowhere to go back to, hands the workspace back unchanged', () => {
    const onAsk = askShortcut(EMPTY_WORKSPACE);
    expect(activePlace(onAsk)).toEqual(ASK_PLACE);
    expect(askShortcut(onAsk)).toBe(onAsk);
  });

  it('shows the tab already on Ask rather than opening a second', () => {
    const ws = openInNewTab(openInActiveTab(EMPTY_WORKSPACE, ASK_PLACE), plan);
    const shown = askShortcut(ws);
    expect(activePlace(shown)).toEqual(ASK_PLACE);
    expect(placesOf(shown)).toEqual([ASK_PLACE, plan]);
  });
});

describe('askShortcut, from an Ask tab already open (#37)', () => {
  const onNote = () => openInNewTab(openInActiveTab(EMPTY_WORKSPACE, ASK_PLACE), plan);

  it('returns to the tab it switched from, even when the Ask tab has history of its own', () => {
    const withHistory = openInNewTab(askShortcut(openInActiveTab(EMPTY_WORKSPACE, plan)), {
      kind: 'note',
      path: createVaultPath('Other.md'),
    });
    const onAsk = askShortcut(withHistory);
    expect(activePlace(onAsk)).toEqual(ASK_PLACE);
    expect(activePlace(askShortcut(onAsk))).toEqual({
      kind: 'note',
      path: createVaultPath('Other.md'),
    });
  });

  it('forgets where it came from once that tab is closed, and goes Back instead', () => {
    const onAsk = askShortcut(onNote());
    const from = onAsk.askReturn?.from ?? '';
    const closed = closeTab(onAsk, { pane: 0, id: from });
    expect(askShortcut(closed)).toBe(closed);
  });

  it('records afresh where it came from when ⌘J is pressed again from another tab', () => {
    const onAsk = askShortcut(onNote());
    const moved = activateTab(onAsk, { pane: 0, id: onAsk.askReturn?.from ?? '' });
    expect(activePlace(askShortcut(moved))).toEqual(ASK_PLACE);
    expect(askShortcut(moved).askReturn?.from).toBe(onAsk.askReturn?.from);
  });
});
