import { describe, expect, it } from 'vitest';
import type { VaultPath } from '../vault/vault-path.ts';
import { noteNames } from '../types/relation-names.ts';
import { cardMeta } from './card-meta.ts';
import { hueOf, relationHue } from './pill-colour.ts';

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

  it('writes each linked note as its own item: missing ones struck, present ones in their hue', () => {
    const names = noteNames([{ path: 'Here.md' as VaultPath, title: 'Here' }]);
    const gone = cardMeta({ fields: ['project'], kinds, values: { project: '[[Gone]]' }, names });
    expect(gone).toEqual([{ key: 'project', text: 'Gone', missing: true }]);
    const some = cardMeta({
      fields: ['project'],
      kinds,
      values: { project: ['[[Gone]]', '[[Here]]'] },
      names,
    });
    expect(some).toEqual([
      { key: 'project', text: 'Gone', missing: true },
      { key: 'project#1', text: 'Here', missing: false, color: relationHue({ key: 'Here' }) },
    ]);
  });

  it('colours an aliased link as the note it names, before titles load and after', () => {
    const names = noteNames([{ path: 'co/larkspur.md' as VaultPath, title: 'Larkspur Payroll' }]);
    const color = (value: string, known = names) =>
      cardMeta({ fields: ['project'], kinds, values: { project: value }, names: known })[0]?.color;
    const plain = color('[[larkspur]]');
    expect(plain).toBe(relationHue({ key: 'larkspur' }));
    expect(color('[[larkspur|Payroll people]]')).toBe(plain);
    expect(color('[[co/larkspur]]')).toBe(plain);
    expect(color('[[larkspur]]', noteNames(null))).toBe(plain);
  });

  it('colours a choice by the colour its type chose, else by its value', () => {
    const items = cardMeta({
      fields: ['stage', 'kind'],
      kinds: { ...kinds, kind: 'select' },
      values: { stage: 'Interview', kind: 'Interview' },
      colors: { stage: { Interview: 'green' } },
    });
    expect(items.map((item) => item.color)).toEqual(['green', hueOf('Interview')]);
  });

  it('writes each of a multi-select’s options as its own pill, as the note writes it', () => {
    const items = cardMeta({
      fields: ['labels'],
      kinds: { labels: 'multiSelect' },
      values: { labels: ['payroll', 'renewal'] },
    });
    expect(items).toEqual([
      { key: 'labels', text: 'payroll', missing: false, color: hueOf('payroll') },
      { key: 'labels#1', text: 'renewal', missing: false, color: hueOf('renewal') },
    ]);
  });

  it('leaves out an empty chip, so a line can be empty', () => {
    expect(cardMeta({ fields: ['estimate', 'title'], kinds, values: { estimate: '' } })).toEqual(
      [],
    );
  });
});
