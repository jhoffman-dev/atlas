import { describe, expect, it } from 'vitest';
import { updateFrontmatter } from './frontmatter-write.ts';
import { parseFrontmatterProperties } from './frontmatter.ts';

describe('updateFrontmatter', () => {
  it('changes one value and leaves the rest of the line alone', () => {
    const before = '---\ntitle: Today\nstatus: draft\n---\n';
    expect(updateFrontmatter(before, { status: 'done' })).toBe(
      '---\ntitle: Today\nstatus: done\n---\n',
    );
  });

  it('adds a key that was not there', () => {
    expect(updateFrontmatter('---\ntitle: Today\n---\n', { status: 'draft' })).toBe(
      '---\ntitle: Today\nstatus: draft\n---\n',
    );
  });

  it('removes a key when the value is cleared', () => {
    expect(updateFrontmatter('---\ntitle: Today\nstatus: draft\n---\n', { status: null })).toBe(
      '---\ntitle: Today\n---\n',
    );
  });

  it('keeps comments', () => {
    const before = '---\n# why this note exists\ntitle: Today\nstatus: draft\n---\n';
    expect(updateFrontmatter(before, { status: 'done' })).toContain('# why this note exists');
  });

  it('keeps key order, putting a new key last', () => {
    const after = updateFrontmatter('---\nb: 2\na: 1\n---\n', { c: 3 });
    expect(after).toBe('---\nb: 2\na: 1\nc: 3\n---\n');
  });

  it('keeps a block list as a block list', () => {
    const before = '---\ntags:\n  - one\n  - two\ntitle: Today\n---\n';
    const after = updateFrontmatter(before, { title: 'Tomorrow' });
    expect(after).toContain('tags:\n  - one\n  - two');
  });

  it('keeps an inline list inline', () => {
    const before = '---\ntags: [one, two]\ntitle: Today\n---\n';
    expect(updateFrontmatter(before, { title: 'Tomorrow' })).toContain('tags: [one, two]');
  });

  it('keeps quoting style on untouched values', () => {
    const before = `---\nname: "Quoted"\nother: 'single'\ntitle: Today\n---\n`;
    const after = updateFrontmatter(before, { title: 'Tomorrow' });
    expect(after).toContain('name: "Quoted"');
    expect(after).toContain("other: 'single'");
  });

  it('writes a list value', () => {
    expect(updateFrontmatter('---\ntitle: Today\n---\n', { tags: ['a', 'b'] })).toContain('tags:');
    expect(parseFrontmatterProperties(updateFrontmatter(null, { tags: ['a', 'b'] }))).toEqual({
      tags: ['a', 'b'],
    });
  });

  it('writes numbers, booleans and dates as themselves', () => {
    const after = updateFrontmatter(null, { arr: 1500000, done: true, due: '2026-09-20' });
    expect(parseFrontmatterProperties(after)).toEqual({
      arr: 1500000,
      done: true,
      due: '2026-09-20',
    });
  });

  it('quotes a value that would otherwise change meaning', () => {
    const after = updateFrontmatter(null, { title: 'yes: and no' });
    expect(parseFrontmatterProperties(after)).toEqual({ title: 'yes: and no' });
  });

  it('keeps a wiki link readable rather than escaping it', () => {
    const after = updateFrontmatter(null, { ceo: '[[Ada Lovelace]]' });
    expect(after).toContain('[[Ada Lovelace]]');
    expect(parseFrontmatterProperties(after)).toEqual({ ceo: '[[Ada Lovelace]]' });
  });

  it('creates a block for a note that had none', () => {
    expect(updateFrontmatter(null, { title: 'New' })).toBe('---\ntitle: New\n---\n');
  });

  it('fills an empty block', () => {
    expect(updateFrontmatter('---\n---\n', { title: 'New' })).toBe('---\ntitle: New\n---\n');
  });

  it('keeps CRLF line endings', () => {
    const after = updateFrontmatter('---\r\ntitle: Today\r\n---\r\n', { status: 'done' });
    expect(after.startsWith('---\r\n')).toBe(true);
    expect(after.endsWith('---\r\n')).toBe(true);
  });

  it('changes nothing when asked for no changes', () => {
    const before = '---\n# a comment\ntags: [one, two]\ntitle: Today\n---\n';
    expect(updateFrontmatter(before, {})).toBe(before);
  });

  it('does not wrap a long value onto a second line', () => {
    const long = 'x'.repeat(200);
    const after = updateFrontmatter(null, { note: long });
    expect(after).toContain(long);
  });
});

