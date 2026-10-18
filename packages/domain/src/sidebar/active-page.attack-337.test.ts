import { describe, expect, it } from 'vitest';
import type { NavigationPlace } from '../panes/navigation-history.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { activeSidebarPageOf } from './active-page.ts';

/** Adversarial attack on PR #337: the sidebar mark for every kind of place. */

const NOTE = createVaultPath('Larkspur/Board.md');
const noOwner = () => null;

describe('attack-337: activeSidebarPageOf', () => {
  it('marks nothing for an empty tab', () => {
    expect(activeSidebarPageOf(null, noOwner)).toBeNull();
  });

  it('marks a note that no type owns as that note', () => {
    expect(activeSidebarPageOf({ kind: 'note', path: NOTE }, noOwner)).toEqual({
      kind: 'note',
      path: NOTE,
    });
  });

  it('marks a view note as the type that owns it', () => {
    const owner = (path: string) => (path === NOTE ? 'project' : null);
    expect(activeSidebarPageOf({ kind: 'note', path: NOTE }, owner)).toEqual({
      kind: 'type',
      name: 'project',
    });
  });

  it('does not consult the view owner for anything but a note', () => {
    let asked = 0;
    const owner = () => {
      asked += 1;
      return 'project';
    };
    activeSidebarPageOf({ kind: 'graph', scope: { kind: 'note', path: NOTE, depth: 1 } }, owner);
    activeSidebarPageOf({ kind: 'type', name: 'task' }, owner);
    expect(asked).toBe(0);
  });

  it('marks a type page as that type', () => {
    expect(activeSidebarPageOf({ kind: 'type', name: 'task' }, noOwner)).toEqual({
      kind: 'type',
      name: 'task',
    });
  });

  it('marks nothing for the query page', () => {
    expect(activeSidebarPageOf({ kind: 'query' }, noOwner)).toBeNull();
  });

  it.each([
    [{ kind: 'graph', scope: { kind: 'vault' } }, 'graph'],
    [{ kind: 'graph', scope: { kind: 'note', path: NOTE, depth: 2 } }, 'graph'],
    [{ kind: 'tags', tag: null }, 'tags'],
    [{ kind: 'tags', tag: 'harvest' }, 'tags'],
    [{ kind: 'archive' }, 'archive'],
    [{ kind: 'inbox' }, 'inbox'],
    [{ kind: 'review' }, 'review'],
    [{ kind: 'today' }, 'today'],
    [{ kind: 'automations' }, 'automations'],
    [{ kind: 'activity' }, 'activity'],
    [{ kind: 'templates' }, 'templates'],
    [{ kind: 'terms' }, 'terms'],
  ] as const)('marks %j as the bare %s page', (place, kind) => {
    expect(activeSidebarPageOf(place as NavigationPlace, noOwner)).toEqual({ kind });
  });
});
