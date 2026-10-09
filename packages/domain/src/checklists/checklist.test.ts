import { describe, expect, it } from 'vitest';
import type { EditorDocument, EditorNode } from '../markdown/editor-node.ts';
import { parseObjectType } from '../types/property-def.ts';
import { checklistLines, checklistProgress, mayHoldChecklist } from './checklist.ts';
import {
  carriesChecklistProgress,
  rowChecklistProgress,
  withChecklistProgress,
} from './progress-field.ts';

const text = (value: string): EditorNode => ({ type: 'text', text: value });
const paragraph = (...content: EditorNode[]): EditorNode => ({ type: 'paragraph', content });
const box = (words: string, checked: boolean, ...nested: EditorNode[]): EditorNode => ({
  type: 'taskItem',
  attrs: { checked },
  content: [paragraph(text(words)), ...nested],
});
const tasks = (...items: EditorNode[]): EditorNode => ({ type: 'taskList', content: items });
const doc = (...content: EditorNode[]): EditorDocument => ({ type: 'doc', content });

describe('checklistLines', () => {
  it('reads every box in order, ticked or not, with where it is', () => {
    const lines = checklistLines(
      doc(
        paragraph(text('Before the list')),
        tasks(box('Book the hall', true), box('Order chairs', false)),
      ),
    );
    expect(lines).toEqual([
      { at: [1, 0], done: true, text: 'Book the hall' },
      { at: [1, 1], done: false, text: 'Order chairs' },
    ]);
  });

  it('reads a nested box after the one it is under, and only its own words for each', () => {
    const lines = checklistLines(
      doc(tasks(box('Plan the party', false, tasks(box('Pick a date', true))))),
    );
    expect(lines).toEqual([
      { at: [0, 0], done: false, text: 'Plan the party' },
      { at: [0, 0, 1, 0], done: true, text: 'Pick a date' },
    ]);
  });

  it('reads a box inside a quote, and squeezes the spaces in its words', () => {
    const quoted: EditorNode = {
      type: 'blockquote',
      content: [tasks(box('  Ring   Mara  Quill ', false))],
    };
    expect(checklistLines(doc(quoted))).toEqual([
      { at: [0, 0, 0], done: false, text: 'Ring Mara Quill' },
    ]);
  });

  it('reads a link on the line as its words, and an empty box as no words', () => {
    const linked: EditorNode = {
      type: 'taskItem',
      attrs: { checked: false },
      content: [
        paragraph(text('Ask '), {
          type: 'wikiLink',
          attrs: { target: 'Tobias Fenn', heading: null, alias: null },
        }),
      ],
    };
    const empty: EditorNode = { type: 'taskItem', attrs: { checked: false }, content: [] };
    expect(checklistLines(doc(tasks(linked, empty))).map((line) => line.text)).toEqual([
      'Ask Tobias Fenn',
      '',
    ]);
  });

  it('finds nothing in a note with plain lists only', () => {
    const bullets: EditorNode = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [paragraph(text('Not a box'))] }],
    };
    expect(checklistLines(doc(bullets))).toEqual([]);
  });
});

describe('checklistProgress', () => {
  const lines = (...done: boolean[]) => done.map((ticked) => ({ done: ticked }));

  it('is the share ticked, as a whole percentage: 2 of 5 is 40', () => {
    expect(checklistProgress(lines(true, false, true, false, false))).toBe(40);
  });

  it('rounds down, so a box still open never reads as 100', () => {
    expect(checklistProgress(lines(true, true, false))).toBe(66);
    expect(checklistProgress([...lines(...Array<boolean>(199).fill(true)), { done: false }])).toBe(
      99,
    );
  });

  it('is 100 with every box ticked, and 0 with none', () => {
    expect(checklistProgress(lines(true, true))).toBe(100);
    expect(checklistProgress(lines(false, false))).toBe(0);
  });

  it('is null for a note with no box', () => {
    expect(checklistProgress([])).toBeNull();
  });
});

describe('mayHoldChecklist', () => {
  it.each([
    '- [ ] Open\n',
    '- [x] Done\n',
    '* [X] Done\n',
    '+ [ ] Plus\n',
    '1. [ ] Numbered\n',
    '2) [ ] Numbered\n',
    'Intro\n\n  - [ ] Indented\n',
    '\t- [ ] Tabbed\n',
    '> - [ ] Quoted\n',
    '> [!note]\n> - [ ] In a callout\n',
    '- [ ]\n',
  ])('says yes to a box in %j', (body) => {
    expect(mayHoldChecklist(body)).toBe(true);
  });

  it.each(['- Not a box\n', 'See [ ] here\n', '-[ ] no space\n', '- [y] not a box\n', ''])(
    'says no to %j',
    (body) => {
      expect(mayHoldChecklist(body)).toBe(false);
    },
  );
});

describe('carriesChecklistProgress', () => {
  it('is true of a type with no property of that name', () => {
    expect(carriesChecklistProgress(parseObjectType({ name: 'task', properties: {} }))).toBe(true);
  });

  it('is false of a type that declares its own, in any case', () => {
    const own = parseObjectType({ name: 'project', properties: { Progress: 'number' } });
    expect(carriesChecklistProgress(own)).toBe(false);
  });
});

describe('rowChecklistProgress', () => {
  it('is the row’s progress, as a number', () => {
    expect(rowChecklistProgress({ values: { progress: 40 }, kinds: { status: 'select' } })).toBe(
      40,
    );
    expect(rowChecklistProgress({ values: { progress: 0 }, kinds: {} })).toBe(0);
  });

  it('is null for a row with no checklist', () => {
    expect(rowChecklistProgress({ values: { progress: null }, kinds: {} })).toBeNull();
    expect(rowChecklistProgress({ values: {}, kinds: {} })).toBeNull();
    expect(rowChecklistProgress({ values: { progress: '40' }, kinds: {} })).toBeNull();
  });

  it('is null when the type declares a progress of its own, in any case', () => {
    expect(
      rowChecklistProgress({ values: { progress: 40 }, kinds: { Progress: 'number' } }),
    ).toBeNull();
  });
});

describe('withChecklistProgress', () => {
  const query = { type: 'task', columns: ['status'], filters: [], sorts: [], limit: 50 };
  const task = parseObjectType({ name: 'task', properties: {} });

  it('reads progress as a column of a type that has it, once', () => {
    expect(withChecklistProgress(query, task).columns).toEqual(['status', 'progress']);
    const asked = { ...query, columns: ['progress'] };
    expect(withChecklistProgress(asked, task)).toBe(asked);
  });

  it('leaves a query of a type with its own, or of no known type, as it is', () => {
    const own = parseObjectType({ name: 'goal', properties: { progress: 'number' } });
    expect(withChecklistProgress(query, own)).toBe(query);
    expect(withChecklistProgress(query, null)).toBe(query);
  });
});
