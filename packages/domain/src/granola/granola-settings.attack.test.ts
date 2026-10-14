// Adversarial probes for PR #156 (P28-12). Diagnose only: a red test here is a defect.
import { describe, expect, it } from 'vitest';
import { granolaSelfEmailsFromText } from './granola-settings.ts';

describe('granolaSelfEmailsFromText, attacked', () => {
  it('ATTACK: an address pasted as "Name <address>" keeps the address, not the words around it', () => {
    expect(granolaSelfEmailsFromText('Mara Quill <mara.quill@example.com>')).toEqual({
      ok: true,
      emails: ['mara.quill@example.com'],
    });
  });

  // Decided on review: words that are not addresses are refused by name, never dropped quietly.
  it('ATTACK: words that are not addresses are not kept as the person’s own addresses', () => {
    const read = granolaSelfEmailsFromText('mara.quill@example.com and also mq');
    expect(read.ok).toBe(false);
    expect(read.ok ? null : read.problem).toContain('“mq”');
  });
});
