// @vitest-environment jsdom
/**
 * The metadata line (#297) under the render discipline of #260/#274: a board
 * drawn again with nothing changed draws no card face and no metadata line.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { noteNames, type BoardColumn, type BoardRow, type VaultPath } from '@atlas/domain';
import { BoardView } from './board-view.tsx';
import { NoteNamesProvider } from './note-names.tsx';
import { startCountingRenders, stopCountingRenders } from './testing/render-counter.ts';

await vi.hoisted(async () => {
  const { installRenderCounter } = await import('./testing/render-counter.ts');
  installRenderCounter();
});

const row = (at: number, status: string): BoardRow => ({
  path: `t${at}.md`,
  title: `Task ${at}`,
  values: { status, stage: 'next-action', project: '[[Here]]', phase: at, due: '2026-10-20' },
});

const COLUMNS: BoardColumn[] = ['backlog', 'doing'].map((value, column) => ({
  value,
  label: value,
  rows: Array.from({ length: 3 }, (_, at) => row(column * 3 + at, value)),
}));

const NAMES = noteNames([{ path: 'Here.md' as VaultPath, title: 'Here' }]);

function board() {
  return (
    <NoteNamesProvider value={NAMES}>
      <BoardView
        columns={COLUMNS}
        groupBy="status"
        fields={['status', 'stage', 'project', 'phase', 'due']}
        kinds={{ status: 'select', stage: 'select', project: 'relation', due: 'date' }}
        onOpenNote={() => {}}
        onMoveCard={() => {}}
        onAddCard={() => {}}
      />
    </NoteNamesProvider>
  );
}

describe('the metadata line under an unchanged rerender (#297)', () => {
  it('draws no card face and no metadata line again', () => {
    const view = render(board());
    expect(screen.getAllByText(/Next Action/).length).toBe(6);

    startCountingRenders();
    view.rerender(board());
    const { renders } = stopCountingRenders();

    expect(renders['CardFace'] ?? 0).toBe(0);
    expect(renders['CardMetaLine'] ?? 0).toBe(0);
  });
});
