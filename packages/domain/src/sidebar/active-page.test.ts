import { describe, expect, it } from 'vitest';
import { openInFocused, splitFocused, SINGLE_PANE } from '../panes/index.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import type { NavigationPlace } from '../panes/index.ts';
import { activeSidebarPage, activeSidebarPageOf } from './index.ts';

const acme = createVaultPath('Acme.md');
const board = createVaultPath('.atlas/views/Board.md');

describe('activeSidebarPage', () => {
  it('is nothing when no pane holds a page and no type is open', () => {
    expect(activeSidebarPage({ layout: SINGLE_PANE, openTypeName: null })).toBeNull();
  });

  it('is the note in the focused pane', () => {
    const layout = openInFocused(SINGLE_PANE, acme);
    expect(activeSidebarPage({ layout, openTypeName: null })).toEqual({ kind: 'note', path: acme });
  });

  it('is the type whose view the focused pane shows: a type owns its views', () => {
    const layout = openInFocused(SINGLE_PANE, board);
    const viewOwner = (path: string) => (path === board ? 'task' : null);
    expect(activeSidebarPage({ layout, openTypeName: null, viewOwner })).toEqual({
      kind: 'type',
      name: 'task',
    });
    expect(
      activeSidebarPage({
        layout: openInFocused(SINGLE_PANE, acme),
        openTypeName: null,
        viewOwner,
      }),
    ).toEqual({ kind: 'note', path: acme });
  });

  it('is the open type, not the note the hidden pane still holds', () => {
    const layout = openInFocused(SINGLE_PANE, acme);
    expect(activeSidebarPage({ layout, openTypeName: 'task' })).toEqual({
      kind: 'type',
      name: 'task',
    });
  });

  it('is only the focused half of a split', () => {
    const layout = openInFocused(splitFocused(openInFocused(SINGLE_PANE, acme)), board);
    expect(activeSidebarPage({ layout, openTypeName: null })).toEqual({
      kind: 'note',
      path: board,
    });
    expect(activeSidebarPage({ layout: { ...layout, focused: 0 }, openTypeName: null })).toEqual({
      kind: 'note',
      path: acme,
    });
  });

  it('is the graph while it is open, not the type or the note it covers', () => {
    const layout = openInFocused(SINGLE_PANE, acme);
    expect(activeSidebarPage({ layout, openTypeName: 'task', graphOpen: true })).toEqual({
      kind: 'graph',
    });
  });

  it('is the tags page while it is open, not the note it covers', () => {
    const layout = openInFocused(SINGLE_PANE, acme);
    expect(activeSidebarPage({ layout, openTypeName: null, tagsOpen: true })).toEqual({
      kind: 'tags',
    });
  });

  it('is the Archive while it is open, over the graph, the type and the note', () => {
    const layout = openInFocused(SINGLE_PANE, acme);
    expect(
      activeSidebarPage({ layout, openTypeName: 'task', graphOpen: true, archiveOpen: true }),
    ).toEqual({ kind: 'archive' });
  });

  it('is the Inbox while it is open, over the graph, the type and the note', () => {
    const layout = openInFocused(SINGLE_PANE, acme);
    expect(
      activeSidebarPage({ layout, openTypeName: 'task', graphOpen: true, inboxOpen: true }),
    ).toEqual({ kind: 'inbox' });
  });

  it('is the weekly review while it is open, over the graph, the type and the note', () => {
    const layout = openInFocused(SINGLE_PANE, acme);
    expect(
      activeSidebarPage({ layout, openTypeName: 'task', graphOpen: true, reviewOpen: true }),
    ).toEqual({ kind: 'review' });
  });

  it('is the Today page while it is open, over the graph, the type and the note', () => {
    const layout = openInFocused(SINGLE_PANE, acme);
    expect(
      activeSidebarPage({ layout, openTypeName: 'task', graphOpen: true, todayOpen: true }),
    ).toEqual({ kind: 'today' });
  });

  it('is the Automations page while it is open, over the graph, the type and the note', () => {
    const layout = openInFocused(SINGLE_PANE, acme);
    expect(
      activeSidebarPage({ layout, openTypeName: 'task', graphOpen: true, automationsOpen: true }),
    ).toEqual({ kind: 'automations' });
  });

  it('is the Activity page while it is open, over the graph, the type and the note', () => {
    const layout = openInFocused(SINGLE_PANE, acme);
    expect(
      activeSidebarPage({ layout, openTypeName: 'task', graphOpen: true, activityOpen: true }),
    ).toEqual({ kind: 'activity' });
  });

  it('is the Templates page while it is open, over the graph, the type and the note', () => {
    const layout = openInFocused(SINGLE_PANE, acme);
    expect(
      activeSidebarPage({ layout, openTypeName: 'task', graphOpen: true, templatesOpen: true }),
    ).toEqual({ kind: 'templates' });
  });

  it('is the Terms page while it is open, over the graph, the type and the note', () => {
    const layout = openInFocused(SINGLE_PANE, acme);
    expect(
      activeSidebarPage({ layout, openTypeName: 'task', graphOpen: true, termsOpen: true }),
    ).toEqual({ kind: 'terms' });
  });
});

describe('activeSidebarPageOf', () => {
  const viewOwner = (path: string) => (path === board ? 'task' : null);

  it('is nothing for an empty tab', () => {
    expect(activeSidebarPageOf(null, viewOwner)).toBeNull();
  });

  it('is the note the tab shows', () => {
    expect(activeSidebarPageOf({ kind: 'note', path: acme }, viewOwner)).toEqual({
      kind: 'note',
      path: acme,
    });
  });

  it('is the type whose view the tab shows: a type owns its views', () => {
    expect(activeSidebarPageOf({ kind: 'note', path: board }, viewOwner)).toEqual({
      kind: 'type',
      name: 'task',
    });
  });

  it('is the type a tab is on', () => {
    expect(activeSidebarPageOf({ kind: 'type', name: 'person' }, viewOwner)).toEqual({
      kind: 'type',
      name: 'person',
    });
  });

  it('is the page a tab is on, whichever tag or scope it holds', () => {
    const pages: readonly [NavigationPlace, string][] = [
      [{ kind: 'graph', scope: { kind: 'vault' } }, 'graph'],
      [{ kind: 'graph', scope: { kind: 'note', path: acme, depth: 1 } }, 'graph'],
      [{ kind: 'tags', tag: null }, 'tags'],
      [{ kind: 'tags', tag: 'urgent' }, 'tags'],
      [{ kind: 'archive' }, 'archive'],
      [{ kind: 'inbox' }, 'inbox'],
      [{ kind: 'review' }, 'review'],
      [{ kind: 'today' }, 'today'],
      [{ kind: 'automations' }, 'automations'],
      [{ kind: 'activity' }, 'activity'],
      [{ kind: 'templates' }, 'templates'],
      [{ kind: 'terms' }, 'terms'],
    ];
    for (const [place, kind] of pages) {
      expect(activeSidebarPageOf(place, viewOwner)).toEqual({ kind });
    }
  });

  it('marks nothing for the query page, which has no sidebar row', () => {
    expect(activeSidebarPageOf({ kind: 'query' }, viewOwner)).toBeNull();
  });
});
