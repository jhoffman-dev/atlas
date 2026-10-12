// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MeetingCorrectionsBand } from './meeting-corrections-band.tsx';

const SPELLINGS = [
  { from: 'Lark Spur Pay', to: 'Larkspur Pay', count: 2 },
  { from: 'Mara Quil', to: 'Mara Quill', count: 1 },
];

/** P28-06: the band over a meeting whose spellings the import put right. */
describe('MeetingCorrectionsBand', () => {
  it('lists each spelling put right and how often, and undoes them on request', async () => {
    const onUndo = vi.fn();
    render(
      <MeetingCorrectionsBand
        spellings={SPELLINGS}
        onUndo={onUndo}
        refusal={null}
        permanent={false}
        onDismiss={vi.fn()}
        undoing={false}
      />,
    );

    const band = screen.getByRole('complementary', { name: 'Corrections' });
    expect(band.textContent).toContain('3 spellings put right on import');
    const items = within(band)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(items).toEqual(['Lark Spur Pay → Larkspur Pay ×2', 'Mara Quil → Mara Quill']);
    expect(screen.queryByRole('status')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Undo corrections' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('says why an Undo was refused, and cannot be pressed again while one is written', () => {
    render(
      <MeetingCorrectionsBand
        spellings={[{ from: 'Mara Quil', to: 'Mara Quill', count: 1 }]}
        onUndo={vi.fn()}
        refusal="The meeting changed since its words were corrected, so they were left as they are."
        permanent={false}
        onDismiss={vi.fn()}
        undoing
      />,
    );

    expect(screen.getByRole('complementary').textContent).toContain('1 spelling put right');
    expect(screen.getByRole('status').textContent).toBe(
      'The meeting changed since its words were corrected, so they were left as they are.',
    );
    expect(screen.getByRole('button', { name: 'Undo corrections' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('turns Undo off once the refusal is permanent, and lets the band be dismissed', async () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(
      <MeetingCorrectionsBand
        spellings={SPELLINGS}
        onUndo={onUndo}
        refusal="The meeting changed since its words were corrected, so they were left as they are."
        permanent
        onDismiss={onDismiss}
        undoing={false}
      />,
    );

    expect(screen.getByRole('button', { name: 'Undo corrections' }).hasAttribute('disabled')).toBe(
      true,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('offers no Dismiss while Undo can still be tried again', () => {
    render(
      <MeetingCorrectionsBand
        spellings={SPELLINGS}
        onUndo={vi.fn()}
        refusal="A note is open with unsaved typing."
        permanent={false}
        onDismiss={vi.fn()}
        undoing={false}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo corrections' }).hasAttribute('disabled')).toBe(
      false,
    );
  });
});
