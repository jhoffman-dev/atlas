import { describe, expect, it } from 'vitest';
import { keepCitedItems, nothingCitedProblem, UNCITED_REASON } from './cited-items.ts';

/** #40: every item of a note written from DFAI's data links a note it was given. */

const SOURCES = new Set(['Tasks/Send the file.md', 'Projects/Larkspur launch.md']);
const cite = (body: string) => keepCitedItems({ body, sources: SOURCES });

describe('keepCitedItems', () => {
  it('keeps an item that links a source by path, with or without .md, a heading or a label', () => {
    for (const link of [
      '[[Tasks/Send the file.md]]',
      '[[Tasks/Send the file]]',
      '[[Tasks/Send the file|the file]]',
      '[[Tasks/Send the file.md#Notes]]',
      '[[ Tasks/Send the file.md ]]',
    ]) {
      const body = `## Wins\n\n- Sent it: ${link}\n`;
      expect(cite(body)).toEqual({ body, dropped: [], kept: 1 });
    }
  });

  it('leaves out an item that links nothing, or a note it was not given, and says which', () => {
    const body = [
      '## Wins',
      '- Shipped [[Tasks/Send the file.md]]',
      '- Closed the quarter',
      '* Met [[Meetings/Somewhere else.md]]',
      '1. Chased [[Send the file]]',
      '2) Planned [[Projects/Larkspur launch]]',
      '',
    ].join('\n');
    const cited = cite(body);
    expect(cited.body).toBe(
      [
        '## Wins',
        '- Shipped [[Tasks/Send the file.md]]',
        '2) Planned [[Projects/Larkspur launch]]',
        '',
      ].join('\n'),
    );
    expect(cited.kept).toBe(2);
    expect(cited.dropped).toEqual([
      { title: 'Closed the quarter', reason: UNCITED_REASON },
      { title: 'Met [[Meetings/Somewhere else.md]]', reason: UNCITED_REASON },
      { title: 'Chased [[Send the file]]', reason: UNCITED_REASON },
    ]);
  });

  it('keeps an item with one link to a source among others', () => {
    const body = '- [[Tasks/Send the file.md]] for [[People/Mara Quill]]\n';
    expect(cite(body).kept).toBe(1);
  });

  it('holds nested items and task boxes to it too', () => {
    const body =
      '- [[Tasks/Send the file.md]]\n  - a detail with no link\n- [ ] [[Projects/Larkspur launch.md]]\n';
    const cited = cite(body);
    expect(cited.body).toBe(
      '- [[Tasks/Send the file.md]]\n- [ ] [[Projects/Larkspur launch.md]]\n',
    );
    expect(cited.dropped.map(({ title }) => title)).toEqual(['a detail with no link']);
  });

  it('does not take a link in code for a citation', () => {
    const cited = cite('- see `[[Tasks/Send the file.md]]`\n');
    expect(cited.kept).toBe(0);
    expect(cited.dropped).toHaveLength(1);
  });

  it('leaves headings, sentences, rules and fenced lines as they are', () => {
    const body = [
      '# Weekly review 2026-10-23',
      '',
      'The Inbox holds 4 notes to file and 2 proposals to answer.',
      '',
      '---',
      '* * *',
      '```',
      '- not an item, inside a fence',
      '~~~',
      '- still inside the fence',
      '```',
      '-not an item without a space',
      '',
    ].join('\n');
    expect(cite(body)).toEqual({ body, dropped: [], kept: 0 });
  });

  it('closes a fence only with its own marker', () => {
    const body = '~~~\n- inside\n```\n- still inside\n~~~\n- outside\n';
    const cited = cite(body);
    expect(cited.dropped.map(({ title }) => title)).toEqual(['outside']);
  });
});

describe('nothingCitedProblem', () => {
  it('refuses a note that had items and kept none', () => {
    expect(nothingCitedProblem(cite('- one\n- two\n'))).toBe(
      'None of its 2 items links a task, project or meeting it was given.',
    );
  });

  it('lets a note with no items, or with one kept, through', () => {
    expect(nothingCitedProblem(cite('Nothing this week.\n'))).toBeNull();
    expect(nothingCitedProblem(cite('- [[Tasks/Send the file.md]]\n- none\n'))).toBeNull();
  });
});
