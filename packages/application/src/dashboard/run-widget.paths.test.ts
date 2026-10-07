import { parseDashboard, parseObjectType, WIDGET_KINDS, type Widget } from '@atlas/domain';
import { describe, expect, it } from 'vitest';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { runWidget } from './run-widget.ts';

/** A widget of each kind, as a dashboard note writes it. */
const SOURCES: Readonly<Record<string, Record<string, unknown>>> = {
  number: { kind: 'number', type: 'task' },
  hero: { kind: 'hero', type: 'task', groupBy: 'status' },
  list: { kind: 'list', type: 'task' },
  table: { kind: 'table', type: 'task' },
  bar: { kind: 'bar', type: 'task', groupBy: 'status' },
  donut: { kind: 'donut', type: 'task', groupBy: 'status' },
  line: { kind: 'line', type: 'task', groupBy: 'status' },
  rank: { kind: 'rank', type: 'task', groupBy: 'status' },
  sql: { kind: 'sql', sql: 'SELECT path FROM files' },
  query: { kind: 'query', query: 'FROM task' },
};

const widgetFor = (source: Record<string, unknown>): Widget => {
  const [widget] = parseDashboard({ atlas: 'dashboard', widgets: [source] });
  if (widget === undefined) throw new Error('the test asked for a widget that does not parse');
  return widget;
};

/** A query widget is checked against the types before it reaches the index. */
const TYPES = [
  parseObjectType({
    name: 'task',
    label: 'Task',
    properties: { status: { kind: 'select', options: ['todo', 'done'] } },
  }),
];

const FAILURE =
  'unable to open /Users/j/Library/Mobile Documents/com~apple~CloudDocs/My Vault/.atlas-cache/index.sqlite';

describe('runWidget: a failed widget names no path on this machine', () => {
  it('covers every kind of widget', () => {
    expect(Object.keys(SOURCES).sort()).toEqual([...WIDGET_KINDS].sort());
  });

  for (const [kind, source] of Object.entries(SOURCES)) {
    it(`strips the whole path from a failed ${kind} widget`, async () => {
      const index = fakeIndexPort({
        query: async () => {
          throw new Error(FAILURE);
        },
      });
      const result = await runWidget({ index, types: TYPES, widget: widgetFor(source) });
      expect(result.data).toEqual({ shape: 'error', message: 'unable to open <path>' });
    });
  }
});
