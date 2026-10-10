import { describe, expect, it } from 'vitest';
import { openInFocused, splitFocused, SINGLE_PANE } from '../panes/index.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { activeSidebarPage } from './index.ts';

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

  it('is the Proposals page while it is open, over the graph, the type and the note', () => {
    const layout = openInFocused(SINGLE_PANE, acme);
    expect(
      activeSidebarPage({ layout, openTypeName: 'task', graphOpen: true, proposalsOpen: true }),
    ).toEqual({ kind: 'proposals' });
  });
});
