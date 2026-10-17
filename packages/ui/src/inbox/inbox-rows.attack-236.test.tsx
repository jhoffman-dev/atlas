// @vitest-environment jsdom
/** Adversarial pass on #236: the Inbox rows' steady callbacks and memo, over every row. */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createVaultPath, type InboxItem } from '@atlas/domain';
import { InboxPage, type InboxPageProps } from '../inbox-page.tsx';
import { startCountingRenders, stopCountingRenders } from '../testing/render-counter.ts';

// Before React loads, so every commit is handed to the counter.
await vi.hoisted(async () => {
  const { installRenderCounter } = await import('../testing/render-counter.ts');
  installRenderCounter();
});

const note = (title: string): InboxItem => ({
  path: createVaultPath(`Inbox/${title}.md`),
  title,
  type: 'meeting',
  arrivedIn: '',
  importOutcome: null,
  importError: null,
  task: null,
});
const NOTES = [
  'Larkspur sync',
  'Ledger review',
  'Payroll dry run',
  'Quarter close',
  'Tobias Fenn call',
].map(note);
const FILING = [{ path: 'Projects/Atlas.md', title: 'Atlas' }];
const PEOPLE = [{ path: 'People/Mara Quill.md', title: 'Mara Quill' }];

function given(
  items: readonly InboxItem[],
  onClarify: InboxPageProps['onClarify'] = vi.fn(async () => true),
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
  } as InboxPageProps;
}

const fileUnderAtlas = (title: string) =>
  fireEvent.change(screen.getByRole('combobox', { name: `File ${title} under` }), {
    target: { value: 'Projects/Atlas.md' },
  });

describe('InboxRows — deciding any one row (#236)', () => {
  it('draws at most the one row focus moves to, whichever row of N is decided', async () => {
    const drawn: Record<string, number> = {};
    for (const decided of NOTES) {
      const view = render(<InboxPage {...given(NOTES)} />);
      startCountingRenders();
      fileUnderAtlas(decided.title);
      await act(async () => {});
      const rest = NOTES.filter((each) => each !== decided);
      view.rerender(<InboxPage {...given(rest)} />);
      drawn[decided.title] = stopCountingRenders().renders['InboxRow'] ?? 0;
      view.unmount();
    }

    expect(drawn).toEqual(Object.fromEntries(NOTES.map((each) => [each.title, 1])));
  });

  it('decides two rows in quick succession, each for its own note, before the app reads again', async () => {
    const onClarify = vi.fn<(asked: { path: string }) => Promise<boolean>>(async () => true);
    render(<InboxPage {...given(NOTES, onClarify)} />);
    fileUnderAtlas('Larkspur sync');
    fileUnderAtlas('Ledger review');
    await act(async () => {});

    expect(onClarify.mock.calls.map(([asked]) => asked.path)).toEqual([
      NOTES[0]!.path,
      NOTES[1]!.path,
    ]);
  });
});
