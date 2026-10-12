import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { applyProposal, proposedVariants, type ProposalVault } from './apply-proposal.ts';
import { proposalHeadline, readProposal, type ProposalNote } from './proposal.ts';

const TERM = createVaultPath('Terms/Larkspur Pay.md');

function term(payload: Record<string, unknown>): ProposalNote {
  const reading = readProposal({
    path: createVaultPath('Inbox/Proposals/Larkspur Pay.md'),
    properties: { type: 'proposal', kind: 'term', source: '[[Standup#^t0002]]', payload },
  });
  if (!reading.ok) throw new Error(reading.problem);
  return reading.proposal;
}

const SUGGESTED = term({
  title: 'Larkspur Pay',
  folder: 'Terms',
  properties: { kind: 'product', variants: ['Larkspar Pay'] },
});
const empty: ProposalVault = { notePaths: [], target: null };

/** P29-06: a suggested term adds a misheard spelling to the term, and makes the term only when there is none. */
describe('applyProposal — a term', () => {
  it('makes the term with its spelling when the vault has none of that name', () => {
    expect(applyProposal(SUGGESTED, empty)).toEqual({
      ok: true,
      writes: [
        {
          kind: 'create',
          path: TERM,
          properties: { type: 'term', kind: 'product', variants: ['Larkspar Pay'] },
          body: '',
        },
      ],
    });
  });

  it('adds the spelling to the term the vault has, after the ones it lists, and makes nothing', () => {
    const applied = applyProposal(SUGGESTED, {
      notePaths: [TERM],
      target: null,
      term: { path: TERM, variants: ['Lark Spur Pay'] },
    });
    expect(applied).toEqual({
      ok: true,
      writes: [
        { kind: 'set', path: TERM, changes: { variants: ['Lark Spur Pay', 'Larkspar Pay'] } },
      ],
    });
  });

  it('adds to the term wherever it is filed, not only where a new one would go', () => {
    const elsewhere = createVaultPath('Glossary/Products/Larkspur Pay.md');
    const applied = applyProposal(SUGGESTED, {
      notePaths: [elsewhere],
      target: null,
      term: { path: elsewhere, variants: [] },
    });
    expect(applied.ok && applied.writes).toEqual([
      { kind: 'set', path: elsewhere, changes: { variants: ['Larkspar Pay'] } },
    ]);
  });

  it('refuses a proposal that brings the term nothing new, and never makes a second term', () => {
    const vault = (variants: string[]): ProposalVault => ({
      notePaths: [TERM],
      target: null,
      term: { path: TERM, variants },
    });
    const refused = applyProposal(SUGGESTED, vault(['Larkspar  Pay']));
    expect(refused).toEqual({
      ok: false,
      problem:
        'There is already a term “Larkspur Pay” at Terms/Larkspur Pay.md, and it lists every misheard spelling this proposes.',
    });
    const bare = term({ title: 'Larkspur Pay', folder: 'Terms' });
    expect(applyProposal(bare, vault([])).ok).toBe(false);
    const own = term({ title: 'Larkspur Pay', properties: { variants: ['Larkspur Pay'] } });
    expect(applyProposal(own, vault([])).ok).toBe(false);
  });

  it('still refuses a note of that name that is no term the vault knows', () => {
    const applied = applyProposal(SUGGESTED, { notePaths: [TERM], target: null });
    expect(applied).toEqual({
      ok: false,
      problem:
        'There is already a note at Terms/Larkspur Pay.md, which may be this one. Edit the title to make another.',
    });
  });

  it('is refused once answered, like any proposal', () => {
    const answered = { ...SUGGESTED, state: 'accepted' } as ProposalNote;
    expect(applyProposal(answered, empty)).toEqual({ ok: false, problem: 'It was already accepted.' });
  });
});

describe('the spellings a term proposal carries', () => {
  it('are its variants, tidied, each once; none when it carries none', () => {
    const spelt = term({
      title: 'Larkspur Pay',
      properties: { variants: ['  Larkspar   Pay ', 'Larkspar Pay', '', 7, 'Lark Spa'] },
    });
    expect(proposedVariants(spelt.payload as never)).toEqual(['Larkspar Pay', 'Lark Spa']);
    expect(proposedVariants(term({ title: 'X', properties: { variants: 'Ex' } }).payload as never)).toEqual(['Ex']);
    expect(proposedVariants(term({ title: 'X' }).payload as never)).toEqual([]);
  });
});

describe('a term proposal’s headline', () => {
  it('says what was heard and what it is a mishearing of', () => {
    expect(proposalHeadline(SUGGESTED)).toBe('Larkspar Pay → Larkspur Pay');
    const two = term({ title: 'Larkspur Pay', properties: { variants: ['Lark Spa', 'Larkspar'] } });
    expect(proposalHeadline(two)).toBe('Lark Spa, Larkspar → Larkspur Pay');
  });

  it('is the term alone when it proposes no spelling', () => {
    expect(proposalHeadline(term({ title: 'Larkspur Pay' }))).toBe('Larkspur Pay');
    expect(proposalHeadline(term({ title: 'Larkspur Pay', properties: { variants: [' '] } }))).toBe(
      'Larkspur Pay',
    );
  });
});
