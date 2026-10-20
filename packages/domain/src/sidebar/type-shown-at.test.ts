import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { typeShownAt } from './index.ts';

const VIEWS = [{ path: createVaultPath('.atlas/views/Meeting table.md'), type: 'meeting' }];

describe('typeShownAt', () => {
  it('is the type a type page is on', () => {
    expect(typeShownAt({ kind: 'type', name: 'meeting' }, VIEWS)).toBe('meeting');
  });

  it('is the type a saved view lists', () => {
    const place = { kind: 'note', path: createVaultPath('.atlas/views/Meeting table.md') } as const;
    expect(typeShownAt(place, VIEWS)).toBe('meeting');
  });

  it('is none for a note that is not a view, a page of another kind, or nothing', () => {
    expect(typeShownAt({ kind: 'note', path: createVaultPath('Standup.md') }, VIEWS)).toBeNull();
    expect(typeShownAt({ kind: 'today' }, VIEWS)).toBeNull();
    expect(typeShownAt(null, VIEWS)).toBeNull();
  });
});
