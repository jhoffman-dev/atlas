// @vitest-environment jsdom
/** The Inbox's rows (#112), drawn again only when what they show has changed (#217). */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createVaultPath, type InboxItem, type InboxTask } from '@atlas/domain';
import { InboxPage, type InboxPageProps } from '../inbox-page.tsx';
import { startCountingRenders, stopCountingRenders } from '../testing/render-counter.ts';

// Before React loads, so every commit is handed to the counter.
await vi.hoisted(async () => {
  const { installRenderCounter } = await import('../testing/render-counter.ts');
  installRenderCounter();
});

const task = (
  status: InboxTask['status'],
  title = 'Call Mara Quill',
  due: string | null = null,
): InboxItem => ({
  path: createVaultPath('Inbox/Call Mara Quill.md'),
  title,
  type: 'task',
  arrivedIn: '',
  importOutcome: null,
  importError: null,
  task: { status, project: null, waitingOn: null, waitingOnNames: '', defer: null, due },
});

function props(items: InboxItem[]): InboxPageProps {
  return {
    contents: { items, truncated: false, total: items.length },
    error: null,
    filing: [],
    people: [],
    onOpen: vi.fn(),
    onShowMore: vi.fn(),
    onClarify: vi.fn(async () => true),
    busy: false,
    problem: null,
  } as InboxPageProps;
}

const statusOf = (title: string) =>
  (screen.getByRole('combobox', { name: `Status of ${title}` }) as HTMLSelectElement).value;

describe('InboxRows — a row kept from the last render (#217)', () => {
  it('is drawn again once its note has changed on disk', () => {
    const view = render(<InboxPage {...props([task('inbox')])} />);
    expect(statusOf('Call Mara Quill')).toBe('inbox');
    view.rerender(<InboxPage {...props([task('someday', 'Call Mara Quill', '2026-11-01')])} />);
    expect(statusOf('Call Mara Quill')).toBe('someday');
    view.rerender(<InboxPage {...props([task('someday', 'Call Mara Quill again')])} />);
    expect(screen.getByRole('button', { name: 'Call Mara Quill again' })).toBeDefined();
  });

  it('shows a refusal said of it although its note did not change', () => {
    const items = [task('inbox')];
    const view = render(<InboxPage {...props(items)} />);
    view.rerender(
      <InboxPage
        {...props(items)}
        refusals={[{ path: items[0]!.path, reason: 'the disk is full' }]}
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('the disk is full');
  });
});

describe('InboxRows — a meeting whose summary still waits (#186)', () => {
  const meeting: InboxItem = {
    path: createVaultPath('Meetings/2026/10/2026-10-14 Larkspur Payroll sync.md'),
    title: '2026-10-14 Larkspur Payroll sync',
    type: 'meeting',
    arrivedIn: '',
    importOutcome: 'imported',
    importError: null,
    task: null,
  };

  it('says on its row that the summary is pending, and why', () => {
    const why = 'Claude Code is not logged in. Fix: run claude /login';
    render(<InboxPage {...props([meeting])} summaryPending={new Map([[meeting.path, why]])} />);
    expect(screen.getByText(`Summary pending: ${why}`)).toBeDefined();
  });

  it('says nothing of a summary for a meeting that waits for none', () => {
    const view = render(<InboxPage {...props([meeting])} summaryPending={new Map()} />);
    expect(screen.getByRole('button', { name: meeting.title })).toBeDefined();
    expect(view.container.textContent).not.toContain('Summary pending');
  });
});

describe('InboxRows — deciding one row (#217)', () => {
  const note = (title: string): InboxItem => ({
    path: createVaultPath(`Inbox/${title}.md`),
    title,
    type: 'meeting',
    arrivedIn: '',
    importOutcome: null,
    importError: null,
    task: null,
  });
  const NOTES = ['Larkspur sync', 'Ledger review', 'Payroll dry run', 'Quarter close'].map(note);
  // Kept the same lists while they say the same, as the app keeps them.
  const FILING = [{ path: 'Projects/Atlas.md', title: 'Atlas' }];
  const PEOPLE = [{ path: 'People/Mara Quill.md', title: 'Mara Quill' }];

  /** The page as the app hands it over: callbacks made again on every render of the app. */
  const given = (items: readonly InboxItem[]): InboxPageProps => ({
    ...props([...items]),
    filing: FILING,
    people: PEOPLE,
    onOpen: vi.fn(),
    onClarify: vi.fn(async () => true),
  });

  it('draws no row again, though the app hands over new callbacks and focus moves on', async () => {
    const view = render(<InboxPage {...given(NOTES)} />);
    startCountingRenders();
    fireEvent.change(screen.getByRole('combobox', { name: 'File Larkspur sync under' }), {
      target: { value: 'Projects/Atlas.md' },
    });
    // The write lands; the app renders again, the filed row gone and every callback new.
    await act(async () => {});
    view.rerender(<InboxPage {...given(NOTES.slice(1))} />);
    view.rerender(<InboxPage {...given(NOTES.slice(1))} />);
    const { renders } = stopCountingRenders();

    expect(document.activeElement?.textContent).toContain('Ledger review');
    // Not even the row the focus moved to: its highlight is on the row the list
    // places (#238), and the cells inside it are what each row costs to draw.
    expect(renders['InboxRow'] ?? 0).toBe(0);
  });
});
