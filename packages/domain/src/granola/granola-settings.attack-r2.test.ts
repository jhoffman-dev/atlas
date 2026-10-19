// Adversarial probes, round 2, for PR #156 (P28-12) fix commits. Diagnose only: a red test is a defect.
import { describe, expect, it, vi } from 'vitest';
import { selfEmailsFromText } from '../profile/self-emails.ts';
import { parseGranolaSettings } from './granola-settings.ts';

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
    const read = selfEmailsFromText('mara.quill@exa\u200bmple.com');
    expect(read.ok).toBe(false);
  });

  it('ATTACK: a NUL byte inside the text is saved as part of the address', () => {
    const read = selfEmailsFromText('mara.quill@example.com\u0000');
    expect(read.ok).toBe(false);
  });

  it('ATTACK: addresses with empty dot-separated parts are saved as addresses', () => {
    for (const text of ['.mara@example.com', 'mara@example..com', 'mara@.example.com']) {
      expect(selfEmailsFromText(text).ok, text).toBe(false);
    }
  });

  it('ATTACK: a copied "Name <address>" with a no-break space in the name is refused', () => {
    const read = selfEmailsFromText('Mara\u00a0Quill <mara.quill@example.com>');
    expect(read).toEqual({ ok: true, emails: ['mara.quill@example.com'] });
  });

  it('ATTACK: a long paste is refused before any of it is read', () => {
    const text = 'word '.repeat(20_000); // 100 KB, e.g. a document pasted into the field by mistake
    // What the reader hands its patterns, counted rather than timed: 100 KB
    // read word by word was the cost, and none of it need be read to refuse it.
    const { exec } = RegExp.prototype;
    let scanned = 0;
    const spy = vi.spyOn(RegExp.prototype, 'exec').mockImplementation(function (
      this: RegExp,
      input: string,
    ) {
      scanned += input.length;
      return exec.call(this, input);
    });
    let read: ReturnType<typeof selfEmailsFromText>;
    try {
      read = selfEmailsFromText(text);
    } finally {
      spy.mockRestore();
    }
    expect(read).toEqual({
      ok: false,
      problem:
        'That is more than 10 KB of text, too much to be email addresses. Nothing was saved.',
    });
    expect(scanned).toBe(0);
  });
});
