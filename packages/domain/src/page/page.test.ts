import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  duplicatesTitle,
  formatPropertyDate,
  humanizeKey,
  newPropertyKey,
  newPropertyValue,
  notePropertyKind,
  optionLabel,
  pageCrumb,
  pageIcon,
  placeCrumb,
  pageTitle,
  withDatePart,
  propertyIcon,
  statusTone,
} from './index.ts';

describe('pageIcon', () => {
  it('draws a note by its type, as the sidebar does', () => {
    expect(pageIcon({ kind: 'note', typeName: 'task' })).toBe('task');
    expect(pageIcon({ kind: 'note', typeName: 'person' })).toBe('person');
  });

  it('draws an untyped note, or one of an unknown type, as a document', () => {
    expect(pageIcon({ kind: 'note', typeName: null })).toBe('doc');
    expect(pageIcon({ kind: 'note', typeName: 'recipe' })).toBe('doc');
  });

  it('draws a view by its layout', () => {
    expect(pageIcon({ kind: 'view', layout: 'board' })).toBe('board');
    expect(pageIcon({ kind: 'view', layout: 'gallery' })).toBe('grid');
  });

  it('draws a dashboard as a chart, a source as a list and a type by its name', () => {
    expect(pageIcon({ kind: 'dashboard' })).toBe('chart');
    expect(pageIcon({ kind: 'source' })).toBe('list');
    expect(pageIcon({ kind: 'type', typeName: 'Companies' })).toBe('company');
    expect(pageIcon({ kind: 'template', typeName: 'task' })).toBe('template');
  });
});

describe('placeCrumb', () => {
  const place = (value: string) => placeCrumb(createVaultPath(value));

  it('puts a note under its nearest folder, drawn as a document', () => {
    expect(place('docs/design/look.md')).toEqual({ icon: 'doc', parent: 'design' });
  });

  it('puts a note at the top of the vault under Pages', () => {
    expect(place('Untitled.md')).toEqual({ icon: 'doc', parent: 'Pages' });
  });

  it('names the parts of .atlas the way the sidebar does, never .atlas', () => {
    expect(place('.atlas/views/Board.md')).toEqual({ icon: 'table', parent: 'Views' });
    expect(place('.atlas/dashboards/Progress.md')).toEqual({ icon: 'chart', parent: 'Dashboards' });
    expect(place('.atlas/types/task.md')).toEqual({ icon: 'system', parent: 'Types' });
    expect(place('.atlas/templates/Task.md')).toEqual({ icon: 'template', parent: 'Templates' });
    expect(place('.atlas/sources/Feed.md')).toEqual({ icon: 'list', parent: 'Sources' });
  });

  it('calls anything else in .atlas the system folder', () => {
    expect(place('.atlas/settings.md')).toEqual({ icon: 'system', parent: 'System' });
    expect(place('.atlas/other/Thing.md')).toEqual({ icon: 'system', parent: 'System' });
  });

  it('does not take a nested .atlas for the vault’s own', () => {
    expect(place('Projects/.atlas/views/Board.md')).toEqual({ icon: 'doc', parent: 'views' });
  });

  it('puts an archived note in the Archive, whatever folder it keeps there', () => {
    expect(place('Archive/Projects/X.md')).toEqual({ icon: 'archive', parent: 'Archive' });
    expect(place('Projects/Archive/X.md')).toEqual({ icon: 'doc', parent: 'Archive' });
  });
});

describe('pageCrumb for an archived note', () => {
  it('is the Archive rather than the folder it keeps there', () => {
    expect(
      pageCrumb({ kind: 'note', typeName: null }, createVaultPath('Archive/Projects/X.md')),
    ).toEqual({
      icon: 'archive',
      parent: 'Archive',
    });
  });
});

describe('pageCrumb', () => {
  const path = (value: string) => createVaultPath(value);

  it('puts a note under the folder it sits in', () => {
    expect(pageCrumb({ kind: 'note', typeName: 'task' }, path('tasks/A15-03.md'))).toEqual({
      icon: 'folder',
      parent: 'tasks',
    });
  });

  it('names only the nearest folder, not the whole path', () => {
    expect(pageCrumb({ kind: 'note', typeName: null }, path('docs/design/look.md')).parent).toBe(
      'design',
    );
  });

  it('puts a note at the top of the vault under Pages', () => {
    expect(pageCrumb({ kind: 'note', typeName: null }, path('Untitled.md')).parent).toBe('Pages');
    expect(pageCrumb({ kind: 'note', typeName: null }, null).parent).toBe('Pages');
  });

  it('puts views, dashboards and types under their sidebar section, never .atlas', () => {
    expect(pageCrumb({ kind: 'view', layout: 'table' }, path('.atlas/views/All tasks.md'))).toEqual(
      { icon: 'table', parent: 'Views' },
    );
    expect(pageCrumb({ kind: 'dashboard' }, path('.atlas/dashboards/Progress.md'))).toEqual({
      icon: 'chart',
      parent: 'Dashboards',
    });
    expect(pageCrumb({ kind: 'type', typeName: 'task' }, null)).toEqual({
      icon: 'task',
      parent: 'Types',
    });
    expect(pageCrumb({ kind: 'source' }, path('.atlas/sources/Feed.md')).parent).toBe('Sources');
    expect(
      pageCrumb({ kind: 'template', typeName: 'task' }, path('.atlas/templates/Task.md')),
    ).toEqual({ icon: 'template', parent: 'Templates' });
  });
});

