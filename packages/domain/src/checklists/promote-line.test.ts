import { describe, expect, it } from 'vitest';
import type { EditorDocument, EditorNode } from '../markdown/editor-node.ts';
import {
  inheritedProject,
  lineBlockId,
  promotedTaskName,
  promotedTaskProperties,
  promotedTaskStatus,
  withPromotedLine,
} from './promote-line.ts';

const text = (value: string): EditorNode => ({ type: 'text', text: value });
const paragraph = (...content: EditorNode[]): EditorNode => ({ type: 'paragraph', content });
const box = (words: string, checked: boolean, ...nested: EditorNode[]): EditorNode => ({
  type: 'taskItem',
  attrs: { checked },
  content: [paragraph(text(words)), ...nested],
});
const tasks = (...items: EditorNode[]): EditorNode => ({ type: 'taskList', content: items });
const doc = (...content: EditorNode[]): EditorDocument => ({ type: 'doc', content });
const linkTo = (target: string): EditorNode => ({
  type: 'wikiLink',
  attrs: { target, heading: null, alias: null },
});

describe('promotedTaskName', () => {
  it('is the line as written when a file and a link can both hold it', () => {
    expect(promotedTaskName('Call the printer about toner')).toBe('Call the printer about toner');
  });

  it('leaves out what a file name or a link cannot hold', () => {
    expect(promotedTaskName('Fix #12: the a/b [draft] ^old | now')).toBe(
      'Fix 12 the a b draft old now',
    );
  });

  it('is empty when nothing usable is left', () => {
    expect(promotedTaskName(' [[ ]] ')).toBe('');
  });
});

describe('inheritedProject', () => {
  it('is the note the line is in, when that note is a project', () => {
    expect(
      inheritedProject({ properties: { type: 'project' }, linkToSource: 'Larkspur launch' }),
    ).toBe('[[Larkspur launch]]');
  });

  it('is the note the line is in, when that note is an area', () => {
    expect(inheritedProject({ properties: { type: 'area' }, linkToSource: 'Home' })).toBe(
      '[[Home]]',
    );
  });

  it('is what the note is filed under, as it writes it, when it is anything else', () => {
    expect(
      inheritedProject({
        properties: { type: 'task', project: '[[Larkspur launch]]' },
        linkToSource: 'Plan the launch',
      }),
    ).toBe('[[Larkspur launch]]');
  });

  it('is none when the note is filed under nothing', () => {
    expect(
      inheritedProject({ properties: { type: 'task', project: '' }, linkToSource: 'Plan' }),
    ).toBeNull();
    expect(inheritedProject({ properties: {}, linkToSource: 'Scratch' })).toBeNull();
  });
});

describe('promotedTaskProperties', () => {
  it('is a task in its starting status, sourced at the line, filed where the line was', () => {
    expect(
      promotedTaskProperties({
        status: 'inbox',
        linkToSource: 'Plan the launch',
        blockId: 'k3x9q1',
        project: '[[Larkspur launch]]',
      }),
    ).toEqual({
      type: 'task',
      status: 'inbox',
      source: '[[Plan the launch#^k3x9q1]]',
      project: '[[Larkspur launch]]',
    });
  });

  it('leaves the status and the project out when there are none to give', () => {
    expect(
      promotedTaskProperties({
        status: null,
        linkToSource: 'notes/Plan',
        blockId: 'a1',
        project: null,
      }),
    ).toEqual({ type: 'task', source: '[[notes/Plan#^a1]]' });
  });
});

describe('withPromotedLine', () => {
  it('makes the line a link to its task, carrying the id the task names, box as it was', () => {
    const before = doc(tasks(box('Book the hall', true), box('Order chairs', false)));
    const after = withPromotedLine(before, {
      at: [0, 1],
      blockId: 'k3x9q1',
      linkToTask: 'Order chairs',
    });
    expect(after).toEqual(
      doc(
        tasks(box('Book the hall', true), {
          type: 'taskItem',
          attrs: { checked: false, anchor: 'k3x9q1' },
          content: [paragraph(linkTo('Order chairs'))],
        }),
      ),
    );
  });

  it('keeps the lines nested under it, and the blocks around it', () => {
    const nested = tasks(box('Pick a date', false));
    const before = doc(paragraph(text('Intro')), tasks(box('Plan the party', false, nested)));
    const after = withPromotedLine(before, { at: [1, 0], blockId: 'b2', linkToTask: 'Party' });
    expect(after?.content[0]).toBe(before.content[0]);
    expect(after?.content[1]?.content?.[0]?.content?.[1]).toBe(nested);
    expect(after?.content[1]?.content?.[0]?.content?.[0]).toEqual(paragraph(linkTo('Party')));
  });

  it('promotes a line nested under another, leaving the one above as it was', () => {
    const before = doc(tasks(box('Plan the party', false, tasks(box('Pick a date', true)))));
    const after = withPromotedLine(before, {
      at: [0, 0, 1, 0],
      blockId: 'c3',
      linkToTask: 'Pick a date',
    });
    const outer = after?.content[0]?.content?.[0];
    expect(outer?.content?.[0]).toEqual(paragraph(text('Plan the party')));
    expect(outer?.attrs).toEqual({ checked: false });
    expect(outer?.content?.[1]?.content?.[0]).toEqual({
      type: 'taskItem',
      attrs: { checked: true, anchor: 'c3' },
      content: [paragraph(linkTo('Pick a date'))],
    });
  });

  it('is null where there is no checklist line', () => {
    const before = doc(paragraph(text('Not a box')), tasks(box('A box', false)));
    expect(withPromotedLine(before, { at: [0], blockId: 'x', linkToTask: 'X' })).toBeNull();
    expect(withPromotedLine(before, { at: [1], blockId: 'x', linkToTask: 'X' })).toBeNull();
    expect(withPromotedLine(before, { at: [1, 4], blockId: 'x', linkToTask: 'X' })).toBeNull();
    expect(withPromotedLine(before, { at: [7, 0], blockId: 'x', linkToTask: 'X' })).toBeNull();
    expect(withPromotedLine(before, { at: [], blockId: 'x', linkToTask: 'X' })).toBeNull();
  });
});

describe('promotedTaskStatus', () => {
  it('is where a captured task starts, for an open line', () => {
    expect(promotedTaskStatus({ captured: 'inbox', done: false })).toBe('inbox');
  });

  it('is Archive for a ticked line, which is done', () => {
    expect(promotedTaskStatus({ captured: 'inbox', done: true })).toBe('archive');
  });

  it('is none in a vault on statuses of its own, ticked or not', () => {
    expect(promotedTaskStatus({ captured: null, done: false })).toBeNull();
    expect(promotedTaskStatus({ captured: null, done: true })).toBeNull();
  });
});

describe('lineBlockId', () => {
  const anchored = (words: string, anchor: string): EditorNode => ({
    type: 'taskItem',
    attrs: { checked: false, anchor },
    content: [paragraph(text(words))],
  });

  it('is the id the line carries when that id names it', () => {
    expect(lineBlockId(doc(tasks(box('A', false), anchored('B', 'q1'))), [0, 1])).toBe('q1');
  });

  it('is null for a line with no id', () => {
    expect(lineBlockId(doc(tasks(box('A', false))), [0, 0])).toBeNull();
  });

  it('is null when an earlier block holds the same id, which names that one', () => {
    const earlier = { ...paragraph(text('Said first')), attrs: { anchor: 'q1' } };
    expect(lineBlockId(doc(earlier, tasks(anchored('B', 'q1'))), [1, 0])).toBeNull();
  });
});
