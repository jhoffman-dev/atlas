// @vitest-environment jsdom
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useHoveredLink, useLinkHover, type HoveredLinkStore } from './use-link-hover.ts';

let renders = 0;
const counted = () => {
  renders += 1;
};

function Host() {
  return (
    <Profiler id="host" onRender={counted}>
      <Hovering />
    </Profiler>
  );
}

function Hovering() {
  const { watch, store } = useLinkHover();
  const hovered = useHoveredLink(store);
  return (
    <>
      <div ref={watch}>
        <p>
          Done in{' '}
          <a className="wikilink" data-wikilink="P16-04" href="#P16-04">
            <span>P16-04</span>
          </a>{' '}
          and blocked by{' '}
          <button type="button" data-link-path="Tasks/A15-02.md">
            A15-02
          </button>
          .
        </p>
        <a className="sidebar__row" href="#card">
          A card
        </a>
      </div>
      <output aria-label="hovered">{hovered === null ? '' : JSON.stringify(hovered.target)}</output>
    </>
  );
}

/** A watched element that mounts after the hook does, as a peek's body does. */
function LateHost({ open }: { open: boolean }) {
  const { watch, store } = useLinkHover();
  const hovered = useHoveredLink(store);
  return (
    <>
      {open && (
        <div ref={watch}>
          <a className="wikilink" data-wikilink="P16-04" href="#P16-04">
            P16-04
          </a>
        </div>
      )}
      <output aria-label="hovered">{hovered === null ? '' : JSON.stringify(hovered.target)}</output>
    </>
  );
}

const hovered = () => screen.getByLabelText('hovered').textContent;
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('useLinkHover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    renders = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('previews a wikilink after 400 ms, by its target as written, and not after 399', async () => {
    render(<Host />);
    fireEvent.pointerOver(screen.getByText('P16-04'));
    await wait(399);
    expect(hovered()).toBe('');
    await wait(1);
    expect(JSON.parse(hovered()!)).toEqual({ kind: 'link', link: 'P16-04' });
  });

  it('previews a relation value by the note it links', async () => {
    render(<Host />);
    fireEvent.pointerOver(screen.getByRole('button', { name: 'A15-02' }));
    await wait(400);
    expect(JSON.parse(hovered()!)).toEqual({ kind: 'note', path: 'Tasks/A15-02.md' });
  });

  it('previews nothing else under the container', async () => {
    render(<Host />);
    fireEvent.pointerOver(screen.getByText('A card'));
    await wait(1000);
    expect(hovered()).toBe('');
  });

  it('hides the card when the pointer leaves the link', async () => {
    render(<Host />);
    fireEvent.pointerOver(screen.getByText('P16-04'));
    await wait(400);
    expect(hovered()).not.toBe('');
    fireEvent.pointerOver(screen.getByText(/Done in/));
    expect(hovered()).toBe('');
  });

  it('hides the card when the pointer leaves the container altogether', async () => {
    render(<Host />);
    fireEvent.pointerOver(screen.getByText('P16-04'));
    await wait(400);
    fireEvent.pointerOut(screen.getByText('P16-04'), { relatedTarget: document.body });
    expect(hovered()).toBe('');
  });

  it('hides the card on a key, and on a press', async () => {
    render(<Host />);
    const link = screen.getByText('P16-04');
    fireEvent.pointerOver(link);
    await wait(400);
    // Wherever the focus is: here, on the page around it.
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(hovered()).toBe('');
    fireEvent.pointerOver(screen.getByRole('button', { name: 'A15-02' }));
    await wait(400);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'A15-02' }));
    expect(hovered()).toBe('');
  });

  it('renders nothing while the pointer moves without a card being due', async () => {
    render(<Host />);
    const settled = renders;
    fireEvent.pointerOver(screen.getByText(/Done in/));
    fireEvent.pointerOver(screen.getByText('P16-04'));
    fireEvent.pointerOver(screen.getByText('P16-04'));
    await wait(399);
    fireEvent.pointerOver(screen.getByText(/Done in/));
    await wait(1000);
    expect(renders).toBe(settled);
  });

  it('watches an element that mounts after it, and stops when it goes', async () => {
    const { rerender } = render(<LateHost open={false} />);
    rerender(<LateHost open />);
    const link = screen.getByText('P16-04');
    fireEvent.pointerOver(link);
    await wait(400);
    expect(JSON.parse(hovered()!)).toEqual({ kind: 'link', link: 'P16-04' });
    rerender(<LateHost open={false} />);
    expect(hovered()).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('re-renders only the card that reads the hovered link, not the page holding the links', async () => {
    const pageRenders = vi.fn();
    const cardRenders = vi.fn();
    function Card({ store }: { store: HoveredLinkStore }) {
      const link = useHoveredLink(store);
      cardRenders();
      return <output aria-label="card">{link === null ? '' : 'shown'}</output>;
    }
    function Page() {
      const { watch, store } = useLinkHover();
      pageRenders();
      return (
        <>
          <div ref={watch}>
            <a className="wikilink" data-wikilink="P16-04" href="#P16-04">
              P16-04
            </a>
          </div>
          <Card store={store} />
        </>
      );
    }
    render(<Page />);
    const [pages, cards] = [pageRenders.mock.calls.length, cardRenders.mock.calls.length];
    fireEvent.pointerOver(screen.getByText('P16-04'));
    await wait(400);
    expect(screen.getByLabelText('card').textContent).toBe('shown');
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(screen.getByLabelText('card').textContent).toBe('');
    expect(pageRenders).toHaveBeenCalledTimes(pages);
    expect(cardRenders.mock.calls.length).toBe(cards + 2);
  });
});
