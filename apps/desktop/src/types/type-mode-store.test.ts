import { describe, expect, it } from 'vitest';
import { askToEdit, createTypeModeStore, takeEditAsked } from './type-mode-store.ts';

describe('the type mode store', () => {
  it('answers the ask for the tab and type it named, once', () => {
    const store = createTypeModeStore();
    expect(takeEditAsked(store, { tabId: 't1', name: 'person' })).toBe(false);
    askToEdit(store, { tabId: 't1', name: 'person' });
    expect(takeEditAsked(store, { tabId: 't2', name: 'person' })).toBe(false);
    expect(takeEditAsked(store, { tabId: 't1', name: 'book' })).toBe(false);
    expect(takeEditAsked(store, { tabId: 't1', name: 'person' })).toBe(true);
    expect(takeEditAsked(store, { tabId: 't1', name: 'person' })).toBe(false);
  });
});
