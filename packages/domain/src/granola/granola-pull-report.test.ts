import { describe, expect, it } from 'vitest';
import {
  GRANOLA_KEPT_SLOWING_DOWN,
  granolaFailureWords,
  granolaLateArrivalReport,
  granolaNoteReport,
  granolaPullReport,
  unreadableSummaryProblem,
  type GranolaNoteProblem,
  type GranolaPullCounts,
} from './granola-pull-report.ts';

const NONE: GranolaPullCounts = { written: 0, held: 0, refused: 0, skipped: 0, failed: 0 };
const counted = (counts: Partial<GranolaPullCounts>) => ({ ...NONE, ...counts });

const pulled = (counts: Partial<GranolaPullCounts>) =>
  granolaPullReport({ mode: 'startup', ended: 'pulled', counts: counted(counts), problem: null });

describe('granolaPullReport', () => {
  it('counts what was written and what the vault already held', () => {
    expect(pulled({ written: 2, held: 2 })).toEqual({
      level: 'info',
      kind: 'meeting',
      message: 'Granola: 2 new, 2 already in Atlas.',
      subject: null,
    });
    expect(pulled({ held: 12 })?.message).toBe('Granola: nothing new, 12 already in Atlas.');
  });

  it('warns of notes refused or skipped, and is an error when one is left to try again', () => {
    expect(pulled({ written: 1, refused: 1 })).toMatchObject({
      level: 'warning',
      message: 'Granola: 1 new, 0 already in Atlas, 1 refused.',
    });
    expect(pulled({ skipped: 2 })).toMatchObject({
      level: 'warning',
      message: 'Granola: nothing new, 0 already in Atlas, 2 skipped.',
    });
    expect(pulled({ written: 1, refused: 1, failed: 1 })).toMatchObject({
      level: 'error',
      message: 'Granola: 1 new, 0 already in Atlas, 1 refused, 1 to try again.',
    });
  });

  it('says nothing of a timed pull that found nothing new, though the vault held some', () => {
    const tick = (counts: Partial<GranolaPullCounts>) =>
      granolaPullReport({
        mode: 'periodic',
        ended: 'pulled',
        counts: counted(counts),
        problem: null,
      });
    expect(tick({})).toBeNull();
    expect(tick({ held: 12 })).toBeNull();
    expect(tick({ written: 1 })?.message).toBe('Granola: 1 new, 0 already in Atlas.');
    expect(tick({ refused: 1 })?.level).toBe('warning');
    expect(tick({ skipped: 1 })?.level).toBe('warning');
    expect(tick({ failed: 1 })?.level).toBe('error');
  });

  it('says nothing of a timed pull whose only skips Activity was told of already', () => {
    const tick = (counts: Partial<GranolaPullCounts>, skippedBefore: number) =>
      granolaPullReport({
        mode: 'periodic',
        ended: 'pulled',
        counts: counted(counts),
        problem: null,
        skippedBefore,
      });
    expect(tick({ skipped: 2, held: 4 }, 2)).toBeNull();
    expect(tick({ skipped: 2 }, 1)?.message).toBe(
      'Granola: nothing new, 0 already in Atlas, 2 skipped.',
    );
    expect(tick({ skipped: 1, written: 1 }, 1)?.message).toBe(
      'Granola: 1 new, 0 already in Atlas, 1 skipped.',
    );
    // A pull asked for always gets its line.
    expect(
      granolaPullReport({
        mode: 'sync-now',
        ended: 'pulled',
        counts: counted({ skipped: 1 }),
        problem: null,
        skippedBefore: 1,
      })?.message,
    ).toBe('Granola: nothing new, 0 already in Atlas, 1 skipped.');
  });

  it('counts a pull asked for, or at startup, even when it found nothing new', () => {
    for (const mode of ['startup', 'sync-now'] as const) {
      expect(
        granolaPullReport({ mode, ended: 'pulled', counts: counted({ held: 3 }), problem: null })
          ?.message,
      ).toBe('Granola: nothing new, 3 already in Atlas.');
    }
  });

  it('says why a timed pull failed, whatever it counted', () => {
    expect(
      granolaPullReport({ mode: 'periodic', ended: 'failed', counts: NONE, problem: 'broke' }),
    ).toMatchObject({ level: 'error', message: 'Granola: the pull failed. Broke.' });
    expect(
      granolaPullReport({ mode: 'periodic', ended: 'vault-changed', counts: NONE, problem: null })
        ?.level,
    ).toBe('warning');
  });

  it('says why a pull Granola kept slowing down gave up', () => {
    expect(
      granolaPullReport({
        mode: 'periodic',
        ended: 'failed',
        counts: counted({ failed: 3 }),
        problem: GRANOLA_KEPT_SLOWING_DOWN,
      })?.message,
    ).toBe(
      'Granola: the pull failed. Granola asked Atlas to slow down for 3 notes in a row, so Atlas stopped this pull. The next pull tries those notes again.',
    );
  });

  it('says nothing of a pull that waits for the vault’s first sync', () => {
    expect(
      granolaPullReport({ mode: 'startup', ended: 'not-synced', counts: NONE, problem: null }),
    ).toBeNull();
  });

  it('says why a pull stopped, with the fix, and what it wrote first', () => {
    const report = granolaPullReport({
      mode: 'startup',
      ended: 'stopped',
      counts: counted({ written: 1 }),
      problem: granolaFailureWords({
        kind: 'api_refused',
        status: 401,
        message: 'Granola answered 401',
      }),
    });
    expect(report?.level).toBe('error');
    expect(report?.message).toMatch(
      /^Granola: the pull stopped\. Granola refused the API key\. Create one in Granola → Settings → Connectors → API keys.* 1 new before it did\.$/,
    );
  });

  it('says why a pull failed, with a problem that has no fix', () => {
    expect(
      granolaPullReport({
        mode: 'startup',
        ended: 'failed',
        counts: NONE,
        problem: granolaFailureWords({ kind: 'invalid', message: 'no vault is open' }),
      })?.message,
    ).toBe(
      'Granola: the pull failed. Atlas could not ask Granola: no vault is open. Atlas stops pulling; the next pull asks again.',
    );
    expect(
      granolaPullReport({
        mode: 'startup',
        ended: 'failed',
        counts: NONE,
        problem: 'the index is not ready',
      })?.message,
    ).toBe('Granola: the pull failed. The index is not ready.');
    expect(
      granolaPullReport({ mode: 'startup', ended: 'failed', counts: NONE, problem: null })?.message,
    ).toBe('Granola: the pull failed.');
  });

  it('warns that a pull ended when another vault was opened', () => {
    const report = granolaPullReport({
      mode: 'startup',
      ended: 'vault-changed',
      counts: counted({ written: 2 }),
      problem: null,
    });
    expect(report?.level).toBe('warning');
    expect(report?.message).toBe(
      'Granola: the pull stopped when another vault was opened. 2 new before it did. The next pull in this vault goes on.',
    );
  });
});