describe('wiki links in frontmatter', () => {
  it('quotes a link, because unquoted it would be a nested list', () => {
    const written = updateFrontmatter(null, { ceo: '[[Ada Lovelace]]' });
    expect(written).toContain('ceo: "[[Ada Lovelace]]"');
  });

  it('reads that link back as the text it was', () => {
    const written = updateFrontmatter(null, { ceo: '[[Ada Lovelace]]' });
    expect(parseFrontmatterProperties(written)).toEqual({ ceo: '[[Ada Lovelace]]' });
  });

  it('round-trips a list of links', () => {
    const written = updateFrontmatter(null, { employees: ['[[A]]', '[[B]]'] });
    expect(parseFrontmatterProperties(written)).toEqual({ employees: ['[[A]]', '[[B]]'] });
  });
});

describe('changing a list of maps (a dashboard’s widgets)', () => {
  const DASHBOARD = [
    '---',
    'atlas: dashboard',
    'widgets:',
    '  # the headline',
    '  - title: "Tasks"',
    '    kind: number',
    '    type: task',
    '  - title: Doing',
    '    kind: number',
    '    type: task',
    '    filters: [{key: status, operator: is, value: doing}]',
    '    owner: kept',
    '  - title: By status',
    '    kind: bar',
    '    type: task',
    '    groupBy: status',
    '    span: 8',
    '---',
    '',
  ].join('\n');
  type Entry = Record<string, unknown>;
  const widgets = () => parseFrontmatterProperties(DASHBOARD)['widgets'] as Entry[];
  const [tasks, doing, byStatus] = widgets() as [Entry, Entry, Entry];

  it('writes nothing different when the list is handed back unchanged', () => {
    expect(updateFrontmatter(DASHBOARD, { widgets: widgets() })).toBe(DASHBOARD);
  });

  it('edits one widget and leaves the others’ text exactly as it was', () => {
    const after = updateFrontmatter(DASHBOARD, {
      widgets: [tasks, { ...doing, title: 'In flight' }, byStatus],
    });
    expect(after).toBe(DASHBOARD.replace('title: Doing', 'title: In flight'));
  });

  it('moves widgets without rewriting them', () => {
    const after = updateFrontmatter(DASHBOARD, { widgets: [byStatus, tasks, doing] });
    // The comment belongs to the list, as the YAML library reads it, so it
    // stays at the list's head rather than travelling with the first widget.
    expect(after).toContain(
      [
        'widgets:',
        '  # the headline',
        '  - title: By status',
        '    kind: bar',
        '    type: task',
        '    groupBy: status',
        '    span: 8',
        '  - title: "Tasks"',
      ].join('\n'),
    );
    expect(after).toContain(
      '    filters: [{key: status, operator: is, value: doing}]\n    owner: kept',
    );
    expect(parseFrontmatterProperties(after)['widgets']).toEqual([byStatus, tasks, doing]);
  });

  it('moves a widget and resizes it in one write, keeping its inline filters', () => {
    const after = updateFrontmatter(DASHBOARD, {
      widgets: [{ ...doing, span: 4 }, tasks, byStatus],
    });
    expect(after).toContain(
      [
        '  - title: Doing',
        '    kind: number',
        '    type: task',
        '    filters: [{key: status, operator: is, value: doing}]',
        '    owner: kept',
        '    span: 4',
        '  - title: "Tasks"',
      ].join('\n'),
    );
  });

  it('removes one widget and keeps the rest as written', () => {
    const after = updateFrontmatter(DASHBOARD, { widgets: [tasks, byStatus] });
    expect(after).not.toContain('Doing');
    expect(after).toContain('  - title: "Tasks"');
    expect(parseFrontmatterProperties(after)['widgets']).toEqual([tasks, byStatus]);
  });

  it('adds a widget at the end in block style', () => {
    const after = updateFrontmatter(DASHBOARD, {
      widgets: [...widgets(), { title: 'New', kind: 'list', type: 'task' }],
    });
    expect(after).toContain('    span: 8\n  - title: New\n    kind: list\n    type: task\n---');
  });

  it('changes one key of a widget in place, keeping its unknown keys', () => {
    const after = updateFrontmatter(DASHBOARD, {
      widgets: [tasks, doing, { ...byStatus, span: 6 }],
    });
    expect(after).toContain('    groupBy: status\n    span: 6\n---');
    expect(after).toContain('    owner: kept');
  });

  it('takes a key out of a widget', () => {
    const narrow = { ...byStatus };
    delete narrow['span'];
    const after = updateFrontmatter(DASHBOARD, { widgets: [tasks, doing, narrow] });
    expect(after).toContain('    groupBy: status\n---');
  });

  it('keeps an inline list inline when an item is added', () => {
    const after = updateFrontmatter('---\ntags: [one, two]\n---\n', {
      tags: ['one', 'two', 'three'],
    });
    expect(after).toBe('---\ntags: [one, two, three]\n---\n');
  });

  it('writes a list over a scalar', () => {
    const after = updateFrontmatter('---\ntags: one\n---\n', { tags: ['one', 'two'] });
    expect(parseFrontmatterProperties(after)).toEqual({ tags: ['one', 'two'] });
  });
});

