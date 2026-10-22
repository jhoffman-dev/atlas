import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { pdfLinkTarget } from './highlight-opening.ts';

/*
 * Verification (#506, PR #522 after 54f53fc3). A name with an accent can be
 * written to disk decomposed (NFD: a file copied from an older Mac disk, a
 * zip, a sync) while the link is typed composed (NFC). Note links already
 * compare both composed (`resolveWikiLinkTarget`); a PDF link must too.
 */

describe('the PDF a link names, by a name with an accent', () => {
  it('is found though the file is written decomposed and the link composed', () => {
    const decomposed = createVaultPath('Reading/Résumé of the keepers.pdf');
    expect(pdfLinkTarget('Résumé of the keepers.pdf', [decomposed])).toBe(decomposed);
  });

  it('is found though the file is written composed and the link decomposed', () => {
    const composed = createVaultPath('Reading/Café lanterns.pdf');
    expect(pdfLinkTarget('Café lanterns.pdf', [composed])).toBe(composed);
  });
});
