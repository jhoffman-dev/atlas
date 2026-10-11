// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, variantsFromInput, type TermNote } from '@atlas/domain';
import { TermsPage } from './terms-page.tsx';

/*
 * Adversarial (P28-05). A variant can hold a comma — written through the
 * properties panel, `PATCH /v1/notes/{path}/properties`, or MCP — and the
 * Terms page shows every variant in one box joined by ", " and hands the box
 * back as commas-between-spellings. Editing any other variant in that box
 * splits the comma one in two, and each half is then corrected to the term.
 */

const QUILL: TermNote = {
  path: createVaultPath('Terms/Mara Quill.md'),
  canonical: 'Mara Quill',
  variants: ['Quill, Mara', 'Mara Quil'],
  kind: 'person',
};

describe('editing one variant of a term on the Terms page', () => {
  it('keeps a variant that holds a comma whole', async () => {
    const onEditVariants = vi.fn();
    render(
      <TermsPage
        contents={{ terms: [QUILL], conflicts: [], spellings: 3 }}
        error={null}
        onAdd={() => {}}
        onEditVariants={onEditVariants}
        onOpen={() => {}}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Misheard spellings of Mara Quill' });
    await userEvent.type(field, ', Marra Quill');
    await userEvent.tab();

    expect(onEditVariants).toHaveBeenCalledOnce();
    const [{ variants }] = onEditVariants.mock.calls[0] as [{ variants: string }];
    // What the use-case will write (setTermVariants → variantsFromInput).
    expect(variantsFromInput(variants)).toEqual(['Quill, Mara', 'Mara Quil', 'Marra Quill']);
  });
});
