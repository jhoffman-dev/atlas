// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NO_LINK_HINTS, type LinkHints } from '@atlas/domain';
import type { RelationChoice } from '../properties-panel.tsx';
import { LinkCombobox } from './link-combobox.tsx';
import { LinkHintsProvider, type LinkHintsSource } from './link-hints.tsx';
import { optionNamed, suggestedTitles } from './link-suggest.test-support.ts';

afterEach(cleanup);

const CHOICES: readonly RelationChoice[] = [
  { path: 'Projects/Garden shed.md', title: 'Garden shed', type: 'project' },
  { path: 'Areas/Garden.md', title: 'Garden', type: 'area' },
  { path: 'Projects/Larkspur Payroll.md', title: 'Larkspur Payroll', type: 'project' },
];

function field({
  hints = NO_LINK_HINTS,
  want = vi.fn(),
  onCreate,
  creates,
  current,
}: {
  hints?: LinkHints;
  want?: () => void;
  onCreate?: (request: { target: string; name: string }) => Promise<void>;
  creates?: readonly string[];
  current?: string;
} = {}) {
  const onPick = vi.fn();
  const onOpen = vi.fn();
  /** The keys that reach the page around the field, by name. */
  const pageKeys: string[] = [];
  const source: LinkHintsSource = { hints, notes: null, problem: null, want };
  render(
    <LinkHintsProvider value={source}>
      <div onKeyDown={(event) => pageKeys.push(event.key)}>
        <LinkCombobox
          label="Project"
          placeholder="Project…"
          choices={CHOICES}
          onPick={onPick}
          onOpen={onOpen}
          {...(current !== undefined && { current })}
          {...(creates !== undefined && { creates })}
          {...(onCreate !== undefined && { onCreate })}
        />
      </div>
    </LinkHintsProvider>,
  );
  return {
    input: screen.getByRole('combobox', { name: 'Project' }),
    onPick,
    onOpen,
    want,
    pageKeys,
  };
}

