// @vitest-environment jsdom
// Adversarial probes for PR #156 (P28-12). Diagnose only: a red test here is a defect.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GranolaSettings, type GranolaView } from './granola-settings.tsx';

const KEY = 'grn_fictional0123456789';

function renderWith(overrides: Partial<GranolaView> = {}) {
  const view: GranolaView = {
    keyState: 'set',
    waiting: false,
    pulling: false,
    lastPull: null,
    lastPullAt: null,
    notes: [],
    selfEmails: '',
    suggestedEmails: null,
    problem: null,
    pending: false,
    ...overrides,
  };
  const handlers = {
    onSaveKey: vi.fn(),
    onForgetKey: vi.fn(),
    onSyncNow: vi.fn(),
    onOpenNote: vi.fn(),
    onSaveEmails: vi.fn(),
  };
  const { rerender } = render(<GranolaSettings view={view} {...handlers} />);
  /** Draws the same card again with the view changed, as the next render would. */
  const redraw = (changes: Partial<GranolaView>) =>
    rerender(<GranolaSettings view={{ ...view, ...changes }} {...handlers} />);
  return { ...handlers, redraw };
}

const card = () => screen.getByRole('region', { name: 'Granola' });
const keyField = () => within(card()).getByLabelText<HTMLInputElement>('Granola API key');

const emailsField = () => within(card()).getByLabelText<HTMLInputElement>('Your emails');

describe('GranolaSettings, attacked', () => {
  it('ATTACK: addresses being typed are not wiped when the Person note’s suggestion arrives', async () => {
    const { redraw } = renderWith({ selfEmails: '', suggestedEmails: null });
    await userEvent.type(emailsField(), 'mq@example.com');
    // The Person note lookup, started as Settings opened, lands now.
    redraw({ selfEmails: '', suggestedEmails: 'mara.quill@example.com' });
    expect(emailsField().value).toBe('mq@example.com');
  });

  it('probe: the key never reaches the DOM once handed on, nor while a save is pending', async () => {
    const { onSaveKey, redraw } = renderWith({ keyState: 'none' });
    await userEvent.type(keyField(), `  ${KEY}  {Enter}`);
    expect(onSaveKey).toHaveBeenCalledWith(KEY);
    redraw({ keyState: 'none', pending: true });
    expect(document.documentElement.outerHTML).not.toContain(KEY);
    redraw({ keyState: 'refused', pending: false, problem: 'Granola refused the API key' });
    expect(document.documentElement.outerHTML).not.toContain(KEY);
  });
});
