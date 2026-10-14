// Adversarial probes, round 2, for PR #156 (P28-12) fix commits. Diagnose only: a red test is a defect.
import { describe, expect, it } from 'vitest';
import { granolaSelfEmailsFromText, parseGranolaSettings } from './granola-settings.ts';

describe('Granola self emails, attacked round 2', () => {
  it('ATTACK: a hand-written list of addresses in one line is read as one address that matches no one', () => {
    // `.atlas/settings.md` edited by hand: `granola_self_emails: mara.quill@example.com, mq@example.org`.
    const settings = parseGranolaSettings({
      granola_self_emails: 'mara.quill@example.com, mq@example.org',
    });
    expect(settings.selfEmails).toEqual(['mara.quill@example.com', 'mq@example.org']);
  });

  it('ATTACK: an address with an invisible character pasted into it is saved as an address', () => {
    // U+200B ZERO WIDTH SPACE, as rich-text copies can carry; it is not \s, and not trimmed.
    const read = granolaSelfEmailsFromText('mara.quill@exa\u200bmple.com');
    expect(read.ok).toBe(false);
  });

  it('ATTACK: a NUL byte inside the text is saved as part of the address', () => {
    const read = granolaSelfEmailsFromText('mara.quill@example.com\u0000');
    expect(read.ok).toBe(false);
  });

  it('ATTACK: addresses with empty dot-separated parts are saved as addresses', () => {
    for (const text of ['.mara@example.com', 'mara@example..com', 'mara@.example.com']) {
      expect(granolaSelfEmailsFromText(text).ok, text).toBe(false);
    }
  });

  it('ATTACK: a copied "Name <address>" with a no-break space in the name is refused', () => {
    const read = granolaSelfEmailsFromText('Mara\u00a0Quill <mara.quill@example.com>');
    expect(read).toEqual({ ok: true, emails: ['mara.quill@example.com'] });
  });

  it('ATTACK: a long paste is read in time that grows with the square of its words', () => {
    const text = 'word '.repeat(20_000); // 100 KB, e.g. a document pasted into the field by mistake
    const started = performance.now();
    granolaSelfEmailsFromText(text);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
