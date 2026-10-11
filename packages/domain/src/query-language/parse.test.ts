import { describe, expect, it } from 'vitest';
import { fieldText, type AtlasQuery, type Expression } from './ast.ts';
import { parseAtlasQuery } from './parse.ts';
import { printAtlasQuery } from './print.ts';
import { QueryTextError } from './query-text-error.ts';

/** The problem a text has, with the text it points at. */
function problem(text: string): { message: string; at: string } {
  try {
    parseAtlasQuery(text);
  } catch (error) {
    if (!(error instanceof QueryTextError)) throw error;
    return { message: error.message, at: text.slice(error.span.start, error.span.end) };
  }
  throw new Error(`expected ${JSON.stringify(text)} not to parse`);
}

/** An expression with the places left out, to compare shapes. */
function shape(expression: Expression | null): unknown {
  if (expression === null) return null;
  switch (expression.kind) {
    case 'compare':
      return [fieldText(expression.field), expression.op, expression.value];
    case 'empty':
      return [fieldText(expression.field), expression.negated ? 'IS NOT EMPTY' : 'IS EMPTY'];
    case 'linksTo':
      return ['LINKS TO', expression.value];
    case 'not':
      return ['NOT', shape(expression.operand)];
    default:
      return [expression.kind, ...expression.operands.map(shape)];
  }
}

const where = (text: string) => shape(parseAtlasQuery(`FROM task WHERE ${text}`).where);
const valueOf = (text: string) => {
  const parsed = parseAtlasQuery(`FROM task WHERE x = ${text}`).where;
  if (parsed?.kind !== 'compare') throw new Error('not a comparison');
  return Object.fromEntries(Object.entries(parsed.value).filter(([key]) => key !== 'span'));
};

describe('parseAtlasQuery: the example from U-23', () => {
  const text =
    'FROM task, project WHERE status != done AND project.owner = [[Julie]] AND tag = #q3 SORT BY due GROUP BY project THEN status';
  const query = parseAtlasQuery(text);

  it('reads the types, in order', () => {
    expect(query.from.map((name) => name.text)).toEqual(['task', 'project']);
  });

  it('reads the conditions, joined by AND', () => {
    expect(shape(query.where)).toEqual([
      'and',
      ['status', '!=', expect.objectContaining({ kind: 'text', text: 'done' })],
      ['project.owner', '=', expect.objectContaining({ kind: 'link', target: 'Julie' })],
      ['tag', '=', expect.objectContaining({ kind: 'tag', name: 'q3' })],
    ]);
  });

  it('reads the sort, and the group then the sub-group', () => {
    expect(query.sort.map((key) => [fieldText(key.field), key.direction])).toEqual([
      ['due', 'asc'],
    ]);
    expect(query.group.map(fieldText)).toEqual(['project', 'status']);
  });

  it('remembers where each part is in the text', () => {
    const owner = query.where?.kind === 'and' ? query.where.operands[1] : null;
    expect(owner?.kind).toBe('compare');
    if (owner?.kind !== 'compare') return;
    expect(text.slice(owner.span.start, owner.span.end)).toBe('project.owner = [[Julie]]');
    expect(text.slice(owner.field.via?.span.start, owner.field.via?.span.end)).toBe('project');
  });

  it('leaves archived notes out and the limit to the app, unless told otherwise', () => {
    expect(query.includeArchived).toBe(false);
    expect(query.limit).toBeNull();
    expect(query.show).toEqual([]);
  });
});

describe('parseAtlasQuery: clauses', () => {
  it('takes clauses in any order after FROM, each once', () => {
    const query = parseAtlasQuery(
      'from task limit 20 include archived show due, project.owner group by status sort by due desc, title where due < @today',
    );
    expect(query.limit).toBe(20);
    expect(query.includeArchived).toBe(true);
    expect(query.show.map(fieldText)).toEqual(['due', 'project.owner']);
    expect(query.group.map(fieldText)).toEqual(['status']);
    expect(query.sort.map((key) => key.direction)).toEqual(['desc', 'asc']);
    expect(shape(query.where)).toEqual([
      'due',
      '<',
      expect.objectContaining({ kind: 'relativeDate', name: 'today' }),
    ]);
  });

  it('reads keywords in any case, and ASC as the default it is', () => {
    const query = parseAtlasQuery('FrOm task SoRt By due AsC');
    expect(query.sort.map((key) => key.direction)).toEqual(['asc']);
  });

  it('lets a field be called by a keyword’s name where a field belongs', () => {
    expect(where('group = x AND limit IS EMPTY')).toEqual([
      'and',
      ['group', '=', expect.objectContaining({ text: 'x' })],
      ['limit', 'IS EMPTY'],
    ]);
  });
});

