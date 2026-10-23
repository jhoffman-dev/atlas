// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { citeAnswer, uncitedCount } from '@dfai/domain';
import { AskPage, type AskPageProps } from './ask-page.tsx';
import type { AskActions, AskAnswerView, AskState } from './ask-view.ts';

afterEach(cleanup);

function actions(): AskActions & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onSend: vi.fn(),
    onStop: vi.fn(),
    onRetry: vi.fn(),
    onNewChat: vi.fn(),
    onAccept: vi.fn(),
    onReject: vi.fn(),
    onUndo: vi.fn(),
    onCopy: vi.fn(),
    onPickRecent: vi.fn(),
    onFollowCitation: vi.fn(),
    onOpenWeb: vi.fn(),
    onFollowLink: vi.fn(),
  };
}

const answer = (text: string, checked = true): AskAnswerView => {
  const blocks = citeAnswer(text);
  return { kind: 'answer', id: 'a1', text, blocks, uncited: uncitedCount(blocks), checked };
};

const IDLE: AskState = { entries: [], busy: false, error: null, notice: null };

const BASE = {
  model: 'claude-opus-5-5',
  problem: null,
  recent: [],
  recentProblem: null,
  focusRequest: null,
  loadImage: async () => null,
} as const;

function page(state: Partial<AskState> = {}, extra: Partial<AskPageProps> = {}) {
  const handlers = actions();
  const draft = { text: '', onChange: vi.fn() };
  const onFocusTaken = vi.fn();
  const props = (more: Partial<AskPageProps> = {}): AskPageProps => ({
    ...BASE,
    state: { ...IDLE, ...state },
    draft,
    actions: handlers,
    onFocusTaken,
    ...extra,
    ...more,
  });
  const { rerender } = render(<AskPage {...props()} />);
  return {
    handlers,
    draft,
    onFocusTaken,
    rerender: (more: Partial<AskPageProps>) => rerender(<AskPage {...props(more)} />),
  };
}

const asked = (text: string, checked = true): Partial<AskState> => ({
  entries: [{ kind: 'user', id: 'u1', text: 'What does Mara want?' }, answer(text, checked)],
});

describe('AskPage before a question', () => {
  it('offers a big box, leaves the keys where they are unasked, and lists the recent questions', async () => {
    const { handlers } = page(
      {},
      {
        recent: [
          { path: 'Chats/What is open for Larkspur.md', title: 'What is open for Larkspur' },
          { path: 'Chats/Brief me on Mara.md', title: 'Brief me on Mara' },
        ],
      },
    );
    const box = screen.getByRole('textbox', { name: 'Ask Claude' });
    // A tab brought back at launch, or in the pane not worked in, takes no keys (#547).
    expect(document.activeElement).not.toBe(box);
    expect(box.getAttribute('rows')).toBe('4');

    const recent = screen.getByRole('navigation', { name: 'Recent questions' });
    expect(
      within(recent)
        .getAllByRole('button')
        .map((row) => row.textContent),
    ).toEqual(['What is open for Larkspur', 'Brief me on Mara']);
    await userEvent.click(within(recent).getByRole('button', { name: 'Brief me on Mara' }));
    expect(handlers.onPickRecent).toHaveBeenCalledWith('Chats/Brief me on Mara.md');
  });

  it('shows no recent list while it is read, nor when there are none', () => {
    page({}, { recent: null });
    expect(screen.queryByRole('navigation', { name: 'Recent questions' })).toBeNull();
  });

  it('says why Claude cannot be reached', () => {
    page({}, { problem: { message: 'Claude Code is not logged in.', fix: 'claude auth login' } });
    expect(screen.getByRole('alert').textContent).toContain('Claude Code is not logged in.');
  });
});

describe('AskPage and the keys (#547)', () => {
  it('takes the keys when asked, once per request, and says it took them', () => {
    const { onFocusTaken, rerender } = page();
    const box = screen.getByRole('textbox', { name: 'Ask Claude' });
    expect(onFocusTaken).not.toHaveBeenCalled();
    rerender({ focusRequest: 1 });
    expect(document.activeElement).toBe(box);
    expect(onFocusTaken).toHaveBeenCalledTimes(1);
    box.blur();
    rerender({ focusRequest: 1 });
    expect(document.activeElement).not.toBe(box);
    rerender({ focusRequest: 2 });
    expect(document.activeElement).toBe(box);
  });

  it('takes the keys on mount only when it was asked to', () => {
    page({}, { focusRequest: 7 });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Ask Claude' }));
  });

  it('keeps the same box, and its keys, as the first question turns the start into a conversation', () => {
    const { rerender } = page();
    const box = screen.getByRole('textbox', { name: 'Ask Claude' });
    box.focus();
    rerender({ state: { ...IDLE, ...asked('Hi [[A]]') } });
    expect(screen.getByRole('textbox', { name: 'Ask Claude' })).toBe(box);
    expect(document.activeElement).toBe(box);
  });

  it('puts the keys in the box for a new question', async () => {
    const { handlers } = page(asked('Hi [[A]]'));
    await userEvent.click(screen.getByRole('button', { name: 'New question' }));
    expect(handlers.onNewChat).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Ask Claude' }));
  });

  it('says why the recent questions could not be read or opened', () => {
    page({}, { recentProblem: 'That chat could not be opened: gone' });
    expect(screen.getByRole('alert').textContent).toBe('That chat could not be opened: gone');
  });
});

