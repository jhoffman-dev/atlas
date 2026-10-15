// @vitest-environment jsdom
/** The Inbox's rows (#112), drawn again only when what they show has changed (#217). */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createVaultPath, type InboxItem, type InboxTask } from '@atlas/domain';
import { InboxPage, type InboxPageProps } from '../inbox-page.tsx';

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
