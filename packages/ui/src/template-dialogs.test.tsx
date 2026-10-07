// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DeleteDialog } from './delete-dialog.tsx';
import { TemplateToNoteDialog } from './template-to-note-dialog.tsx';

describe('the question before a template becomes a note', () => {
  it('says where it goes, that it goes as it is, and what stops using it', async () => {
    const onConfirm = vi.fn();
    render(
      <TemplateToNoteDialog
        name="Larkspur Payroll"
        consequence="New Company notes will start empty."
        unsaved={false}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Make “Larkspur Payroll” a note?');
    expect(dialog.textContent).toContain('top of the vault');
    expect(dialog.textContent).toContain('New Company notes will start empty.');
    await userEvent.click(screen.getByRole('button', { name: 'Move to notes' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('closes on Cancel, moving nothing', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <TemplateToNoteDialog
        name="Meeting"
        consequence={null}
        unsaved={false}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('the question before a template in use goes to the Trash', () => {
  it('says what will start blank once it is gone', async () => {
    render(
      <DeleteDialog
        subject={{
          name: 'Daily template',
          kind: 'note',
          notes: 0,
          otherFiles: null,
          unsaved: [],
          consequence: 'Today’s note will start blank.',
        }}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Today’s note will start blank.');
  });
});
