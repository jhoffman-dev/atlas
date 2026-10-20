// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropertyDef } from '@atlas/domain';
import { pickSuggestion, suggestedTitles } from './link-suggest/link-suggest.test-support.ts';
import { PropertiesPanel, type PropertyRow, type RelationChoice } from './properties-panel.tsx';

const PROJECT: PropertyDef = {
  key: 'project',
  kind: 'relation',
  label: 'Project',
  required: false,
  options: [],
  target: 'project',
  targets: ['project', 'area'],
  many: false,
};

const SINGLE: PropertyDef = {
  key: 'project',
  kind: 'relation',
  label: 'Project',
  required: false,
  options: [],
  target: 'project',
  many: false,
};

const CHOICES: readonly RelationChoice[] = [
  { path: 'Projects/Atlas.md', title: 'Atlas', type: 'project' },
  { path: 'Areas/Garden.md', title: 'Garden', type: 'area' },
  { path: 'Areas/Health.md', title: 'Health', type: 'area' },
];

const row: PropertyRow = { def: PROJECT, value: null, error: null };

function picker(onCreateRelated?: (args: { target: string; name: string }) => Promise<string>) {
  const onChange = vi.fn();
  render(
    <PropertiesPanel
      typeName="task"
      rows={[row]}
      relationChoices={{ project: CHOICES }}
      onChange={onChange}
      {...(onCreateRelated !== undefined && { onCreateRelated })}
    />,
  );
  return { onChange, select: screen.getByLabelText('Project') };
}

describe('a relation that points at a project or an area', () => {
  it('offers the notes of both types, each named by its type', async () => {
    const { select } = picker();
    await userEvent.click(select);
    expect(suggestedTitles()).toEqual(['Atlas', 'Garden', 'Health']);
    const types = screen
      .getAllByRole('option')
      .map((option) => option.querySelector('.link-suggest__type')?.textContent);
    expect(types).toEqual(['Projects', 'Areas', 'Areas']);
  });
  it('names both types in its prompt', () => {
    const { select } = picker();
    expect(select.getAttribute('placeholder')).toBe('— no project or area —');
  });
  it('links an area as readily as a project', async () => {
    const { onChange, select } = picker();
    await pickSuggestion(select, 'Garden');
    expect(onChange).toHaveBeenLastCalledWith('project', '[[Areas/Garden]]');
  });

  it('offers a new note of each type, and makes the one picked', async () => {
    const onCreateRelated = vi.fn(async () => '[[Kitchen]]');
    const { onChange, select } = picker(onCreateRelated);
    await userEvent.type(select, 'Kitchen');
    const offered = screen.getAllByRole('option').map((option) => option.textContent);
    expect(offered).toEqual(['Create project ‘Kitchen’', 'Create area ‘Kitchen’']);

    await userEvent.click(screen.getByRole('option', { name: 'Create area ‘Kitchen’' }));
    expect(onCreateRelated).toHaveBeenCalledWith({ target: 'area', name: 'Kitchen' });
    expect(onChange).toHaveBeenLastCalledWith('project', '[[Kitchen]]');
  });
  it('offers the one note of a single type', async () => {
    render(
      <PropertiesPanel
        typeName="task"
        rows={[{ def: SINGLE, value: null, error: null }]}
        relationChoices={{ project: [CHOICES[0]!] }}
        onChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByLabelText('Project'));
    expect(suggestedTitles()).toEqual(['Atlas']);
  });
});
