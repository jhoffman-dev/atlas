// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditableTitle, HiddenTitle, PageHead } from './page-head.tsx';

describe('PageHead', () => {
  it('heads a note with its title alone: no tile, no line under it', () => {
    const { container } = render(<PageHead title="Leftovers" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Leftovers' })).toBeDefined();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelectorAll('.page-head > *')).toHaveLength(1);
  });

  it('takes an editable title in place of the text', async () => {
    const onCommit = vi.fn();
    render(
      <PageHead
        title={<EditableTitle value="Draft" label="Title" hint="Change" onCommit={onCommit} />}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Draft' }));
    expect(screen.getByRole('heading', { level: 1 }).contains(screen.getByRole('textbox'))).toBe(
      true,
    );
  });
});

describe('HiddenTitle', () => {
  it('is a level-one heading that can be found by name but is not drawn', () => {
    render(<HiddenTitle>Today</HiddenTitle>);
    const title = screen.getByRole('heading', { level: 1, name: 'Today' });
    expect(title.classList.contains('visually-hidden')).toBe(true);
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
