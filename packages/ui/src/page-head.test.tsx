// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditableTitle, PageHead } from './page-head.tsx';

describe('PageHead', () => {
  it('heads the page with its title and the line saying what it is', () => {
    render(<PageHead icon="board" title="Board" description="Every task, by status." />);
    expect(screen.getByRole('heading', { level: 1, name: 'Board' })).toBeDefined();
    expect(screen.getByText('Every task, by status.')).toBeDefined();
  });

  it('leaves the description out when there is none', () => {
    const { container } = render(<PageHead icon="board" title="Board" description="" />);
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
    expect(container.querySelector('.page-head__description')).toBeNull();
  });

  it('puts what a page brings into the slot beside its title, and below it', () => {
    render(
      <PageHead icon="board" title="Board" actions={<button type="button">New task</button>}>
        <div role="toolbar" aria-label="Views" />
      </PageHead>,
    );
    const actions = screen.getByRole('button', { name: 'New task' });
    expect(actions.closest('.page-head__actions')).not.toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Views' }).closest('.page-head__row')).toBeNull();
  });

  it('draws the tile larger and the head stacked for a note', () => {
    const { container } = render(<PageHead icon="task" title="Note" size="note" />);
    expect(container.querySelector('.page-head--note')).not.toBeNull();
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('30');
  });
});

describe('EditableTitle', () => {
  const show = (onCommit = vi.fn()) => {
    render(
      <EditableTitle value="Draft" label="Title" hint="Change the title" onCommit={onCommit} />,
    );
    return onCommit;
  };

  it('commits a changed title on Enter', async () => {
    const onCommit = show();
    await userEvent.click(screen.getByRole('button', { name: 'Draft' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), ' two{Enter}');
    expect(onCommit).toHaveBeenCalledWith('Draft two');
  });

  it('commits on leaving the field', async () => {
    const onCommit = show();
    await userEvent.click(screen.getByRole('button', { name: 'Draft' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), '!');
    await userEvent.tab();
    expect(onCommit).toHaveBeenCalledWith('Draft!');
  });

  it('changes nothing for a blank or an unchanged title, or on Escape', async () => {
    const onCommit = show();
    await userEvent.click(screen.getByRole('button', { name: 'Draft' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), '{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Draft' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Title' }));
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Draft' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Title' }), 'x{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Draft' })).toBeDefined();
  });
});
