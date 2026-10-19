// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateBanner } from './template-banner.tsx';

/** The band over a template being edited, so it is never taken for a note; #319 draws it as the notice bar. */
describe('TemplateBanner', () => {
  it('says what the template is used for, and leads to the notes or to every template', async () => {
    const onOpenTemplates = vi.fn();
    const onMoveToNotes = vi.fn();
    render(
      <TemplateBanner
        uses={[{ kind: 'type', typeName: 'meeting', typeLabel: 'Meeting' }]}
        onOpenTemplates={onOpenTemplates}
        onMoveToNotes={onMoveToNotes}
      />,
    );
    const band = screen.getByRole('complementary', { name: 'Template' });
    expect(band.textContent).toContain('Template · Used for: New Meeting notes.');
    expect(band.textContent).toContain('never the notes already made');
    await userEvent.click(screen.getByRole('button', { name: 'Move to notes…' }));
    await userEvent.click(screen.getByRole('button', { name: 'All templates' }));
    expect(onMoveToNotes).toHaveBeenCalledTimes(1);
    expect(onOpenTemplates).toHaveBeenCalledTimes(1);
  });

  it('is the notice bar, with Move to notes as the secondary verb and All templates as the ghost one (#319)', () => {
    render(<TemplateBanner uses={[]} onOpenTemplates={vi.fn()} onMoveToNotes={vi.fn()} />);
    const band = screen.getByRole('complementary', { name: 'Template' });
    expect(band.className).toBe('notice-bar template-banner');
    expect(band.textContent).toContain('Used for: Only the New menu.');
    const verbs = screen
      .getAllByRole('button')
      .map((button) => [button.textContent, button.className]);
    expect(verbs).toEqual([
      ['Move to notes…', 'btn btn--secondary btn--sm'],
      ['All templates', 'btn btn--ghost btn--sm'],
    ]);
  });
});