describe('pageTitle', () => {
  it('heads a note with its own title when it gives one', () => {
    expect(pageTitle({ fileTitle: 'A15-03', properties: { title: ' Leftovers ' } })).toEqual({
      text: 'Leftovers',
      source: 'property',
    });
  });

  it('falls back to the filename when the title is missing, blank or not text', () => {
    for (const title of [undefined, '', '   ', 42, ['a']]) {
      expect(pageTitle({ fileTitle: 'A15-03', properties: { title } })).toEqual({
        text: 'A15-03',
        source: 'file',
      });
    }
  });
});

describe('duplicatesTitle', () => {
  it('hides the title row when it is what heads the page', () => {
    expect(duplicatesTitle({ key: 'title', value: 'Leftovers ', title: 'Leftovers' })).toBe(true);
  });

  it('keeps a title that differs, and any other key with the same text', () => {
    expect(duplicatesTitle({ key: 'title', value: 'Other', title: 'Leftovers' })).toBe(false);
    expect(duplicatesTitle({ key: 'name', value: 'Leftovers', title: 'Leftovers' })).toBe(false);
    expect(duplicatesTitle({ key: 'title', value: null, title: '' })).toBe(false);
  });
});

describe('humanizeKey', () => {
  it.each([
    ['blocked_by', 'Blocked by'],
    ['dueDate', 'Due date'],
    ['due-date', 'Due date'],
    ['status', 'Status'],
    ['id', 'ID'],
    ['source_url', 'Source URL'],
    ['  phase  ', 'Phase'],
    ['ALREADY', 'Already'],
  ])('%s reads as %s', (key, label) => {
    expect(humanizeKey(key)).toBe(label);
  });

  it('leaves a key with no words in it as it is', () => {
    expect(humanizeKey('__')).toBe('__');
  });
});

describe('withDatePart', () => {
  it('changes the day of a date-time and keeps its time', () => {
    expect(withDatePart('2026-09-22T14:30', '2026-09-23')).toBe('2026-09-23T14:30');
    expect(withDatePart('2026-09-22T14:30:00Z', '2026-10-01')).toBe('2026-10-01T14:30:00Z');
  });

  it('writes the day alone over a plain date, a blank, or text that is not a date', () => {
    expect(withDatePart('2026-09-22', '2026-09-23')).toBe('2026-09-23');
    expect(withDatePart('', '2026-09-23')).toBe('2026-09-23');
    expect(withDatePart('someday', '2026-09-23')).toBe('2026-09-23');
  });

  it('clears the whole value when the day is cleared', () => {
    expect(withDatePart('2026-09-22T14:30', '')).toBe('');
  });
});

describe('formatPropertyDate', () => {
  it('reads a date the way the mockup does', () => {
    expect(formatPropertyDate('2026-09-22')).toBe('Tue, Sep 22, 2026');
    expect(formatPropertyDate('2024-02-29')).toBe('Thu, Feb 29, 2024');
    expect(formatPropertyDate('2027-01-03')).toBe('Sun, Jan 3, 2027');
  });

  it('reads a date-time with its time as written, and its zone when it names one', () => {
    expect(formatPropertyDate('2026-09-22T14:30')).toBe('Tue, Sep 22, 2026, 14:30');
    expect(formatPropertyDate('2026-12-31T23:30:00Z')).toBe('Thu, Dec 31, 2026, 23:30 UTC');
    expect(formatPropertyDate('2026-12-31 08:05:00+02:00')).toBe('Thu, Dec 31, 2026, 08:05 +02:00');
  });

  it('reads the date alone when what follows it is not a time', () => {
    expect(formatPropertyDate('2026-12-31 or so')).toBe('Thu, Dec 31, 2026');
  });

  it('names the right weekday for a year before 100', () => {
    // Date.UTC reads year 99 as 1999, a Friday; 0099-01-01 was a Thursday.
    expect(formatPropertyDate('0099-01-01')).toBe('Thu, Jan 1, 99');
    expect(formatPropertyDate('0000-03-01')).toBe('Wed, Mar 1, 0');
  });

  it('refuses what is not a real calendar date', () => {
    expect(formatPropertyDate('2026-02-30')).toBeNull();
    expect(formatPropertyDate('2026-13-01')).toBeNull();
    expect(formatPropertyDate('next tuesday')).toBeNull();
    expect(formatPropertyDate('')).toBeNull();
  });
});