describe('parseAtlasQuery: conditions', () => {
  it('binds AND tighter than OR, and NOT tighter than both', () => {
    expect(where('a = 1 OR b = 2 AND NOT c = 3')).toEqual([
      'or',
      ['a', '=', expect.anything()],
      ['and', ['b', '=', expect.anything()], ['NOT', ['c', '=', expect.anything()]]],
    ]);
  });

  it('lets brackets say otherwise', () => {
    expect(where('(a = 1 OR b = 2) AND c = 3')).toEqual([
      'and',
      ['or', ['a', '=', expect.anything()], ['b', '=', expect.anything()]],
      ['c', '=', expect.anything()],
    ]);
  });

  it('reads every comparison, with <> as another way to write !=', () => {
    const ops = ['=', '!=', '<>', '<', '<=', '>', '>=', 'CONTAINS', 'STARTS WITH'].map((op) => {
      const found = parseAtlasQuery(`FROM task WHERE x ${op} 1`).where;
      return found?.kind === 'compare' ? found.op : null;
    });
    expect(ops).toEqual(['=', '!=', '!=', '<', '<=', '>', '>=', 'contains', 'startsWith']);
  });

  it('reads IS EMPTY and IS NOT EMPTY', () => {
    expect(where('due IS EMPTY OR owner is not empty')).toEqual([
      'or',
      ['due', 'IS EMPTY'],
      ['owner', 'IS NOT EMPTY'],
    ]);
  });
});

describe('parseAtlasQuery: values', () => {
  it('reads words, numbers and quoted text', () => {
    expect(valueOf('done')).toEqual({ kind: 'text', text: 'done' });
    expect(valueOf('in-progress')).toEqual({ kind: 'text', text: 'in-progress' });
    expect(valueOf('42')).toEqual({ kind: 'number', number: 42, text: '42' });
    expect(valueOf('-1.5')).toEqual({ kind: 'number', number: -1.5, text: '-1.5' });
    expect(valueOf("'it''s done'")).toEqual({ kind: 'text', text: "it's done" });
    expect(valueOf('"say ""hi"""')).toEqual({ kind: 'text', text: 'say "hi"' });
  });

  it('reads a date as text, not as a sum', () => {
    expect(valueOf('2026-09-30')).toEqual({ kind: 'text', text: '2026-09-30' });
  });

  it('reads links by their target, whatever alias or heading they carry', () => {
    expect(valueOf('[[Julie]]')).toEqual({ kind: 'link', target: 'Julie' });
    expect(valueOf('[[people/Julie|Jules]]')).toEqual({ kind: 'link', target: 'people/Julie' });
  });

  it('reads tags, nested ones too, and moving dates', () => {
    expect(valueOf('#q3')).toEqual({ kind: 'tag', name: 'q3' });
    expect(valueOf('#para/area')).toEqual({ kind: 'tag', name: 'para/area' });
    expect(valueOf('@weekAhead')).toEqual({ kind: 'relativeDate', name: 'weekAhead' });
  });

  it('reads a count from today, signed either way, and the start of the week', () => {
    expect(valueOf('@-30d')).toEqual({ kind: 'relativeDate', name: '-30d' });
    expect(valueOf('@+2w')).toEqual({ kind: 'relativeDate', name: '+2w' });
    expect(valueOf('@startOfWeek')).toEqual({ kind: 'relativeDate', name: 'startOfWeek' });
  });

  it('reads true and false as a checkbox’s values', () => {
    expect(valueOf('TRUE')).toEqual({ kind: 'boolean', value: true });
    expect(valueOf('false')).toEqual({ kind: 'boolean', value: false });
  });
});

