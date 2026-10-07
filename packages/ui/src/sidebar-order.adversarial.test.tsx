// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SidebarSectionId } from '@atlas/domain';
import { Sidebar } from './sidebar.tsx';
import type { SectionStore } from './sidebar-sections.ts';

/** The sidebar with Favorites shut (a common set-up: nothing starred yet) and its order held in state. */
function FavoritesShut() {
  const [order, setOrder] = useState<readonly SidebarSectionId[] | null>(null);
  const store: SectionStore = { read: () => ['favorites'], write: () => {} };
  return (
    <Sidebar
      favorites={[]}
      types={[]}
      views={[]}
      dashboards={[]}
      quick={[]}
      tree={{ rows: [], onToggleDirectory: () => {} }}
      active={null}
      sectionStore={store}
      sectionOrder={{ saved: order, onChange: setOrder }}
      onSearch={() => {}}
      onOpen={() => {}}
      onOpenType={() => {}}
      onToggleFavorite={() => {}}
    />
  );
}

const headings = () => screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent);

describe('Sidebar section order, adversarially', () => {
  it('does not send the last section to the top when Alt+Down is pressed on it', async () => {
    render(<FavoritesShut />);
    // A shut section keeps its place (ADR-0013, addendum).
    expect(headings()).toEqual(['Favorites', 'Types', 'Views', 'Dashboards', 'Pages']);

    screen.getByRole('button', { name: 'Move Pages' }).focus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    // Pages is already last; pressing ↓ must not move it up.
    expect(headings()).toEqual(['Favorites', 'Types', 'Views', 'Dashboards', 'Pages']);
  });
});