describe('AskPage answers', () => {
  it('names the kind of block not cited in the foot', () => {
    page(asked('- One\n- Two\n- Three [[A]]'));
    expect(screen.getByText('2 list items not cited')).toBeDefined();
  });

  it('draws a list in a quote inside the quote, marking the item that cites nothing', () => {
    page(asked('> Said:\n> - One [[A]]\n> - Two'));
    const quote = screen.getByRole('region', { name: 'Answer' }).querySelector('blockquote');
    expect(quote?.querySelectorAll('li')).toHaveLength(2);
    expect(quote?.querySelectorAll('[data-uncited]')).toHaveLength(1);
  });

  it('draws a citation as a chip that follows its link, ⌘-click in a new tab', async () => {
    const { handlers } = page(asked('Mara wants a rollback plan [[Kickoff#^t0003]].'));
    const cite = screen.getByRole('button', { name: 'Kickoff' });
    expect(cite.getAttribute('data-hue')).toBe('blue');
    await userEvent.click(cite);
    expect(handlers.onFollowCitation).toHaveBeenLastCalledWith('[[Kickoff#^t0003]]', 'here');
    fireEvent.click(cite, { metaKey: true });
    expect(handlers.onFollowCitation).toHaveBeenLastCalledWith('[[Kickoff#^t0003]]', 'new-tab');
  });

  it('marks the paragraph that cites nothing, and keeps its words', () => {
    page(asked('Cited [[Kickoff#^t0003]].\n\nShe is probably worried.'));
    const reply = screen.getByRole('region', { name: 'Answer' });
    const marked = reply.querySelectorAll('[data-uncited]');
    expect(marked).toHaveLength(1);
    expect(marked[0]?.textContent).toBe('She is probably worried.not cited');
    expect(within(reply).getAllByText('not cited')).toHaveLength(1);
    expect(within(reply).getByText('1 paragraph not cited')).toBeDefined();
  });

  it('counts more than one uncited paragraph', () => {
    page(asked('One.\n\n- Two\n- Three [[A]]'));
    expect(screen.getByText('2 parts not cited')).toBeDefined();
    expect(screen.getAllByText('not cited')).toHaveLength(2);
  });

  it('marks nothing on an answer still arriving', () => {
    page({ ...asked('Partly written', false), busy: true });
    const reply = screen.getByRole('region', { name: 'Answer' });
    expect(within(reply).getByText('Partly written')).toBeDefined();
    expect(reply.querySelectorAll('[data-uncited]')).toHaveLength(0);
    expect(screen.queryByText('not cited')).toBeNull();
  });

  it('never draws the answer as HTML', () => {
    page(asked('<img src=x onerror=alert(1)> <b>bold</b> [[A]]'));
    const reply = screen.getByRole('region', { name: 'Answer' });
    expect(reply.querySelector('img')).toBeNull();
    expect(reply.querySelector('b')).toBeNull();
    expect(reply.textContent).toContain('<img src=x onerror=alert(1)> <b>bold</b>');
  });

  it('opens an https link in the browser, and leaves any other link as text', async () => {
    const { handlers } = page(
      asked('[spec](https://example.com/spec) and [run](javascript:alert(1)) [[A]]'),
    );
    const links = screen.getAllByRole('link');
    // The host the link opens is shown beside a label that does not name it (#547).
    expect(links.map((link) => link.textContent)).toEqual(['spec (example.com)']);
    await userEvent.click(links[0] as HTMLElement);
    expect(handlers.onOpenWeb).toHaveBeenCalledWith('https://example.com/spec');
    expect(screen.getByRole('region', { name: 'Answer' }).textContent).toContain(
      '[run](javascript:alert(1))',
    );
  });

  it('draws code as code, its link not a citation', () => {
    page(asked('```\n[[Kickoff]]\n```'));
    const reply = screen.getByRole('region', { name: 'Answer' });
    expect(reply.querySelector('pre code')?.textContent).toBe('[[Kickoff]]');
    expect(within(reply).queryByRole('button', { name: 'Kickoff' })).toBeNull();
  });

  it('draws headings, quotes and lists, numbers as written', () => {
    page(asked('## Open loops\n\n> Said [[K]]\n\n1. First [[A]]\n2. Second [[B]]'));
    const reply = screen.getByRole('region', { name: 'Answer' });
    expect(within(reply).getByRole('heading', { name: 'Open loops' })).toBeDefined();
    expect(reply.querySelector('blockquote')?.textContent).toContain('Said');
    expect(
      within(reply)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['1.First A', '2.Second B']);
  });

  it('copies the answer as written, and asks again from the last one', async () => {
    const { handlers } = page(asked('Hi [[A]]'));
    await userEvent.click(screen.getByRole('button', { name: 'Copy answer' }));
    expect(handlers.onCopy).toHaveBeenCalledWith('Hi [[A]]');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(handlers.onRetry).toHaveBeenCalledTimes(1);
  });

  it('sends the next question from the box under the conversation, and starts afresh from the bar', async () => {
    const draft = { text: 'And Tobias?', onChange: vi.fn() };
    const { handlers } = page(asked('Hi [[A]]'), { draft });
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(handlers.onSend).toHaveBeenCalledWith('And Tobias?');
    await userEvent.click(screen.getByRole('button', { name: 'New question' }));
    expect(handlers.onNewChat).toHaveBeenCalledTimes(1);
  });

  it('shows the tool calls the answer was found with', () => {
    page({
      entries: [
        { kind: 'user', id: 'u1', text: 'Brief me' },
        { kind: 'tool', id: 't1', label: 'Briefed on Mara Quill', state: 'done', detail: null },
      ],
    });
    expect(screen.getByText('Briefed on Mara Quill')).toBeDefined();
  });
});
