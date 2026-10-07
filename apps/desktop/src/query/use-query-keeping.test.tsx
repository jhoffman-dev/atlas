// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createVaultPath, type VaultPath } from '@atlas/domain';
import { fakeIndexPort, fakeVaultFs } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';
import type { OpenEditors } from '../panes/open-editors.ts';
import { useQueryKeeping } from './use-query-keeping.ts';

const DASHBOARD = createVaultPath('.atlas/dashboards/Home.md');
const HOME = ['---', 'atlas: dashboard', 'widgets: []', '---', '', '# Home', ''].join('\n');
const TEXT = 'FROM task  WHERE status != done GROUP BY status';
const NO_PANE: OpenEditors = {
  register: () => {},
  setPropertiesIfOpen: async () => false,
  savePane: () => {},
  reloadOthers: () => {},
};
const VIEWS = ['.atlas/views/Open.md'];
const DASHBOARDS = [{ path: DASHBOARD, title: 'Home', icon: 'chart' as const }];

function keeping() {
  const files: Record<string, string> = { [DASHBOARD]: HOME };
  const created: { path: VaultPath; contents: string }[] = [];
  const fs = fakeVaultFs({
    readTextFile: async (path) => ({ text: files[path] ?? '', modified: 1 }),
    writeTextFile: async ({ path, contents }) => {
      files[path] = contents;
      return 2;
    },
    createNote: async (args) => void created.push(args),
  });
  const onSavedView = vi.fn();
  const onChanged = vi.fn();
  const view = renderHook(() =>
    useQueryKeeping({
      ports: { index: fakeIndexPort(), fs, markdown: remarkMarkdown, editors: NO_PANE },
      text: TEXT,
      viewPaths: VIEWS,
      dashboards: DASHBOARDS,
      onSavedView,
      onChanged,
    }),
  );
  return { view, files, created, onSavedView, onChanged };
}

describe('useQueryKeeping', () => {
  it('saves the query as a view note, as written, and opens it', async () => {
    const { view, created, onSavedView } = keeping();
    act(() => view.result.current.save.onSave({ name: 'Work', layout: 'board' }));
    await waitFor(() => expect(onSavedView).toHaveBeenCalledWith('.atlas/views/Work.md'));
    expect(created[0]?.contents).toContain('atlas: view');
    expect(created[0]?.contents).toContain('layout: board');
    expect(created[0]?.contents).toContain(`query: ${TEXT}`);
    expect(view.result.current.save.layouts.map((choice) => choice.value)).toEqual([
      'table',
      'board',
      'list',
    ]);
  });

  it('says why a view could not be saved', async () => {
    const { view } = keeping();
    act(() => view.result.current.save.onSave({ name: 'open', layout: 'table' }));
    await waitFor(() => expect(view.result.current.save.error).toMatch(/already a view/));
  });

  it('adds the query to a dashboard as a query widget', async () => {
    const { view, files, onChanged } = keeping();
    expect(view.result.current.dashboards.choices).toEqual([{ value: DASHBOARD, label: 'Home' }]);
    act(() => view.result.current.dashboards.onAdd({ path: DASHBOARD, title: 'Open' }));
    await waitFor(() =>
      expect(view.result.current.dashboards.notice).toBe('Added to the dashboard.'),
    );
    expect(files[DASHBOARD]).toContain('kind: query');
    expect(files[DASHBOARD]).toContain(`query: ${TEXT}`);
    expect(onChanged).toHaveBeenCalled();
  });
});