describe('updateFrontmatter — adversarial', () => {
  // The in-place list edit writes into the anchored node, so every alias of it
  // changes too: editing `reviewers` silently rewrites `watchers`.
  it('changing an anchored list leaves its aliases holding what they held', () => {
    const before = '---\nreviewers: &team [ana, bo]\nwatchers: *team\n---\n';
    const after = updateFrontmatter(before, { reviewers: ['ana', 'bo', 'cy'] });
    expect(parseFrontmatterProperties(after)).toEqual({
      reviewers: ['ana', 'bo', 'cy'],
      watchers: ['ana', 'bo'],
    });
  });

  it('changing an anchored scalar leaves its aliases holding what they held', () => {
    const before = '---\nstart: &day 2026-09-01\nreview: *day\n---\n';
    const after = updateFrontmatter(before, { start: '2026-09-08' });
    expect(parseFrontmatterProperties(after)).toEqual({
      start: '2026-09-08',
      review: '2026-09-01',
    });
  });

  it('removing an anchored key keeps the note writable and its aliases valued', () => {
    const before = '---\nstart: &day 2026-09-01\nreview: *day\n---\n';
    const after = updateFrontmatter(before, { start: null });
    expect(parseFrontmatterProperties(after)).toEqual({ review: '2026-09-01' });
  });

  // `2024: old` is read as the property "2024", but written as a second key.
  it('writes a key that YAML reads as a number over the one that is there', () => {
    const after = updateFrontmatter('---\n2024: old\n---\n', { '2024': 'new' });
    expect(after).toBe('---\n2024: new\n---\n');
  });

  // The whole block is re-stringified, so an untouched list written at zero
  // indent (Jekyll/Hugo style) or at four spaces comes back re-indented.
  it('writes an untouched zero-indent list back as it was found', () => {
    const before = '---\ntags:\n- a\n- b\nstatus: draft\n---\n';
    expect(updateFrontmatter(before, { status: 'done' })).toBe(
      '---\ntags:\n- a\n- b\nstatus: done\n---\n',
    );
  });

  it('changes an item of a zero-indent list and keeps the list at zero indent', () => {
    const before = '---\ntags:\n- a\n- b\nstatus: draft\n---\n';
    expect(updateFrontmatter(before, { tags: ['a', 'c'] })).toBe(
      '---\ntags:\n- a\n- c\nstatus: draft\n---\n',
    );
  });

  it('changes an item of a four-space list and keeps its four spaces', () => {
    const before = '---\ntags:\n    - a\n    - b\n---\n';
    expect(updateFrontmatter(before, { tags: ['c', 'b'] })).toBe(
      '---\ntags:\n    - c\n    - b\n---\n',
    );
  });

  it('keeps a changed list of maps at the indent it was written at', () => {
    const before = '---\nwidgets:\n- kind: a\n  size: 1\n- kind: b\n---\n';
    expect(updateFrontmatter(before, { widgets: [{ kind: 'a', size: 2 }, { kind: 'b' }] })).toBe(
      '---\nwidgets:\n- kind: a\n  size: 2\n- kind: b\n---\n',
    );
  });

  it('writes a new list at the usual two spaces', () => {
    const before = '---\ntags:\n- a\n---\n';
    expect(updateFrontmatter(before, { aliases: ['x'] })).toBe(
      '---\ntags:\n- a\naliases:\n  - x\n---\n',
    );
  });

  it('writes an untouched folded string back as it was found', () => {
    const before = '---\nsummary: >\n  one\n  two\nstatus: draft\n---\n';
    expect(updateFrontmatter(before, { status: 'done' })).toBe(
      '---\nsummary: >\n  one\n  two\nstatus: done\n---\n',
    );
  });

  it('keeps CRLF on the lines inside the block it did not touch', () => {
    const before = '---\r\ntitle: Today\r\nstatus: draft\r\n---\r\n';
    expect(updateFrontmatter(before, { status: 'done' })).toBe(
      '---\r\ntitle: Today\r\nstatus: done\r\n---\r\n',
    );
  });
});

