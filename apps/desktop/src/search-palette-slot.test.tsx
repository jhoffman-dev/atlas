// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath } from '@atlas/domain';
import { fakeIndexPort } from '@atlas/application';
import { createOverlayStore, overlayNow, showOverlay } from './overlay-store.ts';
import { createWorkspaceStore } from './workspace/workspace-store.ts';
import { SearchPaletteSlot } from './search-palette-slot.tsx';

const RECIPES = { path: createVaultPath('recipes.md'), title: 'Recipes', snippet: 'Sourdough' };
const NEW_VIEW = { id: 'new-view', label: 'New view' };

function slot() {
  const store = createOverlayStore();
  const onCommand = vi.fn();
  const onPick = vi.fn();
  render(
    <SearchPaletteSlot
      store={store}
      workspace={createWorkspaceStore({ remembered: { read: () => null, write: () => {} } })}
      index={fakeIndexPort({ search: async () => [RECIPES] })}
      commandsFor={() => [NEW_VIEW]}
      offerFor={() => []}
      changeKey="ready:1"
      onCommand={onCommand}
      onPick={onPick}
      fallbackFocus={() => null}
    />,
  );
  return { store, onCommand, onPick };
}

const palette = () => screen.queryByRole('dialog', { name: 'Search notes' });

describe('the search palette slot', () => {
  it('draws nothing until ⌘K puts the palette up', async () => {
    const { store } = slot();
    expect(palette()).toBeNull();
    act(() => showOverlay(store, 'search'));
    expect(await screen.findByRole('dialog', { name: 'Search notes' })).toBeDefined();
  });

  it('opens the note picked, once the palette has closed and forgotten the query', async () => {
    const { store, onPick } = slot();
    act(() => showOverlay(store, 'search'));
    await userEvent.type(await screen.findByLabelText('Search the vault'), 'sour');
    await userEvent.click(await screen.findByRole('option', { name: /Recipes/ }));

    expect(onPick).toHaveBeenCalledWith('recipes.md');
    expect(overlayNow(store)).toBeNull();
    expect(store.getState().palette.query).toBe('');
    expect(palette()).toBeNull();
  });

  it('runs the command chosen with the query it was chosen from', async () => {
    const { store, onCommand } = slot();
    act(() => showOverlay(store, 'search'));
    await userEvent.type(await screen.findByLabelText('Search the vault'), 'new');
    await userEvent.click(await screen.findByRole('option', { name: /New view/ }));

    expect(onCommand).toHaveBeenCalledWith('new-view', 'new');
    expect(overlayNow(store)).toBeNull();
  });

  it('closes on Escape, choosing nothing', async () => {
    const { store, onCommand, onPick } = slot();
    act(() => showOverlay(store, 'search'));
    await userEvent.type(await screen.findByLabelText('Search the vault'), 'sour');
    await userEvent.keyboard('{Escape}');

    expect(overlayNow(store)).toBeNull();
    expect(store.getState().palette.query).toBe('');
    expect(onCommand).not.toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });
});
