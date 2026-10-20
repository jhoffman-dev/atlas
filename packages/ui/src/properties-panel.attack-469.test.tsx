// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createVaultPath, noteNames, type PropertyDef } from '@atlas/domain';
import { NoteNamesProvider } from './note-names.tsx';
import { PropertiesPanel, type PropertyRow } from './properties-panel.tsx';

/**
 * Attack on PR #469 (#465): "Create <type> '…'" is offered when no note
 * *offered* is called what was typed — but the picker is offered only the
 * notes not linked yet, so the note already linked is never "offered", and
 * typing its exact name offers to make it again (a second "Acme", numbered
 * "Acme 2" by `createRelatedNote`). Fictional names only.
 */

afterEach(cleanup);

const companies = (many: boolean): PropertyDef => ({
  key: 'field',
  kind: 'relation',
  label: 'Field',
  required: false,
  options: [],
  target: 'company',
  many,
});

function panelWith(value: unknown, many: boolean) {
  const onCreateRelated = vi.fn(async () => '[[Acme 2]]');
  const rows: PropertyRow[] = [{ def: companies(many), value, error: null }];
  render(
    <NoteNamesProvider
      value={noteNames([
        { path: createVaultPath('Companies/Acme.md'), title: 'Acme' },
        { path: createVaultPath('Companies/Birchwood.md'), title: 'Birchwood' },
      ])}
    >
      <PropertiesPanel
        typeName="person"
        rows={rows}
        relationChoices={{
          field: [
            { path: 'Companies/Acme.md', title: 'Acme', type: 'company' },
            { path: 'Companies/Birchwood.md', title: 'Birchwood', type: 'company' },
          ],
        }}
        onChange={vi.fn()}
        onCreateRelated={onCreateRelated}
      />
    </NoteNamesProvider>,
  );
  return onCreateRelated;
}

describe('Create in a relation picker (attack #469)', () => {
  it('does not offer to make a note called what an already linked note is called (many)', async () => {
    panelWith(['[[Acme]]'], true);
    await userEvent.type(screen.getByRole('combobox', { name: 'Field' }), 'Acme');
    expect(screen.queryByRole('option', { name: 'Create company ‘Acme’' })).toBeNull();
  });

  it('does not make a second note on Enter for the name of the one already linked (single)', async () => {
    const onCreateRelated = panelWith('[[Acme]]', false);
    await userEvent.type(screen.getByRole('combobox', { name: 'Field' }), 'Acme{Enter}');
    expect(onCreateRelated).not.toHaveBeenCalled();
  });
});
