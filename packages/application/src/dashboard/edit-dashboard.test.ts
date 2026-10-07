import { newWidgetDraft, type WidgetDraft } from '@atlas/domain';
import { describe, expect, it } from 'vitest';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { applyDashboardEdit, dashboardChange, previewWidget } from './edit-dashboard.ts';

const TOTAL = { title: 'Total', kind: 'number', type: 'task', owner: 'hand-written' };
const BY_STATUS = { title: 'By status', kind: 'bar', type: 'task', groupBy: 'status', span: 8 };
const OPEN = { title: 'Open', kind: 'list', type: 'task' };
const dashboard = { atlas: 'dashboard', title: 'Progress', widgets: [TOTAL, BY_STATUS, OPEN] };

const bar: WidgetDraft = { ...newWidgetDraft({ kind: 'bar', type: 'task' }), groupBy: 'phase' };

/** What the edit writes, worked out against the note as the write finds it. */
const written = (
  edit: Parameters<typeof dashboardChange>[0],
  properties: Readonly<Record<string, unknown>> = dashboard,
) => {
  const change = dashboardChange(edit);
  if (typeof change !== 'function') throw new Error('a dashboard edit reads the note first');
  return change(properties);
};

describe('dashboardChange', () => {
  it('writes only the widgets', () => {
    expect(Object.keys(written({ kind: 'remove', entry: 0 }))).toEqual(['widgets']);
  });

  it('adds a widget at the end', () => {
    expect(written({ kind: 'add', draft: bar })['widgets']).toEqual([
      TOTAL,
      BY_STATUS,
      OPEN,
      { kind: 'bar', type: 'task', groupBy: 'phase' },
    ]);
  });

  it('adds the first widget to a dashboard with none', () => {
    expect(written({ kind: 'add', draft: bar }, { ...dashboard, widgets: [] })['widgets']).toEqual([
      { kind: 'bar', type: 'task', groupBy: 'phase' },
    ]);
  });

  it('updates one widget, keeping its unknown keys', () => {
    const draft = { ...newWidgetDraft({ kind: 'number', type: 'task' }), title: 'Everything' };
    expect(written({ kind: 'update', entry: 0, draft })['widgets']).toEqual([
      { ...TOTAL, title: 'Everything' },
      BY_STATUS,
      OPEN,
    ]);
  });

  it('removes one widget', () => {
    expect(written({ kind: 'remove', entry: 1 })['widgets']).toEqual([TOTAL, OPEN]);
  });

  it('moves a widget to first place', () => {
    expect(written({ kind: 'place', entry: 2, to: 0, span: null })['widgets']).toEqual([
      OPEN,
      TOTAL,
      BY_STATUS,
    ]);
  });

  it('resizes a widget where it stands', () => {
    expect(written({ kind: 'place', entry: 1, to: 1, span: 6 })['widgets']).toEqual([
      TOTAL,
      { ...BY_STATUS, span: 6 },
      OPEN,
    ]);
  });

  it('builds on the note as the write finds it, not as the gesture found it', () => {
    const since = { ...dashboard, widgets: [TOTAL, BY_STATUS, OPEN, { kind: 'list', type: 'x' }] };
    expect(written({ kind: 'remove', entry: 0 }, since)['widgets']).toHaveLength(3);
  });

  it('restores an earlier list', () => {
    expect(written({ kind: 'restore', widgets: [OPEN] })['widgets']).toEqual([OPEN]);
  });

  it('restores a dashboard that had no list by taking the key out', () => {
    expect(written({ kind: 'restore', widgets: undefined })).toEqual({ widgets: null });
  });
});

describe('applyDashboardEdit', () => {
  it('reads a restored value that is not a list as none', () => {
    expect(applyDashboardEdit([TOTAL], { kind: 'restore', widgets: 'junk' })).toEqual([]);
  });
});

describe('previewWidget', () => {
  it('runs the draft as the dashboard would', async () => {
    const index = fakeIndexPort({
      query: async () => ({ columns: ['value'], rows: [[4]], truncated: false }),
    });
    const result = await previewWidget({
      index,
      draft: { ...newWidgetDraft({ kind: 'number', type: 'task' }), title: 'Four' },
    });
    expect(result?.widget.title).toBe('Four');
    expect(result?.data).toEqual({ shape: 'number', value: '4' });
  });

  it('runs nothing for a draft that is not a widget yet', async () => {
    let ran = false;
    const index = fakeIndexPort({
      query: async () => {
        ran = true;
        return { columns: [], rows: [], truncated: false };
      },
    });
    expect(await previewWidget({ index, draft: { ...bar, groupBy: '' } })).toBeNull();
    expect(ran).toBe(false);
  });
});
