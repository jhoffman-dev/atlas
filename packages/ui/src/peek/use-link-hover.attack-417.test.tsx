// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { HoverTimer } from './link-hover.ts';
import { useHoveredLink, useLinkHover } from './use-link-hover.ts';

/**
 * Attack on PR #417 (slice 6a): the link preview against a resized window, a
 * pointer that races across many links, and the things that must never
 * preview. (A link removed, or the note scrolled, under a still pointer is
 * covered in WebKit by gallery.peek.attack-417.spec.ts: the engine sends the
 * pointer events that jsdom does not.) Time is a hand-moved clock, never real.
 */

/** A clock the test moves by hand: `run(ms)` fires every wait due by then. */
function manualTimer() {
  let now = 0;
  let waits: { at: number; run: () => void; live: boolean }[] = [];
  const timer: HoverTimer = {
    start(run, ms) {
      const wait = { at: now + ms, run, live: true };
      waits.push(wait);
      return () => {
        wait.live = false;
      };
    },
  };
  const run = (ms: number) =>
    act(() => {
      now += ms;
      const due = waits.filter((wait) => wait.live && wait.at <= now);
      waits = waits.filter((wait) => !due.includes(wait));
      for (const wait of due) {
        wait.live = false;
        wait.run();
      }
    });
  const pending = () => waits.filter((wait) => wait.live).length;
  return { timer, run, pending };
}

const LINKS = Array.from({ length: 40 }, (_, index) => `Seed bed ${index + 1}`);

function Watched({ timer, label = 'hovered' }: { timer: HoverTimer; label?: string }) {
  const { watch, store } = useLinkHover(timer);
  const hovered = useHoveredLink(store);
  return (
    <>
      <div ref={watch} data-testid={`root-${label}`}>
        <p>
          {LINKS.map((link) => (
            <a key={link} className="wikilink" data-wikilink={link} href={`#${link}`}>
              {link}
            </a>
          ))}
        </p>
        <dl>
          <dt>Blocked by</dt>
          <dd>
            <button type="button" data-link-path="Tasks/Mend the greenhouse door.md">
              Mend the greenhouse door
            </button>{' '}
            and{' '}
            <a className="wikilink" data-wikilink="Order seed potatoes" href="#potatoes">
              Order seed potatoes
            </a>
          </dd>
        </dl>
        <a className="sidebar__row" href="#row" data-path="Tasks/Water the garden.md">
          Water the garden
        </a>
        <article className="board-card" data-path="Tasks/Prune the roses.md">
          <a className="board-card__title" href="#card">
            Prune the roses
          </a>
        </article>
        <span className="block-embed__name wikilink" role="link" data-wikilink="Tobias Fenn">
          Tobias Fenn
        </span>
      </div>
      <output aria-label={label}>{hovered === null ? '' : JSON.stringify(hovered)}</output>
    </>
  );
}

const shown = (label = 'hovered') => screen.getByLabelText(label).textContent ?? '';

describe('useLinkHover attack-417: the page moving under the card', () => {
  it('hides the card when the window is resized', () => {
    const clock = manualTimer();
    render(<Watched timer={clock.timer} />);
    fireEvent.pointerOver(screen.getByText('Seed bed 3'));
    clock.run(400);
    expect(shown()).not.toBe('');
    fireEvent(window, new Event('resize'));
    expect(shown()).toBe('');
  });
});

describe('useLinkHover attack-417: guards', () => {
  it('shows only the last of many links crossed quickly, once, with one wait at a time', () => {
    const clock = manualTimer();
    render(<Watched timer={clock.timer} />);
    for (const link of LINKS) {
      fireEvent.pointerOver(screen.getByText(link));
      expect(clock.pending()).toBe(1);
      clock.run(50);
    }
    expect(shown()).toBe('');
    clock.run(350);
    expect(JSON.parse(shown()).target).toEqual({ kind: 'link', link: 'Seed bed 40' });
  });

  it('keeps one wait for one link however often its children are entered', () => {
    const clock = manualTimer();
    render(<Watched timer={clock.timer} />);
    const link = screen.getByText('Seed bed 7');
    for (let i = 0; i < 20; i += 1) {
      fireEvent.pointerOver(link);
      clock.run(10);
    }
    expect(clock.pending()).toBe(1);
    clock.run(200);
    expect(JSON.parse(shown()).target).toEqual({ kind: 'link', link: 'Seed bed 7' });
  });

  it('tells a relation value from the wikilink beside it', () => {
    const clock = manualTimer();
    render(<Watched timer={clock.timer} />);
    fireEvent.pointerOver(screen.getByRole('button', { name: 'Mend the greenhouse door' }));
    clock.run(400);
    expect(JSON.parse(shown()).target).toEqual({
      kind: 'note',
      path: 'Tasks/Mend the greenhouse door.md',
    });
    fireEvent.pointerOver(screen.getByText('Order seed potatoes'));
    expect(shown()).toBe('');
    clock.run(400);
    expect(JSON.parse(shown()).target).toEqual({ kind: 'link', link: 'Order seed potatoes' });
  });

  it.each(['Water the garden', 'Prune the roses', 'Tobias Fenn'])(
    'never previews a sidebar row, a board card or an embed source: %s',
    (text) => {
      const clock = manualTimer();
      render(<Watched timer={clock.timer} />);
      fireEvent.pointerOver(screen.getByText(text));
      clock.run(1000);
      expect(shown()).toBe('');
      expect(clock.pending()).toBe(0);
    },
  );

  it('races two watched panes to one card: leaving one for the other hides the first', () => {
    const clock = manualTimer();
    render(
      <>
        <Watched timer={clock.timer} label="left" />
        <Watched timer={clock.timer} label="right" />
      </>,
    );
    const [left, right] = screen.getAllByText('Seed bed 1');
    fireEvent.pointerOver(left!);
    clock.run(200);
    fireEvent.pointerOut(left!, { relatedTarget: right });
    fireEvent.pointerOver(right!);
    clock.run(400);
    expect(shown('left')).toBe('');
    expect(JSON.parse(shown('right')).target).toEqual({ kind: 'link', link: 'Seed bed 1' });
  });

  it('stops listening for keys once the card is gone', () => {
    const clock = manualTimer();
    const { unmount } = render(<Watched timer={clock.timer} />);
    fireEvent.pointerOver(screen.getByText('Seed bed 2'));
    unmount();
    expect(clock.pending()).toBe(0);
    expect(() => fireEvent.keyDown(document.body, { key: 'a' })).not.toThrow();
  });
});
