import { describe, expect, it } from 'vitest';
import type { VaultPath } from '../vault/vault-path.ts';
import { noteNames } from '../types/relation-names.ts';
import { cardMeta } from './card-meta.ts';

describe('cardMeta', () => {
  const kinds = {
    status: 'select',
    stage: 'select',
    phase: 'number',
    project: 'relation',
  } as const;
  const texts = (items: ReturnType<typeof cardMeta>) => items.map((item) => item.text);

  it('writes the values in the view’s order, a choice as its label and the rest as its chip’s text', () => {
    const items = cardMeta({
      fields: ['phase', 'stage', 'estimate'],
      kinds,
      values: { phase: 14, stage: 'review', estimate: '3h' },
    });
    expect(texts(items)).toEqual(['Phase 14', 'Review', '3h']);
    expect(items.map((item) => item.key)).toEqual(['phase', 'stage', 'estimate']);
  });

  it('leaves out the column’s property and the lane’s: the board already says them', () => {
    const items = cardMeta({
      fields: ['status', 'stage', 'phase'],
      groupBy: 'status',
      laneBy: 'stage',
      kinds,
      values: { status: 'doing', stage: 'review', phase: 2 },
    });
    expect(texts(items)).toEqual(['Phase 2']);
  });

  it.each([null, undefined, '', '   ', false])('leaves out a choice of %j', (value) => {
    expect(cardMeta({ fields: ['stage'], kinds, values: { stage: value } })).toEqual([]);
  });

  it('writes a choice held as a number as that number', () => {
    expect(texts(cardMeta({ fields: ['stage'], kinds, values: { stage: 3 } }))).toEqual(['3']);
  });

  it('writes a ticked boolean with no declared kind as its name, as a chip does', () => {
    expect(texts(cardMeta({ fields: ['flagged'], kinds, values: { flagged: true } }))).toEqual([
      'Flagged',
    ]);
  });

  it('writes a field listed twice once', () => {
    expect(texts(cardMeta({ fields: ['phase', 'phase'], kinds, values: { phase: 2 } }))).toEqual([
      'Phase 2',
    ]);
  });

  it('marks a relation whose every note is missing, and not one with a note present', () => {
    const names = noteNames([{ path: 'Here.md' as VaultPath, title: 'Here' }]);
    const gone = cardMeta({ fields: ['project'], kinds, values: { project: '[[Gone]]' }, names });
    expect(gone).toEqual([{ key: 'project', text: 'Gone', missing: true }]);
    const some = cardMeta({
      fields: ['project'],
      kinds,
      values: { project: ['[[Gone]]', '[[Here]]'] },
      names,
    });
    expect(some[0]?.missing).toBe(false);
  });

  it('leaves out an empty chip, so a line can be empty', () => {
    expect(cardMeta({ fields: ['estimate', 'title'], kinds, values: { estimate: '' } })).toEqual(
      [],
    );
  });
});