describe('LinkCombobox', () => {
  it('reads nothing until it opens, then asks for what it offers once', async () => {
    const { input, onOpen, want } = field();
    expect(onOpen).not.toHaveBeenCalled();
    expect(want).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    await userEvent.click(input);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(want).toHaveBeenCalledTimes(1);
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('suggests what meets what was typed, best first', async () => {
    const { input } = field();
    await userEvent.type(input, 'gar');
    expect(suggestedTitles()).toEqual(['Garden', 'Garden shed']);
  });

  it('shows each note’s type in its hue, and its folder', async () => {
    const { input } = field();
    await userEvent.type(input, 'lark');
    const option = screen.getByRole('option', { name: optionNamed('Larkspur Payroll') });
    expect(option.getAttribute('aria-label')).toBe('Larkspur Payroll, project, Projects');
    expect(option.querySelector('.link-suggest__type')?.getAttribute('data-hue')).not.toBeNull();
  });

  it('says the alias a note matched by', async () => {
    const hints: LinkHints = {
      aliases: new Map([['Projects/Larkspur Payroll.md', ['LP']]]),
      uses: new Map(),
    };
    const { input } = field({ hints });
    await userEvent.type(input, 'lp');
    const option = screen.getByRole('option', { name: optionNamed('Larkspur Payroll') });
    expect(option.querySelector('.link-suggest__alias')?.textContent).toBe('LP');
  });

  it('picks the best match on Enter, and empties the field', async () => {
    const { input, onPick } = field();
    await userEvent.type(input, 'gar{Enter}');
    expect(onPick).toHaveBeenCalledWith(CHOICES[1]);
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('moves with ↑ and ↓, wrapping, and picks the row moved to', async () => {
    const { input, onPick } = field();
    await userEvent.type(input, 'gar{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toMatch(/-1$/);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onPick).toHaveBeenCalledWith(CHOICES[0]);
  });

  it('takes the active row on Tab once something is typed', async () => {
    const { input, onPick } = field();
    await userEvent.type(input, 'lark');
    await userEvent.tab();
    expect(onPick).toHaveBeenCalledWith(CHOICES[2]);
  });

  it('picks nothing on Enter with nothing typed, leaving the key to the page', async () => {
    const { input, onPick, pageKeys } = field();
    await userEvent.click(input);
    await userEvent.keyboard('{Enter}');
    expect(onPick).not.toHaveBeenCalled();
    expect(pageKeys).toContain('Enter');
  });

  it('keeps the Enter that picks from the page', async () => {
    const { input, onPick, pageKeys } = field();
    await userEvent.type(input, 'gar{Enter}');
    expect(onPick).toHaveBeenCalled();
    expect(pageKeys).not.toContain('Enter');
  });

  it('closes the list on Esc, and only the list; a second Esc is the page’s', async () => {
    const { input, pageKeys } = field();
    await userEvent.type(input, 'gar');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(pageKeys).not.toContain('Escape');
    await userEvent.keyboard('{Escape}');
    expect(pageKeys.filter((key) => key === 'Escape')).toHaveLength(1);
  });

  it('leaves Esc to the page when nothing was typed, closing the list as it goes', async () => {
    const { input, pageKeys } = field();
    await userEvent.click(input);
    expect(screen.getByRole('listbox')).toBeDefined();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(pageKeys).toEqual(['Escape']);
  });

  it('leaves Enter to an input method that is composing', async () => {
    const { input, onPick } = field();
    await userEvent.type(input, 'gar');
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('picks a note clicked, without the field losing the focus first', async () => {
    const { input, onPick } = field();
    await userEvent.type(input, 'gar');
    await userEvent.click(screen.getByRole('option', { name: optionNamed('Garden shed') }));
    expect(onPick).toHaveBeenCalledWith(CHOICES[0]);
    expect(document.activeElement).toBe(input);
  });

  it('shows what it holds while nothing is typed, selected so typing replaces it', async () => {
    const { input } = field({ current: 'Garden' });
    expect((input as HTMLInputElement).value).toBe('Garden');
    await userEvent.click(input);
    await userEvent.keyboard('lark');
    expect((input as HTMLInputElement).value).toBe('lark');
    await userEvent.keyboard('{Escape}');
    expect((input as HTMLInputElement).value).toBe('Garden');
  });
});

describe('LinkCombobox — making a note of what was typed', () => {
  it('offers "Create <type> ‘…’" when no note is called that, and makes it', async () => {
    const onCreate = vi.fn(async () => {});
    const { input } = field({ onCreate, creates: ['project', 'area'] });
    await userEvent.type(input, 'Gard');
    const create = screen.getByRole('option', { name: 'Create area ‘Gard’' });
    expect(screen.getByRole('option', { name: 'Create project ‘Gard’' })).toBeDefined();
    await userEvent.click(create);
    expect(onCreate).toHaveBeenCalledWith({ target: 'area', name: 'Gard' });
  });

  it('offers none once a note is called what was typed', async () => {
    const { input } = field({ onCreate: async () => {}, creates: ['project'] });
    await userEvent.type(input, 'garden');
    expect(suggestedTitles()).toEqual(['Garden', 'Garden shed']);
    expect(screen.queryByRole('option', { name: /^Create/ })).toBeNull();
  });

  it('makes it on Enter when nothing else matches, and once only', async () => {
    let finish = () => {};
    const onCreate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { input } = field({ onCreate, creates: ['project'] });
    await userEvent.type(input, 'Tobias Fenn{Enter}{Enter}');
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith({ target: 'project', name: 'Tobias Fenn' });
    finish();
  });

  it('says why a note could not be made, and stays open', async () => {
    const onCreate = vi.fn(async () => {
      throw new Error('There is no project type to make one of.');
    });
    const { input } = field({ onCreate, creates: ['project'] });
    await userEvent.type(input, 'Tobias{Enter}');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'There is no project type to make one of.',
    );
    expect(screen.getByRole('listbox')).toBeDefined();
  });

  it('offers nothing to make where notes cannot be made', async () => {
    const { input } = field();
    await userEvent.type(input, 'Tobias');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
