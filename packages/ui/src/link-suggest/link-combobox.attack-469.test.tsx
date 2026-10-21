// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NO_LINK_HINTS, type LinkHints } from '@dfai/domain';
import type { RelationChoice } from '../properties-panel.tsx';
import { LinkCombobox } from './link-combobox.tsx';
import { LinkHintsProvider, type LinkHintsSource } from './link-hints.tsx';

/**
 * Attacks on PR #469 (#465): the one link picker. Fictional names only.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CHOICES: readonly RelationChoice[] = [
  { path: 'Projects/Alder Lane.md', title: 'Alder Lane', type: 'project' },
  { path: 'Projects/Birch Lane.md', title: 'Birch Lane', type: 'project' },
  { path: 'Projects/Cedar Lane.md', title: 'Cedar Lane', type: 'project' },
];

const source = (hints: LinkHints): LinkHintsSource => ({
  hints,
  notes: null,
  problem: null,
  want: () => {},
});

function Picker({
  hints,
  onPick,
  onCreate,
}: {
  hints: LinkHints;
  onPick: (choice: RelationChoice) => void;
  onCreate?: (request: { target: string; name: string }) => Promise<void>;
}) {
  return (
    <LinkHintsProvider value={source(hints)}>
      <LinkCombobox
        label="Project"
        placeholder="Project…"
        choices={CHOICES}
        onPick={onPick}
        {...(onCreate !== undefined && { creates: ['project'], onCreate })}
      />
    </LinkHintsProvider>
  );
}

const activeTitle = (input: HTMLElement): string | null => {
  const id = input.getAttribute('aria-activedescendant');
  if (id === null) return null;
  return document.getElementById(id)?.querySelector('.link-suggest__title')?.textContent ?? null;
};

describe('LinkCombobox (attack #469)', () => {
  it('wraps ↑ from no active row to the last row', async () => {
    render(<Picker hints={NO_LINK_HINTS} onPick={vi.fn()} />);
    const input = screen.getByRole('combobox', { name: 'Project' });
    await userEvent.click(input);
    // Nothing typed: no row is active yet; ↑ should land on the last one.
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(activeTitle(input)).toBe('Cedar Lane');
  });

  it('picks the note the person arrowed to, even when the hints land and reorder the rows', async () => {
    const onPick = vi.fn();
    const { rerender } = render(<Picker hints={NO_LINK_HINTS} onPick={onPick} />);
    const input = screen.getByRole('combobox', { name: 'Project' });
    await userEvent.type(input, 'lane');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeTitle(input)).toBe('Birch Lane');

    // The host's read lands: Cedar Lane is the most used, so it moves to the top.
    const hints: LinkHints = {
      aliases: new Map(),
      uses: new Map([['Projects/Cedar Lane.md', { count: 9, last: 100 }]]),
    };
    act(() => rerender(<Picker hints={hints} onPick={onPick} />));
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick.mock.calls[0]?.[0]).toMatchObject({ title: 'Birch Lane' });
  });

  it('makes no note when Tab moves the focus on from a name nothing matches', async () => {
    const onCreate = vi.fn(async () => {});
    const onPick = vi.fn();
    render(
      <>
        <Picker hints={NO_LINK_HINTS} onPick={onPick} onCreate={onCreate} />
        <input aria-label="Next field" />
      </>,
    );
    const input = screen.getByRole('combobox', { name: 'Project' });
    // A typo, then Tab to go to the next field.
    await userEvent.type(input, 'Zqxv');
    await userEvent.tab();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('keeps the open list inside the window near its right edge', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const LIST_WIDTH = 260; // the stylesheet's min-width for `.link-suggest`
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.getAttribute('role') === 'combobox') {
        return DOMRect.fromRect({ x: 900, y: 100, width: 90, height: 24 });
      }
      if (this.getAttribute('role') === 'listbox') {
        const left = Number.parseFloat(this.style.left || '0');
        const top = Number.parseFloat(this.style.top || '0');
        return DOMRect.fromRect({ x: left, y: top, width: LIST_WIDTH, height: 120 });
      }
      return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
    });
    render(<Picker hints={NO_LINK_HINTS} onPick={vi.fn()} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Project' }));
    const list = screen.getByRole('listbox', { name: 'Suggested notes' });
    const left = Number.parseFloat(list.style.left);
    expect(left + LIST_WIDTH).toBeLessThanOrEqual(1000);
  });
});
