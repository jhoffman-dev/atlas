// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ParaMigration, type ParaMigrationProps } from './para-migration.tsx';

/** #213: the move onto the Project type is offered in a line, previewed in full, and run only when asked. */
const PREVIEW: ParaMigrationProps['preview'] = {
  typeLines: ['Project gains PARA.'],
  notes: [
    { path: 'Areas/Garden.md', line: 'Garden: Area → Project, PARA Area' },
    // Two notes may read alike: each is still listed.
    { path: 'Work/Garden.md', line: 'Garden: Area → Project, PARA Area' },
    { path: 'Manual.md', line: 'Manual: Resource → Project, PARA Resource' },
  ],
  skipped: [],
};

function panel(overrides: Partial<ParaMigrationProps> = {}) {
  const props: ParaMigrationProps = {
    preview: PREVIEW,
    open: false,
    busy: false,
    result: null,
    problem: null,
    onOpen: vi.fn(),
    onRun: vi.fn(),
    onClose: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<ParaMigration {...props} />);
  return props;
}

describe('ParaMigration', () => {
  it('offers the move in one line, saying how many notes it would move', async () => {
    const props = panel();
    expect(screen.getByText(/3 notes would move onto it/)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Move/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Preview the move' }));
    expect(props.onOpen).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('previews every note and what the Project type gains, and moves only when asked', async () => {
    const props = panel({ open: true });
    const notes = screen.getByRole('list', { name: 'Notes that move' });
    expect(
      within(notes)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Garden: Area → Project, PARA Area',
      'Garden: Area → Project, PARA Area',
      'Manual: Resource → Project, PARA Resource',
    ]);
    const type = screen.getByRole('list', { name: 'The Project type' });
    expect(within(type).getByText('Project gains PARA.')).toBeDefined();
    expect(props.onRun).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Move 3 notes' }));
    expect(props.onRun).toHaveBeenCalledOnce();
  });

  it('lists each note left as it is, with why, apart from the notes that move', () => {
    const line =
      'Chores: its PARA “Life admin” is not Project, Area, Resource or Archive, so it is left as it is';
    panel({
      open: true,
      preview: { ...PREVIEW, skipped: [{ path: 'Areas/Chores.md', line }] },
    });
    const left = screen.getByRole('list', { name: 'Notes left as they are' });
    expect(
      within(left)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([line]);
    expect(screen.getByRole('button', { name: 'Move 3 notes' })).toBeDefined();
  });

  it('holds the move while one is under way', () => {
    panel({ open: true, busy: true });
    expect(
      (screen.getByRole('button', { name: 'Move 3 notes' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('says what the run did, until dismissed', async () => {
    const props = panel({
      preview: null,
      result: 'Moved 3 notes onto the Project type, with PARA set.',
    });
    expect(screen.getByRole('status').textContent).toBe(
      'Moved 3 notes onto the Project type, with PARA set.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(props.onDismiss).toHaveBeenCalledOnce();
  });

  it('shows a problem, and nothing at all when there is nothing to say', () => {
    const { unmount } = render(
      <ParaMigration
        preview={null}
        open={false}
        busy={false}
        result={null}
        problem="Your PARA notes could not be read: index not ready"
        onOpen={vi.fn()}
        onRun={vi.fn()}
        onClose={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('could not be read');
    unmount();
    const { container } = render(
      <ParaMigration
        preview={null}
        open={false}
        busy={false}
        result={null}
        problem={null}
        onOpen={vi.fn()}
        onRun={vi.fn()}
        onClose={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});

/** #319: the offer is the one-line notice bar, its verbs at the end, grown open for the preview. */
describe('ParaMigration as the notice bar (#319)', () => {
  const region = () => screen.getByRole('region', { name: 'Move notes onto the Project type' });

  it('is the bar, with Preview the move as the secondary verb and Not now as the ghost one', () => {
    panel();
    expect(region().className).toBe('notice-bar inbox__offer task-migration');
    const verbs = screen
      .getAllByRole('button')
      .map((button) => [button.textContent, button.className]);
    expect(verbs).toEqual([
      ['Preview the move', 'btn btn--secondary btn--sm'],
      ['Not now', 'btn btn--ghost btn--sm'],
    ]);
  });

  it('carries --open while the preview shows under the line', () => {
    panel({ open: true });
    expect(region().classList.contains('notice-bar--open')).toBe(true);
  });
});
