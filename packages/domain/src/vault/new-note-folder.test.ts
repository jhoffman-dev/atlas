import { describe, expect, it } from 'vitest';
import { createVaultPath, VAULT_ROOT } from './vault-path.ts';
import { newNoteFolder } from './new-note-folder.ts';

const board = createVaultPath('.atlas/views/Board.md');
const acme = createVaultPath('Clients/Acme.md');

describe('newNoteFolder', () => {
  it('puts a dashboard with the dashboards, whatever is in view', () => {
    const properties = { atlas: 'dashboard', widgets: [] };
    expect(newNoteFolder({ beside: board, properties })).toBe('.atlas/dashboards');
    expect(newNoteFolder({ beside: acme, properties })).toBe('.atlas/dashboards');
    expect(newNoteFolder({ beside: null, properties })).toBe('.atlas/dashboards');
  });

  it('puts a saved view with the views, whatever is in view', () => {
    const properties = { atlas: 'view', type: 'task' };
    expect(newNoteFolder({ beside: acme, properties })).toBe('.atlas/views');
    expect(newNoteFolder({ beside: null, properties })).toBe('.atlas/views');
  });

  it('puts any other note beside the one in view', () => {
    expect(newNoteFolder({ beside: acme, properties: { type: 'task' } })).toBe('Clients');
  });

  it('puts it at the root when nothing is in view', () => {
    expect(newNoteFolder({ beside: null, properties: {} })).toBe(VAULT_ROOT);
  });

  // Beside a view it would be an Atlas note, which nothing lists.
  it('never puts an ordinary note among the ones Atlas keeps for itself', () => {
    expect(newNoteFolder({ beside: board, properties: { type: 'task' } })).toBe(VAULT_ROOT);
    const template = createVaultPath('.atlas/templates/Task.md');
    expect(newNoteFolder({ beside: template, properties: {} })).toBe(VAULT_ROOT);
  });

  // The Archive is out of the way: a new note beside an archived one would be
  // archived the moment it was made (issue #15).
  it('never puts a new note in the Archive beside an archived one', () => {
    const archived = createVaultPath('Archive/Projects/Old launch.md');
    expect(newNoteFolder({ beside: archived, properties: { type: 'task' } })).toBe(VAULT_ROOT);
  });
});
