// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type PropertyDef, type PropertyKind } from '@atlas/domain';
import type { PropertyRow } from '../properties-panel.tsx';
import { PropertiesStrip } from '../peek/properties-strip.tsx';
import { PropertiesPane } from './properties-pane.tsx';

/**
 * Attack on PR #417 (slice 6a): the empty fold moved into `useEmptyFold`,
 * shared by the aside's pane and the peek's strip. Guards that the two still
 * fold the same rows, and that each holds its own switch.
 */

const row = (key: string, kind: PropertyKind, value: unknown): PropertyRow => ({
  def: {
    key,
    kind,
    label: key[0]!.toUpperCase() + key.slice(1),
    required: false,
    options: [],
    target: null,
    many: false,
  } satisfies PropertyDef,
  value,
  error: null,
});

/** Mulberry32: the same spread of rows on every run. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VALUES: readonly unknown[] = [null, '', '   ', [], 'Mara Quill', 0, false, ['Tobias Fenn']];

function spread(seed: number): readonly PropertyRow[] {
  const random = seeded(seed);
  return Array.from({ length: 12 }, (_, index) =>
    row(`p${index}`, 'text', VALUES[Math.floor(random() * VALUES.length)]),
  );
}

const PATH = createVaultPath('Tasks/Mend the greenhouse door.md');

function shownIn(container: HTMLElement): string[] {
  return within(container)
    .queryAllByRole('term')
    .map((term) => term.textContent ?? '');
}

describe('useEmptyFold attack-417: the aside and the strip agree', () => {
  it.each([1, 2, 3, 4, 5])('folds the same rows in both, seed %i', (seed) => {
    const rows = spread(seed);
    const pane = render(
      <PropertiesPane
        context="Task"
        title="Mend the greenhouse door"
        path={PATH}
        typeName="task"
        rows={rows}
        relationChoices={{}}
        onChange={vi.fn()}
      />,
    );
    const paneShown = shownIn(pane.container);
    pane.unmount();
    const strip = render(
      <PropertiesStrip
        path={PATH}
        typeName="task"
        rows={rows}
        relationChoices={{}}
        onChange={vi.fn()}
      />,
    );
    expect(shownIn(strip.container)).toEqual(paneShown);
  });

  it('unfolds the strip without unfolding the aside beside it', async () => {
    const rows = [
      row('owner', 'text', 'Mara Quill'),
      row('due', 'date', null),
      row('notes', 'text', null),
    ];
    render(
      <>
        <div data-testid="aside">
          <PropertiesPane
            context="Task"
            title="Mend the greenhouse door"
            path={PATH}
            typeName="task"
            rows={rows}
            relationChoices={{}}
            onChange={vi.fn()}
          />
        </div>
        <div data-testid="peek">
          <PropertiesStrip
            path={PATH}
            typeName="task"
            rows={rows}
            relationChoices={{}}
            onChange={vi.fn()}
          />
        </div>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: '+ 2 empty' }));
    expect(shownIn(screen.getByTestId('peek'))).toEqual(['Owner', 'Due', 'Notes']);
    expect(shownIn(screen.getByTestId('aside'))).toEqual(['Owner']);
    expect(screen.getByRole('button', { name: '2 empty properties' })).toBeDefined();
  });
});
