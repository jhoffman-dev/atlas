// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TYPE_ICONS } from '@atlas/domain';
import { NewTypeDialog } from './new-type-dialog.tsx';

function dialog(error: string | null = null) {
  const onCreate = vi.fn();
  const onClose = vi.fn();
  render(<NewTypeDialog icons={TYPE_ICONS} error={error} onCreate={onCreate} onClose={onClose} />);
  return { onCreate, onClose };
}

describe('NewTypeDialog', () => {
  it('is a named dialog that starts in the name field', async () => {
    dialog();
    expect(screen.getByRole('dialog', { name: 'New type' })).toBeDefined();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Type name' })),
    );
  });

  it('creates from the name on Enter, with no icon unless one is chosen', async () => {
    const { onCreate } = dialog();
    await userEvent.type(screen.getByRole('textbox', { name: 'Type name' }), ' Book {Enter}');
    expect(onCreate).toHaveBeenCalledWith({ label: 'Book', icon: null });
  });

  it('creates with the chosen icon from the button', async () => {
    const { onCreate } = dialog();
    await userEvent.type(screen.getByRole('textbox', { name: 'Type name' }), 'Book');
    const grid = screen.getByRole('button', { name: 'grid icon' });
    await userEvent.click(grid);
    expect(grid.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Create type' }));
    expect(onCreate).toHaveBeenCalledWith({ label: 'Book', icon: 'grid' });
  });

  it('cannot create a type with no name', async () => {
    const { onCreate } = dialog();
    const create = screen.getByRole('button', { name: 'Create type' });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByRole('textbox', { name: 'Type name' }), '   {Enter}');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('shows why a name was refused, tied to the field', () => {
    dialog('There is already a type called "task"');
    const field = screen.getByRole('textbox', { name: 'Type name' });
    expect(screen.getByRole('alert').textContent).toContain('already a type');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe('new-type-error');
  });

  it('closes on Escape and on Cancel', async () => {
    const { onClose } = dialog();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
