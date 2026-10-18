// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { pageForPlace, type PageProps } from './main-route.tsx';

// Pages that are not drawn are never handed anything, so what they would be does not matter.
const unused = {} as never;

/** Every page's props, Terms the only one with real ones; nothing is preloaded here. */
function pages(): PageProps {
  return {
    graph: unused,
    type: { ...(unused as PageProps['type']), table: { type: null } as PageProps['type']['table'] },
    query: unused,
    tags: unused,
    archive: unused,
    inbox: unused,
    review: unused,
    today: unused,
    automations: unused,
    activity: unused,
    templates: unused,
    terms: {
      contents: { terms: [], conflicts: [], warnings: [] } as never,
      error: null,
      onAdd: vi.fn(),
      onEditVariants: vi.fn(),
      onOpen: vi.fn(),
    },
  };
}

const chrome = {
  history: { back: 'Today', forward: null, onBack: vi.fn(), onForward: vi.fn() },
};

describe('pageForPlace', () => {
  it('draws a page that has not loaded yet in its frame, then the page in it', async () => {
    const { container } = render(
      <>{pageForPlace({ place: { kind: 'terms' }, pages: pages(), chrome })}</>,
    );
    // The frame first: the bar with Back and Forward, over a body still loading.
    expect(screen.getByRole('group', { name: 'History' })).toBeDefined();
    expect(container.querySelector('.panel__body[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('.terms')).toBeNull();

    expect(
      await screen.findByRole('heading', { name: 'Terms' }, { timeout: 15_000 }),
    ).toBeDefined();
    expect(container.querySelector('.panel__body[aria-busy="true"]')).toBeNull();
    expect(screen.getByRole('group', { name: 'History' })).toBeDefined();
  }, 20_000);

  it('draws a type page only once its table is that type’s, keeping the frame till then', () => {
    const { container } = render(
      <>{pageForPlace({ place: { kind: 'type', name: 'task' }, pages: pages(), chrome })}</>,
    );
    expect(container.querySelector('.panel__body[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole('group', { name: 'History' })).toBeDefined();
  });
});
