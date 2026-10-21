// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type InboxItem, type InboxTask } from '@dfai/domain';
import { InboxPage, type InboxContents, type InboxPageProps } from './inbox-page.tsx';

const CAPTURED: InboxTask = {
  status: 'inbox',
  project: null,
  waitingOn: null,
  waitingOnNames: '',
  defer: null,
  due: null,
};

const TITLES = ['Call the bank', 'Chase the quote', 'Learn the cello', 'Renew the passport'];

const task = (title: string): InboxItem => ({
  path: createVaultPath(`Inbox/${title}.md`),
  title,
  type: 'task',
  arrivedIn: '',
  importOutcome: null,
  importError: null,
  task: CAPTURED,
});

const listOf = (titles: readonly string[]): InboxContents => ({
  items: titles.map(task),
  truncated: false,
  total: titles.length,
});

function page(overrides: Partial<InboxPageProps> = {}) {
  const props: InboxPageProps = {
    contents: listOf(TITLES),
    error: null,
    filing: [],
    people: [],
    onOpen: vi.fn(),
    onShowMore: vi.fn(),
    onClarify: vi.fn(() => new Promise<boolean>(() => {})),
    busy: false,
    problem: null,
    ...overrides,
  };
  const view = render(<InboxPage {...props} />);
  return {
    ...props,
    rerender: (next: Partial<InboxPageProps>) => view.rerender(<InboxPage {...props} {...next} />),
  };
}

const rowOf = (title: string) =>
  screen.getByRole('button', { name: title }).closest('tr') as HTMLElement;

describe('InboxPage attack #423 — the focus follows only the row that just left', () => {
  it('does not pull the focus onto a row when an unrelated change arrives long after the focused row left while the focus was elsewhere', () => {
    const view = page();
    act(() => rowOf('Learn the cello').focus());

    // The person moves to another pane (a note's properties, say) and the
    // row leaves the Inbox from there: the focus rightly stays where it is.
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    act(() => elsewhere.focus());
    view.rerender({ contents: listOf(TITLES.filter((title) => title !== 'Learn the cello')) });
    expect(document.activeElement).toBe(elsewhere);

    // That pane closes: the focus falls to the page. Nothing was triaged.
    act(() => elsewhere.remove());
    expect(document.activeElement).toBe(document.body);

    // Minutes later, a capture from another program lands in the Inbox.
    view.rerender({
      contents: listOf([...TITLES.filter((title) => title !== 'Learn the cello'), 'Buy stamps']),
    });

    // The row that left did so long ago: no row should take the focus, or the
    // next letter typed triages a row the person never chose.
    expect(document.activeElement).toBe(document.body);
  });

  it('a key typed after that unrelated change does not triage the top row', async () => {
    const onClarify = vi.fn(() => new Promise<boolean>(() => {}));
    const view = page({ onClarify });
    act(() => rowOf('Learn the cello').focus());
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    act(() => elsewhere.focus());
    view.rerender({ contents: listOf(TITLES.filter((title) => title !== 'Learn the cello')) });
    act(() => elsewhere.remove());
    view.rerender({
      contents: listOf([...TITLES.filter((title) => title !== 'Learn the cello'), 'Buy stamps']),
    });

    await userEvent.keyboard('d');
    expect(onClarify).not.toHaveBeenCalled();
  });
});
