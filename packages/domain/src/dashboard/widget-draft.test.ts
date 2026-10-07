import { describe, expect, it } from 'vitest';
import { optionsOfKind, parseDashboard, WIDGET_KINDS } from './dashboard.ts';
import {
  draftFromEntry,
  entryFromDraft,
  fromViewQuery,
  queryWidgetDraft,
  newWidgetDraft,
  widgetProblems,
  withKind,
  withType,
  type WidgetDraft,
} from './widget-draft.ts';

const doing = { key: 'status', operator: 'is' as const, value: 'doing' };

describe('newWidgetDraft', () => {
  it('starts each kind at the width the parser gives it', () => {
    expect(newWidgetDraft({ kind: 'number', type: 'task' }).span).toBe(3);
    expect(newWidgetDraft({ kind: 'hero', type: 'task' }).span).toBe(4);
    expect(newWidgetDraft({ kind: 'rank', type: 'task' }).span).toBe(4);
    expect(newWidgetDraft({ kind: 'bar', type: 'task' }).span).toBe(6);
  });

  it('writes nothing it does not need to', () => {
    expect(entryFromDraft(newWidgetDraft({ kind: 'number', type: 'task' }))).toEqual({
      kind: 'number',
      type: 'task',
    });
  });
});

describe('withKind', () => {
  it('moves a default-width widget to the new kind’s default', () => {
    const number = newWidgetDraft({ kind: 'number', type: 'task' });
    expect(withKind(number, 'bar').span).toBe(6);
  });

  it('keeps a width chosen on purpose', () => {
    const number = { ...newWidgetDraft({ kind: 'number', type: 'task' }), span: 5 };
    expect(withKind(number, 'bar').span).toBe(5);
  });
});

describe('withType', () => {
  const bar = {
    ...newWidgetDraft({ kind: 'bar', type: 'task' }),
    title: 'Mine',
    groupBy: 'status',
    filters: [doing],
    progress: [doing],
  };

  it('drops what named the old type’s properties', () => {
    expect(withType(bar, 'person')).toEqual({
      ...bar,
      type: 'person',
      groupBy: '',
      filters: [],
      progress: [],
    });
  });

  it('changes nothing when the type is the same', () => {
    expect(withType(bar, 'task')).toBe(bar);
  });
});

describe('fromViewQuery', () => {
  it('takes the view’s type and filters, keeping the rest of the draft', () => {
    const draft = { ...newWidgetDraft({ kind: 'list', type: 'task' }), title: 'Mine', span: 8 };
    const query = { type: 'person', columns: [], filters: [doing], sorts: [], limit: 500 };
    expect(fromViewQuery(draft, query)).toEqual({ ...draft, type: 'person', filters: [doing] });
  });
});

describe('draftFromEntry', () => {
  it('reads every setting the editor offers', () => {
    const draft = draftFromEntry({
      title: 'Tasks',
      kind: 'hero',
      type: 'task',
      groupBy: 'phase',
      filters: [doing],
      highlight: 15,
      progress: { label: 'done', filters: [{ key: 'status', operator: 'is', value: 'done' }] },
      width: 1,
    });
    expect(draft).toEqual({
      title: 'Tasks',
      kind: 'hero',
      type: 'task',
      groupBy: 'phase',
      filters: [doing],
      highlight: '15',
      icon: null,
      progress: [{ key: 'status', operator: 'is', value: 'done' }],
      limit: null,
      span: 4,
      sql: '',
      show: 'table',
      atlasQuery: '',
    });
  });

  it('reads an icon and a limit', () => {
    expect(draftFromEntry({ kind: 'number', type: 't', icon: 'bolt' }).icon).toBe('bolt');
    expect(draftFromEntry({ kind: 'number', type: 't', icon: 'rocket' }).icon).toBeNull();
    expect(draftFromEntry({ kind: 'rank', type: 't', limit: '7' }).limit).toBe(7);
  });

  it('reads something that is not a widget as a blank number', () => {
    expect(draftFromEntry('junk')).toMatchObject({ kind: 'number', type: '', title: '' });
  });
});

