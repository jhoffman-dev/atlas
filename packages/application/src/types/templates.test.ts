import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import {
  findDailyTemplate,
  findTaskTemplate,
  findTemplateNamed,
  type NoteTemplate,
} from './templates.ts';

const template = (name: string): NoteTemplate => ({
  name,
  path: createVaultPath(`.atlas/templates/${name}.md`),
});

const TEMPLATES = [template('Meeting'), template('task'), template('DAILY'), template('Daily log')];

describe('choosing a template', () => {
  it('captures from the template called Task, whatever its case', () => {
    expect(findTaskTemplate(TEMPLATES)?.name).toBe('task');
  });

  it("makes today's note from the one called Daily, not one that merely starts so", () => {
    expect(findDailyTemplate(TEMPLATES)?.name).toBe('DAILY');
    expect(findDailyTemplate([template('Daily log')])).toBeNull();
  });

  it('finds a template by the name the menu shows, ignoring case and spaces around it', () => {
    expect(findTemplateNamed(TEMPLATES, ' meeting ')?.name).toBe('Meeting');
    expect(findTemplateNamed(TEMPLATES, 'Missing')).toBeNull();
  });
});