describe('anchors and aliases', () => {
  const read = parseFrontmatterProperties;

  it('changing an anchored map leaves its aliases holding what they held', () => {
    const before = '---\nmine: &m\n  x: 1\n  y: 2\nyours: *m\n---\n';
    const after = updateFrontmatter(before, { mine: { x: 1, y: 3 } });
    expect(read(after)).toEqual({ mine: { x: 1, y: 3 }, yours: { x: 1, y: 2 } });
  });

  it('moves the anchor to the first alias, so later aliases still share it', () => {
    const before = '---\nlead: &t [a, b]\nsecond: *t\nthird: *t\n---\n';
    const after = updateFrontmatter(before, { lead: ['c'] });
    expect(after).toBe('---\nlead: [c]\nsecond: &t [a, b]\nthird: *t\n---\n');
  });

  it('keeps an anchor nobody refers to on the node it edits', () => {
    const before = '---\ntags: &t [a, b]\n---\n';
    expect(updateFrontmatter(before, { tags: ['a', 'b', 'c'] })).toBe(
      '---\ntags: &t [a, b, c]\n---\n',
    );
  });

  it('changing an alias writes the new value there and leaves the anchor alone', () => {
    const before = '---\ntags: &t [a, b]\nother: *t\n---\n';
    const after = updateFrontmatter(before, { other: ['z'] });
    expect(after).toBe('---\ntags: &t [a, b]\nother:\n  - z\n---\n');
  });

  it('keeps a merge key when the map that merges is edited', () => {
    const before = '---\nbase: &b\n  x: 1\nchild:\n  <<: *b\n  y: 2\n---\n';
    const child = read(before)['child'] as Record<string, unknown>;
    const after = updateFrontmatter(before, { child: { ...child, y: 3 } });
    expect(after).toBe('---\nbase: &b\n  x: 1\nchild:\n  <<: *b\n  y: 3\n---\n');
  });

  it('editing the map a merge key points at leaves the merging map as it was', () => {
    const before = '---\nbase: &b\n  x: 1\nchild:\n  <<: *b\n  y: 2\n---\n';
    const after = updateFrontmatter(before, { base: { x: 5 } });
    expect(read(after)).toEqual({ base: { x: 5 }, child: { '<<': { x: 1 }, y: 2 } });
  });

  it('changing a list whose item is anchored keeps that item for its aliases', () => {
    const before = '---\nlist: [&first a, b]\npick: *first\n---\n';
    const after = updateFrontmatter(before, { list: ['z'] });
    expect(read(after)).toEqual({ list: ['z'], pick: 'a' });
  });
});

describe('untouched keys are written back byte for byte', () => {
  it('keeps trailing spaces and a tab before a comment on keys it did not change', () => {
    const before = '---\ntitle: Today   \nowner: me\t# who\nstatus: draft\n---\n';
    expect(updateFrontmatter(before, { status: 'done' })).toBe(
      '---\ntitle: Today   \nowner: me\t# who\nstatus: done\n---\n',
    );
  });

  it('keeps a four-space indented list it did not change', () => {
    const before = '---\ntags:\n    - a\n    - b\nstatus: draft\n---\n';
    expect(updateFrontmatter(before, { status: 'done' })).toBe(
      '---\ntags:\n    - a\n    - b\nstatus: done\n---\n',
    );
  });

  it('keeps CRLF on a key it adds and one it changes', () => {
    const before = '---\r\ntags:\r\n  - a\r\nstatus: draft\r\n---\r\n';
    expect(updateFrontmatter(before, { status: 'done', tags: ['a', 'b'], due: 1 })).toBe(
      '---\r\ntags:\r\n  - a\r\n  - b\r\nstatus: done\r\ndue: 1\r\n---\r\n',
    );
  });
});