describe('entryFromDraft', () => {
  const written = {
    title: 'Doing',
    kind: 'number',
    type: 'task',
    filters: [{ ...doing, note: 'hand-written' }],
    aggregate: 'sum',
    of: 'estimate',
    owner: 'unknown to the editor',
  };

  it('keeps keys the editor does not know, in their places', () => {
    const edited = entryFromDraft({ ...draftFromEntry(written), title: 'In flight' }, written);
    expect(edited).toEqual({ ...written, title: 'In flight' });
    expect(Object.keys(edited)).toEqual(Object.keys(written));
  });

  it('keeps a value as written when it reads the same', () => {
    const entry = { kind: 'bar', type: 'task', groupBy: 'phase', highlight: 15 };
    expect(entryFromDraft(draftFromEntry(entry), entry)).toEqual(entry);
  });

  it('writes changed filters', () => {
    const draft = { ...draftFromEntry(written), filters: [] };
    expect(entryFromDraft(draft, written)).not.toHaveProperty('filters');
    const more = {
      ...draftFromEntry(written),
      filters: [doing, { key: 'phase', operator: 'isEmpty' as const }],
    };
    expect(entryFromDraft(more, written)['filters']).toEqual([
      doing,
      { key: 'phase', operator: 'isEmpty' },
    ]);
  });

  it('takes out what the new kind does not read', () => {
    const bar = { kind: 'bar', type: 'task', groupBy: 'status', highlight: 'max' };
    const number = entryFromDraft(withKind(draftFromEntry(bar), 'number'), bar);
    expect(number).toEqual({ kind: 'number', type: 'task' });
  });

  it('keeps a hero’s progress label', () => {
    const hero = {
      kind: 'hero',
      type: 'task',
      progress: { label: 'shipped', filters: [{ key: 'status', operator: 'is', value: 'done' }] },
    };
    const draft = { ...draftFromEntry(hero), progress: [doing] };
    expect(entryFromDraft(draft, hero)['progress']).toEqual({ label: 'shipped', filters: [doing] });
  });

  it('writes a ranking’s limit, and clears it back to the default', () => {
    const rank = { kind: 'rank', type: 'task', groupBy: 'status', limit: 3 };
    expect(entryFromDraft({ ...draftFromEntry(rank), limit: 8 }, rank)['limit']).toBe(8);
    expect(entryFromDraft({ ...draftFromEntry(rank), limit: null }, rank)).not.toHaveProperty(
      'limit',
    );
  });

  it('leaves a number’s query limit alone, since the editor does not offer it', () => {
    const number = { kind: 'number', type: 'task', limit: 50 };
    expect(entryFromDraft(draftFromEntry(number), number)['limit']).toBe(50);
  });

  it('writes a resized span and drops the older width', () => {
    const old = { kind: 'bar', type: 'task', groupBy: 'status', width: 2 };
    expect(entryFromDraft({ ...draftFromEntry(old), span: 6 }, old)).toEqual({
      kind: 'bar',
      type: 'task',
      groupBy: 'status',
      span: 6,
    });
  });

  it('keeps a width that still says the same size', () => {
    const old = { kind: 'bar', type: 'task', groupBy: 'status', width: 2 };
    expect(entryFromDraft(draftFromEntry(old), old)).toEqual(old);
  });

  it('writes a span that is not the default', () => {
    expect(
      entryFromDraft({ ...newWidgetDraft({ kind: 'number', type: 'task' }), span: 5 }),
    ).toEqual({
      kind: 'number',
      type: 'task',
      span: 5,
    });
  });

  it('round-trips through the parser for every kind', () => {
    for (const kind of WIDGET_KINDS) {
      const draft: WidgetDraft = {
        ...newWidgetDraft({ kind, type: 'task' }),
        title: 'Made',
        groupBy: optionsOfKind(kind).groupBy === 'none' ? '' : 'status',
        sql: kind === 'sql' ? 'SELECT 1' : '',
        atlasQuery: kind === 'query' ? 'FROM task' : '',
      };
      const [widget] = parseDashboard({ atlas: 'dashboard', widgets: [entryFromDraft(draft)] });
      expect(widget?.kind, kind).toBe(kind);
      expect(widget?.title).toBe('Made');
    }
  });
});

