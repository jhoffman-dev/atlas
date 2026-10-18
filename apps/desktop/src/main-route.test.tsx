// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { mainRoute } from './main-route.tsx';

type RouteArgs = Parameters<typeof mainRoute>[0];

// Pages that are closed are never drawn, so what they would be handed does not matter.
const unused = {} as never;

/** Every page closed but Terms, which loads on first use; nothing is preloaded here. */
function termsOpen(): RouteArgs {
  return {
    graph: { ...(unused as RouteArgs['graph']), scope: null },
    type: { ...(unused as RouteArgs['type']), table: { type: null } as RouteArgs['type']['table'] },
    query: { open: false, screen: unused },
    tags: { selected: undefined, screen: unused },
    archive: { open: false, page: unused },
    inbox: { open: false, page: unused },
    review: { open: false, page: unused },
    today: { open: false, page: unused },
    automations: { open: false, screen: unused },
    activity: { open: false, screen: unused },
    templates: { open: false, page: unused },
    terms: {
      open: true,
      page: {
        contents: { terms: [], conflicts: [], warnings: [] } as never,
        error: null,
        onAdd: vi.fn(),
        onEditVariants: vi.fn(),
        onOpen: vi.fn(),
      },
    },
    history: { back: 'Today', forward: null, onBack: vi.fn(), onForward: vi.fn() },
  };
}

describe('mainRoute', () => {
  it('draws a page that has not loaded yet in its frame, then the page in it', async () => {
    const { container } = render(<>{mainRoute(termsOpen())}</>);
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

  it('leaves the panes when no page is open', () => {
    const args = termsOpen();
    expect(mainRoute({ ...args, terms: { ...args.terms, open: false } })).toBeNull();
  });
});