describe('a flow-map frontmatter block (A20-05)', () => {
  const flow = '---\n{title: Plan, status: open}\n---\n';

  it('changes one value and keeps the block a readable flow map', () => {
    expect(updateFrontmatter(flow, { status: 'done' })).toBe(
      '---\n{title: Plan, status: done}\n---\n',
    );
  });

  it('adds a key that every reader still sees alongside the old ones', () => {
    const after = updateFrontmatter(flow, { archived: '2026-09-27' });
    expect(parseFrontmatterProperties(after)).toEqual({
      title: 'Plan',
      status: 'open',
      archived: '2026-09-27',
    });
  });

  it('gives back the same bytes when a key added is removed again', () => {
    const added = updateFrontmatter(flow, { archived: '2026-09-27', archivedFrom: 'A/B.md' });
    expect(updateFrontmatter(added, { archived: null, archivedFrom: null })).toBe(flow);
  });

  it('removes a key and keeps the rest', () => {
    expect(updateFrontmatter(flow, { status: null })).toBe('---\n{title: Plan}\n---\n');
  });
});

describe('removing a key that is not there (A20-05)', () => {
  it.each([
    ['a comment-only block', '---\n# owner: James\n---\n'],
    ['an empty block', '---\n---\n'],
    ['a flow map', '---\n{title: Plan}\n---\n'],
    ['a block map with a trailing comment', '---\ntitle: Plan # working\n---\n'],
  ])('leaves %s byte for byte', (_, before) => {
    expect(updateFrontmatter(before, { archived: null })).toBe(before);
  });
});

describe('a block behind a byte-order mark (A20-05)', () => {
  it('changes the block in place and keeps the mark', () => {
    expect(updateFrontmatter('\uFEFF---\ntitle: Plan\n---\n', { status: 'open' })).toBe(
      '\uFEFF---\ntitle: Plan\nstatus: open\n---\n',
    );
  });
});

describe('removing the last key (A20-05)', () => {
  it('leaves just the delimiters, not a `{}`', () => {
    expect(updateFrontmatter('---\ntitle: A\n---\n', { title: null })).toBe('---\n---\n');
    expect(updateFrontmatter('---\r\ntitle: A\r\n---\r\n', { title: null })).toBe('---\r\n---\r\n');
  });

  it('keeps the comments that head the block', () => {
    const added = updateFrontmatter('---\n# owner: James\n---\n', { archived: '2026-09-27' });
    expect(parseFrontmatterProperties(added)).toEqual({ archived: '2026-09-27' });
    expect(updateFrontmatter(added, { archived: null })).toBe('---\n# owner: James\n---\n');
  });

  it('leaves a flow map as `{}`, still a flow map', () => {
    expect(updateFrontmatter('---\n{title: A}\n---\n', { title: null })).toBe('---\n{}\n---\n');
  });
});

describe('a view saved with a sub-grouping (issue #6)', () => {
  const VIEW = [
    '---',
    'atlas: view',
    'type: task',
    'layout: board   # by status',
    'groupBy: status',
    "columns: [status, 'phase']",
    'limit: 500',
    '---',
    '',
  ].join('\n');

  it('adds subGroupBy and leaves every other line exactly as written', () => {
    const after = updateFrontmatter(VIEW, { subGroupBy: 'project' });
    expect(after).toBe(VIEW.replace('limit: 500\n', 'limit: 500\nsubGroupBy: project\n'));
  });

  it('takes it out again, giving back the bytes it started from', () => {
    const added = updateFrontmatter(VIEW, { subGroupBy: 'project' });
    expect(updateFrontmatter(added, { subGroupBy: null })).toBe(VIEW);
  });

  it('writes a card’s column and lane as one change to two lines', () => {
    const task = '---\ntype: task   # kept\nstatus: backlog\narea: home\ndue: 2026-10-03\n---\n';
    expect(updateFrontmatter(task, { status: 'doing', area: 'work' })).toBe(
      '---\ntype: task   # kept\nstatus: doing\narea: work\ndue: 2026-10-03\n---\n',
    );
  });
});