describe('query widgets (ADR-0019)', () => {
  it('is made from a query and a title, and written without a type or filters', () => {
    const draft = queryWidgetDraft({ query: 'FROM task  GROUP BY status', title: 'Open' });
    expect(
      entryFromDraft(draft, { type: 'task', filters: [{ key: 'a', operator: 'is' }] }),
    ).toEqual({
      title: 'Open',
      kind: 'query',
      query: 'FROM task  GROUP BY status',
    });
  });

  it('reads its query back exactly as written', () => {
    expect(draftFromEntry({ kind: 'query', query: 'FROM task  ' }).atlasQuery).toBe('FROM task  ');
    expect(draftFromEntry({ kind: 'query', query: 3 }).atlasQuery).toBe('');
  });

  it('asks for a query, and nothing else', () => {
    const blank = queryWidgetDraft({ query: ' ', title: '' });
    expect(widgetProblems(blank)).toEqual(['Write the query this widget runs.']);
    expect(widgetProblems({ ...blank, atlasQuery: 'FROM task' })).toEqual([]);
  });

  it('is parsed with its query and titled Query when it has no title', () => {
    const [widget] = parseDashboard({
      atlas: 'dashboard',
      widgets: [{ kind: 'query', query: 'FROM task' }],
    });
    expect(widget).toMatchObject({
      kind: 'query',
      atlasQuery: 'FROM task',
      title: 'Query',
      span: 6,
    });
    expect(
      parseDashboard({ atlas: 'dashboard', widgets: [{ kind: 'query', query: '  ' }] }),
    ).toEqual([]);
  });
});

describe('widgetProblems', () => {
  const bar = { ...newWidgetDraft({ kind: 'bar', type: 'task' }), groupBy: 'status' };

  it('passes a widget that draws', () => {
    expect(widgetProblems(bar)).toEqual([]);
  });

  it('asks for a type', () => {
    expect(widgetProblems({ ...bar, type: ' ' })).toEqual([
      'Choose the type of note this widget counts.',
    ]);
  });

  it('names a type that does not exist', () => {
    expect(widgetProblems(bar, { knownTypes: ['person'] })).toEqual([
      'There is no type called “task”.',
    ]);
  });

  it('asks a chart for a grouping, by the chart’s name', () => {
    expect(widgetProblems({ ...bar, groupBy: '' })).toEqual([
      'A bar chart needs a property to group by.',
    ]);
    expect(widgetProblems({ ...bar, kind: 'rank', groupBy: '' })).toEqual([
      'A ranking needs a property to group by.',
    ]);
  });

  it('does not ask a hero for one', () => {
    expect(widgetProblems({ ...bar, kind: 'hero', groupBy: '' })).toEqual([]);
  });

  it('keeps the span on the grid', () => {
    expect(widgetProblems({ ...bar, span: 13 })).toEqual(['A widget spans 1 to 12 columns.']);
    expect(widgetProblems({ ...bar, span: 0 })).toEqual(['A widget spans 1 to 12 columns.']);
  });

  it('keeps a ranking’s limit to what it can show', () => {
    expect(widgetProblems({ ...bar, kind: 'rank', limit: 21 })).toEqual([
      'A ranking shows 1 to 20 groups.',
    ]);
    expect(widgetProblems({ ...bar, kind: 'list', limit: 0 })).toEqual(['Show at least one row.']);
    expect(widgetProblems({ ...bar, kind: 'list', limit: 40 })).toEqual([]);
  });

  it('lists every problem at once', () => {
    expect(widgetProblems({ ...bar, type: '', groupBy: '' })).toHaveLength(2);
  });
});