const NOTE: GranolaNoteProblem = {
  id: 'not_1d3tmYTlCICgjy',
  title: 'Larkspur Payroll renewal',
  url: 'https://notes.granola.ai/d/0b6c1d2e',
  problem: 'start: the Granola note has no start',
};

describe('granolaNoteReport', () => {
  it('names a refused note, why, and where to open it', () => {
    expect(granolaNoteReport('refused', NOTE)).toEqual({
      level: 'warning',
      kind: 'meeting',
      message:
        'Granola: “Larkspur Payroll renewal” was not written: start: the Granola note has no start. Sync now tries it again. Open it in Granola: https://notes.granola.ai/d/0b6c1d2e',
      subject: null,
    });
  });

  it('names a skipped note by its id when it has no title, and has no link without one', () => {
    expect(
      granolaNoteReport('skipped', {
        ...NOTE,
        title: null,
        url: null,
        problem: 'Granola no longer has the note. It was skipped; Sync now tries it again.',
      }),
    ).toMatchObject({
      level: 'warning',
      message:
        'Granola: “not_1d3tmYTlCICgjy”: Granola no longer has the note. It was skipped; Sync now tries it again.',
    });
  });

  it('is an error for a note left to try again', () => {
    expect(
      granolaNoteReport('failed', { ...NOTE, problem: 'Granola asked Atlas to slow down.' }),
    ).toMatchObject({
      level: 'error',
      message:
        'Granola: “Larkspur Payroll renewal” could not be read; the next pull tries it again. Granola asked Atlas to slow down.',
    });
  });
});

