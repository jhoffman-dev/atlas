// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NO_LINK_HINTS } from '@atlas/domain';
import type { RelationChoice } from '../properties-panel.tsx';
import { LinkCombobox } from './link-combobox.tsx';
import { LinkHintsProvider, type LinkHintsSource } from './link-hints.tsx';

/**
 * Verify pass on PR #469 (#465): the Inbox's "Create project/area '…'" is the
 * combobox's Create. The editor's `[[` Create counts a name as taken when the
 * file it would get is a note's ("Q3: plan" is "Q3 plan.md"); the picker's
 * does not, so a second note of a name that exists is made. Fictional names.
 */

afterEach(cleanup);

const CHOICES: readonly RelationChoice[] = [
  { path: 'Areas/Garden.md', title: 'Garden', type: 'area' },
  { path: 'Projects/Q3 plan.md', title: 'Q3 plan', type: 'project' },
];

const SOURCE: LinkHintsSource = { hints: NO_LINK_HINTS, notes: null, problem: null, want: vi.fn() };

function picker() {
  const onCreate = vi.fn(async () => {});
  render(
    <LinkHintsProvider value={SOURCE}>
      <LinkCombobox
        label="Project"
        placeholder="Project…"
        choices={CHOICES}
        onPick={vi.fn()}
        creates={['project', 'area']}
        onCreate={onCreate}
      />
    </LinkHintsProvider>,
  );
  return { input: screen.getByRole('combobox', { name: 'Project' }), onCreate };
}

describe('LinkCombobox Create (verify #469)', () => {
  it('offers no Create for a name whose file would be a note that exists: a colon cleaned away', async () => {
    const { input } = picker();
    await userEvent.type(input, 'Q3: plan');
    expect(
      screen.queryAllByRole('option', { name: /^Create/ }).map((row) => row.textContent),
    ).toEqual([]);
  });

  it('offers no Create for a name whose file would be a note that exists: a trailing dot', async () => {
    const { input } = picker();
    await userEvent.type(input, 'Garden.');
    expect(
      screen.queryAllByRole('option', { name: /^Create/ }).map((row) => row.textContent),
    ).toEqual([]);
  });
});
