// @vitest-environment jsdom
/**
 * Adversarial pass on #247 (Performance B, #238): the Inbox's rows are
 * virtualised, so a row that is scrolled away is not in the DOM. Deciding a
 * row must still hand the focus to the next one however far the page has
 * been scrolled, as it did when every row was in the page.
 *
 * jsdom lays nothing out and cannot scroll: the page's scroller is given a
 * `scrollTop` and a scroll event, which is all the virtualiser reads.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createVaultPath, type InboxItem } from '@atlas/domain';
import { InboxPage, type InboxPageProps } from '../inbox-page.tsx';

const note = (title: string): InboxItem => ({
  path: createVaultPath(`Inbox/${title}.md`),
  title,
  type: 'meeting',
  arrivedIn: '',
  importOutcome: null,
  importError: null,
  task: null,
});

const notes = (count: number) => Array.from({ length: count }, (_, at) => note(`Note ${at}`));

const FILING = [{ path: 'Projects/Atlas.md', title: 'Atlas' }];
const PEOPLE = [{ path: 'People/Mara Quill.md', title: 'Mara Quill' }];

function given(
  items: readonly InboxItem[],
  onClarify: InboxPageProps['onClarify'],
): InboxPageProps {
  return {
    contents: { items: [...items], truncated: false, total: items.length },
    error: null,
    filing: FILING,
    people: PEOPLE,
    onOpen: vi.fn(),
    onShowMore: vi.fn(),
    onClarify,
    busy: false,
    problem: null,
  };
}

/** Scrolls the page the list is in, as far as the virtualiser can tell. */
function scrollPageTo(top: number) {
  const scroller = document.querySelector<HTMLElement>('.panel__body');
  if (scroller === null) throw new Error('no scroller');
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, writable: true, value: top });
  act(() => {
    fireEvent.scroll(scroller);
  });
}

describe('InboxRows — deciding a row while the page is scrolled (#247 attack)', () => {
  it('moves the focus to the next row when the decided row was scrolled away while its write ran', async () => {
    const items = notes(500);
    let finish: (done: boolean) => void = () => {};
    const onClarify = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<InboxPage {...given(items, onClarify)} />);
    const picker = screen.getByRole('combobox', { name: 'File Note 3 under' });
    picker.focus();

    // Filed from the keyboard; the app takes the row out at once (`writes.leave`)
    // and the write runs on. Meanwhile the person scrolls far down the list.
    fireEvent.change(picker, { target: { value: 'Projects/Atlas.md' } });
    expect(onClarify).toHaveBeenCalledTimes(1);
    view.rerender(
      <InboxPage
        {...given(
          items.filter((_, at) => at !== 3),
          onClarify,
        )}
      />,
    );
    scrollPageTo(200_000);
    await act(async () => finish(true));

    // On main every row was in the page, so focus went to Note 4's row.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.closest('tr')?.textContent).toContain('Note 4');
  });

  it('moves the focus to the next row when a focused row far from the screen is decided', async () => {
    const items = notes(500);
    let finish: (done: boolean) => void = () => {};
    const onClarify = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<InboxPage {...given(items, onClarify)} />);
    const picker = screen.getByRole('combobox', { name: 'File Note 3 under' });
    picker.focus();
    // Scrolled away with the wheel: the focused row is kept in the page.
    scrollPageTo(200_000);
    expect(screen.getByRole('combobox', { name: 'File Note 3 under' })).toBe(picker);

    fireEvent.change(picker, { target: { value: 'Projects/Atlas.md' } });
    view.rerender(
      <InboxPage
        {...given(
          items.filter((_, at) => at !== 3),
          onClarify,
        )}
      />,
    );
    await act(async () => finish(true));

    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.closest('tr')?.textContent).toContain('Note 4');
  });
});
