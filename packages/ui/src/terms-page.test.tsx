// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, type TermNote, type VocabularyConflict } from '@atlas/domain';
import { TermsPage, type TermsContents } from './terms-page.tsx';

const term = (path: string, canonical: string, variants: string[], kind: TermNote['kind']) =>
  ({ path: createVaultPath(path), canonical, variants, kind }) satisfies TermNote;

const LARKSPUR = term('Terms/Larkspur.md', 'Larkspur', ['lark spur', 'Larks Burr'], 'company');
const QUILL = term('Terms/Quill Desk.md', 'Quill Desk', [], null);

const CONFLICT: VocabularyConflict = {
  form: 'lark spur',
  claims: [
    { form: 'lark spur', canonical: 'Larkspur', path: LARKSPUR.path, source: 'term' },
    {
      form: 'Lark Spur',
      canonical: 'Larkspur Payroll',
      path: createVaultPath('Companies/Larkspur Payroll.md'),
      source: 'company',
    },
  ],
};

const CONTENTS: TermsContents = { terms: [LARKSPUR, QUILL], conflicts: [], spellings: 6 };

function renderPage(
  overrides: Partial<Parameters<typeof TermsPage>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <TermsPage
      contents={CONTENTS}
      error={null}
      onAdd={() => {}}
      onEditVariants={() => {}}
      onOpen={() => {}}
      {...overrides}
    />,
  );
}

const rowOf = (name: string) => {
  const row = screen.getByRole('button', { name }).closest('tr');
  if (row === null) throw new Error(`no row for ${name}`);
  return within(row);
};

describe('the Terms page', () => {
  it('lists each term with its kind and the ways it is misheard, and says how many spellings Atlas knows', () => {
    renderPage();
    expect(screen.getByRole('article', { name: 'Terms' })).toBeTruthy();
    expect(
      screen.getByText('2 terms · 6 spellings Atlas puts right, people and companies included'),
    ).toBeTruthy();
    expect(rowOf('Larkspur').getByText('company')).toBeTruthy();
    const variants = rowOf('Larkspur').getByRole('textbox', {
      name: 'Misheard spellings of Larkspur',
    }) as HTMLInputElement;
    expect(variants.value).toBe('lark spur, Larks Burr');
    expect(rowOf('Quill Desk').getByText('—')).toBeTruthy();
    expect((rowOf('Quill Desk').getByRole('textbox') as HTMLInputElement).value).toBe('');
  });

  it('opens a term from its name', async () => {
    const onOpen = vi.fn();
    renderPage({ onOpen });
    await userEvent.click(screen.getByRole('button', { name: 'Larkspur' }));
    expect(onOpen).toHaveBeenCalledWith('Terms/Larkspur.md');
  });

  it('adds a term with its spelling, variants and kind, then closes the form', async () => {
    const onAdd = vi.fn();
    renderPage({ onAdd });
    await userEvent.click(screen.getByRole('button', { name: 'New term' }));
    const form = within(screen.getByRole('form', { name: 'New term' }));
    await userEvent.type(form.getByRole('textbox', { name: 'Right spelling' }), '  Fenn Ledger ');
    await userEvent.type(
      form.getByRole('textbox', { name: 'Misheard as' }),
      'fen ledger, Fen Leger',
    );
    await userEvent.selectOptions(form.getByRole('combobox', { name: 'Kind' }), 'product');
    await userEvent.click(form.getByRole('button', { name: 'Add term' }));

    expect(onAdd).toHaveBeenCalledExactlyOnceWith({
      canonical: 'Fenn Ledger',
      variants: 'fen ledger, Fen Leger',
      kind: 'product',
    });
    expect(screen.queryByRole('form', { name: 'New term' })).toBeNull();
  });

  it('adds a term with no kind when none is chosen', async () => {
    const onAdd = vi.fn();
    renderPage({ onAdd });
    await userEvent.click(screen.getByRole('button', { name: 'New term' }));
    const form = within(screen.getByRole('form', { name: 'New term' }));
    await userEvent.type(form.getByRole('textbox', { name: 'Right spelling' }), 'QLX{Enter}');
    expect(onAdd).toHaveBeenCalledWith({ canonical: 'QLX', variants: '', kind: null });
  });

  it('refuses a term with no spelling, saying why, and adds nothing', async () => {
    const onAdd = vi.fn();
    renderPage({ onAdd });
    await userEvent.click(screen.getByRole('button', { name: 'New term' }));
    const form = within(screen.getByRole('form', { name: 'New term' }));
    expect(form.queryByRole('alert')).toBeNull();
    await userEvent.type(form.getByRole('textbox', { name: 'Misheard as' }), 'lark spur');
    await userEvent.click(form.getByRole('button', { name: 'Add term' }));
    expect(form.getByRole('alert').textContent).toBe('A term needs its right spelling.');
    expect(form.getByRole('textbox', { name: 'Right spelling' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('closes the form on Cancel without adding', async () => {
    const onAdd = vi.fn();
    renderPage({ onAdd });
    await userEvent.click(screen.getByRole('button', { name: 'New term' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New term' })).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('edits a term’s variants when the field is left, once, as typed', async () => {
    const onEditVariants = vi.fn();
    renderPage({ onEditVariants });
    const field = rowOf('Quill Desk').getByRole('textbox', {
      name: 'Misheard spellings of Quill Desk',
    });
    await userEvent.type(field, 'quilled desk, Quil Desk{Enter}');
    await userEvent.tab();
    expect(onEditVariants).toHaveBeenCalledExactlyOnceWith({
      path: 'Terms/Quill Desk.md',
      variants: 'quilled desk, Quil Desk',
    });
  });

  it('shows each conflict with the notes that claim it, and that it is not used', async () => {
    const onOpen = vi.fn();
    renderPage({ contents: { ...CONTENTS, conflicts: [CONFLICT] }, onOpen });
    const conflicts = within(screen.getByRole('region', { name: 'Conflicts' }));
    expect(conflicts.getByRole('heading', { name: '1 conflict' })).toBeTruthy();
    expect(conflicts.getByText('“lark spur”')).toBeTruthy();
    expect(conflicts.getByRole('button', { name: 'Larkspur (term)' })).toBeTruthy();
    await userEvent.click(conflicts.getByRole('button', { name: 'Larkspur Payroll (company)' }));
    expect(onOpen).toHaveBeenCalledWith('Companies/Larkspur Payroll.md');

    expect(rowOf('Larkspur').getByText('In conflict, so not used: “lark spur”')).toBeTruthy();
    expect(rowOf('Quill Desk').queryByText(/In conflict/)).toBeNull();
  });

  it('shows no conflicts section while there are none', () => {
    renderPage();
    expect(screen.getByRole('article', { name: 'Terms' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Conflicts' })).toBeNull();
  });

  it('says so while reading, when there are no terms, and when the index fails', () => {
    const { rerender } = renderPage({ contents: null });
    expect(screen.getByText('Reading the terms…')).toBeTruthy();
    const props = { error: null, onAdd: () => {}, onEditVariants: () => {}, onOpen: () => {} };
    rerender(<TermsPage {...props} contents={{ terms: [], conflicts: [], spellings: 1 }} />);
    expect(screen.getByText(/^No terms yet/)).toBeTruthy();
    expect(
      screen.getByText('0 terms · 1 spelling Atlas puts right, people and companies included'),
    ).toBeTruthy();
    rerender(<TermsPage {...props} contents={null} error="index closed" />);
    expect(screen.getByRole('alert').textContent).toBe('index closed');
  });
});
