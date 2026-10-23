/**
 * Verification of PR #547's fix round (#37): what an answer's code reads as
 * when its fence is left open. Fictional data only (Larkspur Payroll).
 */

import { describe, expect, it } from 'vitest';
import { citeAnswer } from './answer-citations.ts';

/** Everything an answer draws, as one string: what the reader would see. */
const drawn = (answer: string) =>
  citeAnswer(answer)
    .flatMap((block) => block.inline.map((piece) => ('text' in piece ? piece.text : piece.label)))
    .join('');

describe('citeAnswer, verified (PR #547)', () => {
  it('draws every word of a quote whose code fence is left open', () => {
    // A streamed answer, or one the model left unclosed: the code piece lost
    // its last three characters as though they were a closing fence.
    expect(drawn('> ```\n> npm install larkspur-payroll')).toContain('larkspur-payroll');
  });

  it('draws the line after a quote that opens a fence, which the editor reads as a paragraph', () => {
    expect(drawn('> ```\nLarkspur Payroll moved the run to Friday.')).toContain('Friday.');
  });

  it('ends a fence opened inside a list item with the item, so the items after it are still judged', () => {
    // The editor closes the fence at the end of the item; the reader ran it to
    // the end of the answer, so every claim after it was exempt "code".
    const blocks = citeAnswer('- Run it:\n  ```\n- Larkspur Payroll moved the run to Friday.');
    expect(blocks.at(-1)).toMatchObject({ kind: 'item', citation: 'uncited' });
  });
});