describe('parseAtlasQuery: problems point at what caused them', () => {
  it.each([
    ['', 'Write a query: FROM task.', ''],
    ['   ', 'Write a query: FROM task.', ''],
    ['task WHERE x = 1', 'A query starts with FROM and the types to list: FROM task.', 'task'],
    ['FROM', 'Name a type after FROM.', ''],
    ['FROM task,', 'Name a type after FROM.', ''],
    [
      'FROM task ORDER BY due',
      `Expected WHERE, SORT BY, GROUP BY, SHOW, INCLUDE ARCHIVED or LIMIT here.`,
      'ORDER',
    ],
    ['FROM task LIMIT 5 LIMIT 6', 'LIMIT is already given.', 'LIMIT'],
    ['FROM task SORT BY a SORT BY b', 'SORT BY is already given.', 'SORT'],
    [
      'FROM task INCLUDE ARCHIVED INCLUDE ARCHIVED',
      'INCLUDE ARCHIVED is already given.',
      'INCLUDE',
    ],
    ['FROM task SORT due', 'SORT is followed by BY: SORT BY due.', 'due'],
    ['FROM task GROUP status', 'GROUP is followed by BY: GROUP BY status.', 'status'],
    [
      'FROM task GROUP BY a THEN b THEN c',
      'A query groups twice at most: GROUP BY a THEN b.',
      'THEN',
    ],
    ['FROM task GROUP BY', 'Name a field to group by.', ''],
    ['FROM task INCLUDE', 'INCLUDE is followed by ARCHIVED.', ''],
    ['FROM task LIMIT ten', 'LIMIT takes a whole number of rows: LIMIT 50.', 'ten'],
    ['FROM task LIMIT 0', 'LIMIT takes a whole number of rows: LIMIT 50.', '0'],
    ['FROM task LIMIT 2.5', 'LIMIT takes a whole number of rows: LIMIT 50.', '2.5'],
    ['FROM task LIMIT 5001', 'LIMIT is at most 5000 rows.', '5001'],
    ['FROM task WHERE', 'Expected a field to compare, like status.', ''],
    [
      'FROM task WHERE status',
      'Expected =, !=, <, <=, >, >=, CONTAINS, STARTS WITH or IS EMPTY here.',
      '',
    ],
    ['FROM task WHERE status ~ done', 'Atlas queries have no “~”.', '~'],
    ['FROM task WHERE status =', 'Expected a value after =.', ''],
    ['FROM task WHERE status = (', 'Expected a value after =.', '('],
    ['FROM task WHERE status IS done', 'IS is followed by EMPTY or NOT EMPTY.', 'done'],
    ['FROM task WHERE name STARTS Al', 'STARTS is followed by WITH.', 'Al'],
    ['FROM task WHERE (a = 1', 'This ( is never closed.', '('],
    ["FROM task WHERE a = 'open", "This text is never closed with '.", "'open"],
    ['FROM task WHERE a = [[Julie', 'This link is never closed with ]].', '[[Julie'],
    ['FROM task WHERE a = [[ ]]', 'A link needs the name of a note: [[Julie]].', '[[ ]]'],
    ['FROM task WHERE tag = #', 'A tag needs a name after #.', '#'],
    ['FROM task WHERE due < @', 'A date needs a name: @today.', '@'],
    ['FROM task WHERE due < @+', 'A date needs a name: @today.', '@+'],
    ['FROM task WHERE due < @++2w', 'A date needs a name: @today.', '@+'],
    ['FROM task WHERE a.b.c = 1', 'A field reaches one relation deep: project.owner.', '.'],
    ['FROM task WHERE project. = 1', 'Name a field of project after the dot.', '='],
    [
      'FROM task WHERE a = 1 b = 2',
      `Expected WHERE, SORT BY, GROUP BY, SHOW, INCLUDE ARCHIVED or LIMIT here.`,
      'b',
    ],
  ])('%j', (text, message, at) => {
    expect(problem(text)).toEqual({ message, at });
  });
});