describe('unreadableSummaryProblem', () => {
  it('names a listed note it cannot read by its id, with why, and nothing else', () => {
    expect(
      unreadableSummaryProblem({ id: 'not_odd0000000001', reason: 'its updated_at is not text' }),
    ).toEqual({
      id: 'not_odd0000000001',
      title: null,
      url: null,
      problem:
        'Granola listed a note Atlas cannot read (its updated_at is not text); it was left out of this pull.',
    });
  });

  it('cuts a long id short, and makes a control character a space', () => {
    const { id } = unreadableSummaryProblem({ id: `a\nb${'x'.repeat(100)}`, reason: 'r' });
    expect(id).toBe(`a b${'x'.repeat(37)}…`);
    expect(unreadableSummaryProblem({ id: 'x'.repeat(40), reason: 'r' }).id).toBe('x'.repeat(40));
  });

  it('says there was no id when there was none', () => {
    expect(unreadableSummaryProblem({ id: null, reason: 'r' }).id).toBe('no id');
  });

  it('makes a C1 control a space, as it does a C0 one', () => {
    const shown = (id: string) => unreadableSummaryProblem({ id, reason: 'r' }).id;
    expect(shown('a\u0085b\u009fc\u0080d\u007fe')).toBe('a b c d e');
  });

  it('makes the bidi and zero-width characters that would reorder or hide what Activity shows a space', () => {
    const shown = (id: string) => unreadableSummaryProblem({ id, reason: 'r' }).id;
    for (const hidden of [
      '\u200e',
      '\u200f',
      '\u202a',
      '\u202b',
      '\u202c',
      '\u202d',
      '\u202e',
      '\u2066',
      '\u2067',
      '\u2068',
      '\u2069',
      '\u200b',
      '\u200c',
      '\u200d',
      '\u2060',
      '\ufeff',
      '\u061c',
    ]) {
      expect(shown(`not_${hidden}evil`)).toBe('not_ evil');
    }
  });

  it('cuts by characters, never through an emoji, and makes half of one sent alone a space', () => {
    const shown = (id: string) => unreadableSummaryProblem({ id, reason: 'r' }).id;
    expect(shown(`${'a'.repeat(39)}🙂tail`)).toBe(`${'a'.repeat(39)}🙂…`);
    expect(shown('🙂'.repeat(40))).toBe('🙂'.repeat(40));
    expect(shown('a\ud83db\ude42c')).toBe('a b c');
  });

  it('shows letters, marks, numbers, punctuation, symbols and the plain space as they are', () => {
    const shown = (id: string) => unreadableSummaryProblem({ id, reason: 'r' }).id;
    expect(shown('not_Ab9 é-ü€+ß字')).toBe('not_Ab9 é-ü€+ß字');
  });

  it('makes every other character a space, the default-ignorable ones among them, and collapses runs', () => {
    const shown = (id: string) => unreadableSummaryProblem({ id, reason: 'r' }).id;
    for (const hidden of [
      '\u00a0',
      '\u3000',
      '\u2028',
      '\u00ad',
      '\u180e',
      '\u034f',
      '\ufe0f',
      '\u3164',
      '\ue000',
      '\u{e0041}',
      '\u{e0100}',
      '\u0378',
    ]) {
      expect(shown(`not_${hidden}evil`)).toBe('not_ evil');
    }
    expect(shown('a \u200b\u00ad \u{e0041}\u{e0042}b')).toBe('a b');
  });
});

describe('granolaLateArrivalReport', () => {
  it('warns that the webhook may be off, and where to look', () => {
    expect(granolaLateArrivalReport(1)).toMatchObject({
      level: 'warning',
      kind: 'meeting',
      message: expect.stringMatching(
        /^Granola: 1 meeting came by the pull more than 2 hours after Granola had it: the webhook may be off\. Check it in Granola → Settings → Connectors → Webhooks/,
      ),
    });
    expect(granolaLateArrivalReport(3).message).toMatch(/^Granola: 3 meetings .* had them:/);
  });
});
