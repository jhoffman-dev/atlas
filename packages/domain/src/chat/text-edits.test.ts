import { describe, expect, it } from 'vitest';
import { applyTextEdits } from './text-edits.ts';

const BODY = 'Intro line.\n\n- [ ] Call Sam\n- [ ] Book flights\n\nOutro, with Sam.\n';

describe('applyTextEdits', () => {
  it('changes only the spans named, every other byte kept', () => {
    const outcome = applyTextEdits(BODY, [{ find: '- [ ] Call Sam', replace: '- [x] Call Sam' }]);
    expect(outcome).toEqual({
      ok: true,
      text: 'Intro line.\n\n- [x] Call Sam\n- [ ] Book flights\n\nOutro, with Sam.\n',
    });
  });

  it('applies several edits against the text as it was, whatever order they come in', () => {
    const edits = [
      { find: 'Outro', replace: 'End' },
      { find: 'Intro line.', replace: 'Start.' },
    ];
    const forwards = applyTextEdits(BODY, edits);
    const backwards = applyTextEdits(BODY, [...edits].reverse());
    expect(forwards).toEqual(backwards);
    expect(forwards).toMatchObject({
      ok: true,
      text: expect.stringMatching(/^Start\.[\s\S]*End, with/),
    });
  });

  it('refuses text the note does not have', () => {
    expect(applyTextEdits(BODY, [{ find: 'Call Julie', replace: 'x' }])).toMatchObject({
      ok: false,
      problem: expect.stringContaining('no text "Call Julie"'),
    });
  });

  it('refuses text that occurs more than once, which would be a guess', () => {
    expect(applyTextEdits(BODY, [{ find: 'Sam', replace: 'Samuel' }])).toMatchObject({
      ok: false,
      problem: expect.stringContaining('more than once'),
    });
  });

  it('refuses an empty find and overlapping edits', () => {
    expect(applyTextEdits(BODY, [{ find: '', replace: 'x' }])).toMatchObject({ ok: false });
    expect(
      applyTextEdits(BODY, [
        { find: 'Call Sam\n- [ ] Book', replace: 'x' },
        { find: 'Book flights', replace: 'y' },
      ]),
    ).toEqual({ ok: false, problem: 'Two edits change the same text.' });
  });

  it('shortens a long span when it names it in a refusal', () => {
    const outcome = applyTextEdits(BODY, [{ find: 'z'.repeat(100), replace: '' }]);
    expect(outcome.ok === false && outcome.problem).toContain('…');
  });
});