describe('printAtlasQuery', () => {
  const printed = (text: string) => printAtlasQuery(parseAtlasQuery(text));

  it('writes a query in the canonical form, clauses in the grammar’s order', () => {
    expect(
      printed(
        'from task, project limit 20 include archived show due group by project then status sort by due desc, title where status <> done and tag = #q3',
      ),
    ).toBe(
      'FROM task, project WHERE status != done AND tag = #q3 SORT BY due DESC, title GROUP BY project THEN status SHOW due INCLUDE ARCHIVED LIMIT 20',
    );
  });

  it('brackets only what needs them, so the meaning survives', () => {
    expect(printed('FROM t WHERE (a = 1 OR b = 2) AND NOT (c = 3 AND d = 4)')).toBe(
      'FROM t WHERE (a = 1 OR b = 2) AND NOT (c = 3 AND d = 4)',
    );
    expect(printed('FROM t WHERE a = 1 OR (b = 2 AND c = 3)')).toBe(
      'FROM t WHERE a = 1 OR b = 2 AND c = 3',
    );
  });

  it('quotes a value only when a bare one would be read as something else', () => {
    expect(
      printed(
        `FROM t WHERE a = 'two words' AND b = 'and' AND c = '12' AND d = 'it''s' AND e = in-progress AND f = 2026-09-30 AND g = 'True'`,
      ),
    ).toBe(
      `FROM t WHERE a = 'two words' AND b = 'and' AND c = '12' AND d = 'it''s' AND e = in-progress AND f = 2026-09-30 AND g = 'True'`,
    );
  });

  it('writes every kind of value back as it reads', () => {
    expect(
      printed(
        'FROM t WHERE a = [[people/Julie|J]] AND b = #para/area AND c >= @weekAgo AND d = false AND e = -2.5 AND f IS NOT EMPTY AND g CONTAINS x AND h STARTS WITH y',
      ),
    ).toBe(
      'FROM t WHERE a = [[people/Julie]] AND b = #para/area AND c >= @weekAgo AND d = false AND e = -2.5 AND f IS NOT EMPTY AND g CONTAINS x AND h STARTS WITH y',
    );
  });

  it('round-trips: what it writes reads back as the same query', () => {
    const texts = [
      'FROM task, project WHERE status != done AND project.owner = [[Julie]] AND tag = #q3 SORT BY due GROUP BY project THEN status',
      "FROM task WHERE NOT (a = 'x y' OR b < 3) SORT BY due DESC SHOW due, project.owner INCLUDE ARCHIVED LIMIT 5",
    ];
    for (const text of texts) {
      const once = printed(text);
      expect(printed(once)).toBe(once);
    }
  });

  it('writes a tag with a space in its name as text, which tag reads the same', () => {
    const query: AtlasQuery = {
      ...parseAtlasQuery('FROM t WHERE tag = #x'),
    };
    const where = query.where;
    if (where?.kind !== 'compare') throw new Error('not a comparison');
    const spaced = {
      ...query,
      where: { ...where, value: { ...where.value, kind: 'tag' as const, name: 'tag me' } },
    };
    expect(printAtlasQuery(spaced)).toBe("FROM t WHERE tag = 'tag me'");
  });
});

describe('parseAtlasQuery: this, and LINKS TO', () => {
  it('reads this, in any case, as the note the query is shown on', () => {
    expect(valueOf('this')).toEqual({ kind: 'this' });
    expect(valueOf('THIS')).toEqual({ kind: 'this' });
    expect(valueOf("'this'")).toEqual({ kind: 'text', text: 'this' });
  });

  it('reads LINKS TO as a condition of its own, negated or joined like any other', () => {
    expect(where('LINKS TO this')).toEqual(['LINKS TO', expect.objectContaining({ kind: 'this' })]);
    expect(where('not links to this and status = done')).toEqual([
      'and',
      ['NOT', ['LINKS TO', expect.objectContaining({ kind: 'this' })]],
      ['status', '=', expect.objectContaining({ kind: 'text', text: 'done' })],
    ]);
  });

  it('still reads a property called links', () => {
    expect(where('links = 3')).toEqual([
      'links',
      '=',
      expect.objectContaining({ kind: 'number', number: 3 }),
    ]);
    expect(where('links IS EMPTY')).toEqual(['links', 'IS EMPTY']);
  });

  it('remembers where LINKS TO is in the text', () => {
    const text = 'FROM task WHERE status = done AND LINKS TO this';
    const query = parseAtlasQuery(text);
    const linksTo = query.where?.kind === 'and' ? query.where.operands[1] : null;
    expect(text.slice(linksTo?.span.start, linksTo?.span.end)).toBe('LINKS TO this');
  });

  it('prints this and LINKS TO back as they read, and quotes text that says this', () => {
    const text = 'FROM task WHERE owner = this AND NOT LINKS TO this';
    expect(printAtlasQuery(parseAtlasQuery(text))).toBe(text);
    const quoted = "FROM task WHERE notes = 'this'";
    expect(printAtlasQuery(parseAtlasQuery(quoted))).toBe(quoted);
  });

  it('wants a value after LINKS TO', () => {
    expect(problem('FROM task WHERE LINKS TO')).toEqual({
      message: 'Expected a value after LINKS TO.',
      at: '',
    });
  });
});