describe('propertyIcon', () => {
  it('gives each kind of value its glyph', () => {
    expect(propertyIcon('select')).toBe('status');
    expect(propertyIcon('number')).toBe('number');
    expect(propertyIcon('date')).toBe('date');
    expect(propertyIcon('relation')).toBe('relation');
    expect(propertyIcon('url')).toBe('link');
    expect(propertyIcon('checkbox')).toBe('check');
    expect(propertyIcon('text')).toBe('text');
  });
});

describe('statusTone', () => {
  it.each([
    ['backlog', 'backlog'],
    ['Next', 'next'],
    [' doing ', 'doing'],
    ['In progress', 'doing'],
    ['review', 'review'],
    ['done', 'done'],
  ])('%s takes the %s ramp', (value, tone) => {
    expect(statusTone(value)).toBe(tone);
  });

  it('draws an unknown value in the quietest ramp', () => {
    expect(statusTone('blocked')).toBe('backlog');
  });
});

describe('optionLabel', () => {
  it('capitalises the first letter only', () => {
    expect(optionLabel('backlog')).toBe('Backlog');
    expect(optionLabel(' in review')).toBe('In review');
    expect(optionLabel('')).toBe('');
  });
});

describe('newPropertyKey', () => {
  it('turns what was typed into a frontmatter key', () => {
    expect(newPropertyKey('  due date ', [])).toEqual({ key: 'due_date', problem: null });
    expect(newPropertyKey('owner', ['status']).key).toBe('owner');
  });

  it('refuses a blank name, one already there, or one YAML would need quoting for', () => {
    expect(newPropertyKey('   ', []).key).toBeNull();
    expect(newPropertyKey('Status', ['status']).key).toBeNull();
    expect(newPropertyKey('1st', []).key).toBeNull();
    expect(newPropertyKey('a:b', []).key).toBeNull();
  });

  it('says why when the name is already in the file', () => {
    expect(newPropertyKey('Status', ['status'])).toEqual({
      key: null,
      problem: 'This note already has “Status”',
    });
  });

  it('refuses type and atlas, which say what the note is, with a reason', () => {
    for (const typed of ['type', 'Type', 'atlas']) {
      const result = newPropertyKey(typed, []);
      expect(result.key).toBeNull();
      expect(result.problem).toMatch(/kept for Atlas/);
    }
  });

  it('says nothing while the name is blank or not yet a key', () => {
    expect(newPropertyKey('', []).problem).toBeNull();
    expect(newPropertyKey('1st', []).problem).toBeNull();
  });

  it('stores a name as the lower-case key a type would give it', () => {
    expect(newPropertyKey('Pages', []).key).toBe('pages');
    expect(newPropertyKey('Due Date', []).key).toBe('due_date');
  });

  it('refuses the columns every note already has, title among them', () => {
    for (const typed of ['title', 'path', 'summary', 'Modified']) {
      const result = newPropertyKey(typed, []);
      expect(result.key).toBeNull();
      expect(result.problem).toMatch(/kept for Atlas/);
    }
  });
});

describe('newPropertyValue', () => {
  it('starts a checkbox unticked and a list empty, so the kind reads back from the file', () => {
    expect(newPropertyValue('checkbox')).toBe(false);
    expect(newPropertyValue('multiSelect')).toEqual([]);
  });

  it('starts every other kind empty', () => {
    for (const kind of ['text', 'number', 'date', 'url', 'select', 'relation'] as const) {
      expect(newPropertyValue(kind)).toBe('');
    }
  });
});

describe('notePropertyKind', () => {
  it('reads the kind a value no type declares from the value itself', () => {
    expect(notePropertyKind(true)).toBe('checkbox');
    expect(notePropertyKind(412)).toBe('number');
    expect(notePropertyKind(['a', 'b'])).toBe('multiSelect');
    expect(notePropertyKind([])).toBe('multiSelect');
    expect(notePropertyKind('2026-09-24')).toBe('date');
    expect(notePropertyKind('https://example.com')).toBe('url');
  });

  it('reads a link, or a list of nothing but links, as a relation', () => {
    expect(notePropertyKind('[[Ada Lovelace]]')).toBe('relation');
    expect(notePropertyKind(['[[Ada]]', '[[Grace|Admiral]]'])).toBe('relation');
    expect(notePropertyKind(['[[Ada]]', 'plain'])).toBe('multiSelect');
    expect(notePropertyKind('see [[Ada]]')).toBe('text');
  });

  it('calls anything else text', () => {
    for (const value of ['', 'hello', '412', null, '2026-02-30', { a: 1 }]) {
      expect(notePropertyKind(value)).toBe('text');
    }
  });
});
