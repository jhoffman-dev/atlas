import { describe, expect, it } from 'vitest';
import {
  choiceNamed,
  filterChoices,
  matchingChoices,
  NO_CHOICE_SOURCES,
  relatedChoices,
  type FilterChoice,
} from './index.ts';
import { filterValueFrom } from './filter-words.ts';
import { GTD_STATUSES } from '../gtd/gtd-status.ts';
import { noteNames } from '../types/relation-names.ts';
import { createVaultPath } from '../vault/vault-path.ts';

/* #212: what a filter's value box offers, and how what is typed in it is read. */

const values = (choices: readonly FilterChoice[]) => choices.map((choice) => choice.value);
const labels = (choices: readonly FilterChoice[]) => choices.map((choice) => choice.label);

const SOURCES = {
  tags: ['errand', 'q3'],
  related: { project: [{ value: '[[Larkspur launch]]', label: 'Larkspur launch' }] },
};

describe('filterChoices', () => {
  it('offers a task’s GTD statuses as the table shows them, storing the option', () => {
    const choices = filterChoices(
      { key: 'status', kind: 'select', options: [...GTD_STATUSES] },
      NO_CHOICE_SOURCES,
    );
    expect(values(choices)).toEqual([...GTD_STATUSES]);
    expect(labels(choices)).toEqual([
      'Inbox',
      'Backlog',
      'Next Action',
      'In Progress',
      'Waiting',
      'Someday',
      'Longterm',
      'Archive',
    ]);
  });

  it('offers a multi-select’s options too', () => {
    const choices = filterChoices(
      { key: 'kind', kind: 'multiSelect', options: ['page', 'deck'] },
      SOURCES,
    );
    expect(choices).toEqual([
      { value: 'page', label: 'Page' },
      { value: 'deck', label: 'Deck' },
    ]);
  });

  it('offers the vault’s tags for `tags`, after its own options and without repeats', () => {
    expect(
      values(filterChoices({ key: 'tags', kind: 'multiSelect', options: ['q3'] }, SOURCES)),
    ).toEqual(['q3', 'errand']);
    expect(values(filterChoices({ key: 'tags', kind: 'text' }, SOURCES))).toEqual(['errand', 'q3']);
    expect(filterChoices({ key: 'labels', kind: 'multiSelect', options: [] }, SOURCES)).toEqual([]);
  });

  it('offers true and false for a checkbox', () => {
    expect(values(filterChoices({ key: 'urgent', kind: 'checkbox' }, SOURCES))).toEqual([
      'true',
      'false',
    ]);
  });

  it('offers the relative days for a date, by name', () => {
    const choices = filterChoices({ key: 'due', kind: 'date' }, SOURCES);
    expect(choices).toContainEqual({ value: '@today', label: 'Today' });
    expect(choices).toContainEqual({ value: '@tomorrow', label: 'Tomorrow' });
    expect(choices).toHaveLength(6);
  });

  it('offers a relation the notes it can point at, and nothing it has not been given', () => {
    expect(filterChoices({ key: 'project', kind: 'relation' }, SOURCES)).toEqual(
      SOURCES.related.project,
    );
    expect(filterChoices({ key: 'owner', kind: 'relation' }, SOURCES)).toEqual([]);
  });

  it('offers nothing for what is only ever typed', () => {
    expect(filterChoices({ key: 'phase', kind: 'number' }, SOURCES)).toEqual([]);
    expect(filterChoices({ key: 'title' }, SOURCES)).toEqual([]);
  });
});

describe('matchingChoices', () => {
  const statuses = filterChoices(
    { key: 'status', kind: 'select', options: [...GTD_STATUSES] },
    NO_CHOICE_SOURCES,
  );

  it('keeps the choices whose label or value holds what was typed, in their order', () => {
    expect(labels(matchingChoices(statuses, 'in'))).toEqual(['Inbox', 'In Progress', 'Waiting']);
    expect(labels(matchingChoices(statuses, 'NEXT-'))).toEqual(['Next Action']);
  });

  it('offers every choice for nothing typed', () => {
    expect(matchingChoices(statuses, '  ')).toHaveLength(GTD_STATUSES.length);
  });
});

describe('choiceNamed', () => {
  const choices: FilterChoice[] = [
    { value: 'next-action', label: 'Next Action' },
    { value: 'in_progress', label: 'Doing' },
  ];

  it('reads a choice by its label or its value, however it is cased or spaced', () => {
    for (const typed of ['Next Action', 'next action', 'NEXT-ACTION', ' next-action ']) {
      expect(choiceNamed(choices, typed)?.value).toBe('next-action');
    }
    expect(choiceNamed(choices, 'in progress')?.value).toBe('in_progress');
    expect(choiceNamed(choices, 'doing')?.value).toBe('in_progress');
  });

  it('prefers a value written exactly over another choice’s label', () => {
    const clash: FilterChoice[] = [
      { value: 'Done', label: 'Finished' },
      { value: 'done', label: 'Done' },
    ];
    expect(choiceNamed(clash, 'done')?.value).toBe('done');
    expect(choiceNamed(clash, 'Done')?.value).toBe('Done');
  });

  it('names nothing for text no choice reads as', () => {
    expect(choiceNamed(choices, 'next')).toBeNull();
    expect(choiceNamed([], 'next-action')).toBeNull();
  });
});

describe('relatedChoices', () => {
  it('offers each link by the title of the note it opens, in title order', () => {
    const names = noteNames([
      { path: createVaultPath('projects/b.md'), title: 'Quill audit' },
      { path: createVaultPath('projects/a.md'), title: 'Larkspur launch' },
    ]);
    expect(relatedChoices(['[[b]]', '[[a]]', '[[gone]]'], names)).toEqual([
      { value: '[[gone]]', label: 'gone' },
      { value: '[[a]]', label: 'Larkspur launch' },
      { value: '[[b]]', label: 'Quill audit' },
    ]);
  });
});

describe('a label typed exactly as the table shows it (#212)', () => {
  it('stores that select option, not an earlier option that folds to the same slug', () => {
    // Two declared options; the table shows them as "Follow up" and "Follow-up".
    const choices = filterChoices(
      { key: 'stage', kind: 'select', options: ['follow up', 'follow-up'] },
      NO_CHOICE_SOURCES,
    );
    expect(choices.map((choice) => choice.label)).toEqual(['Follow up', 'Follow-up']);

    expect(filterValueFrom('Follow-up', 'select', choices)).toBe('follow-up');
  });

  it('stores that relation note, not another note whose title differs only in case', () => {
    const notes = [
      { path: createVaultPath('projects/Q3 Plan.md'), title: 'Q3 Plan' },
      { path: createVaultPath('archive/q3 plan.md'), title: 'q3 plan' },
    ];
    const names = noteNames(notes);
    const choices = relatedChoices(
      notes.map((note) => names.linkTo(note.path)),
      names,
    );
    // localeCompare sorts the lower-case title first.
    expect(choices.map((choice) => choice.label)).toEqual(['q3 plan', 'Q3 Plan']);

    // Typed exactly as the table shows the project, Enter without picking from the list.
    expect(filterValueFrom('Q3 Plan', 'relation', choices)).toBe('[[Q3 Plan]]');
  });
});

describe('a tag is never rewritten to another spelling (#212)', () => {
  const tags = filterChoices(
    { key: 'tags', kind: 'multiSelect' },
    { tags: ['Errand', 'follow-up'], related: {} },
  );

  it('is offered as it is written, and named only by that exact spelling', () => {
    expect(tags.map((choice) => choice.label)).toEqual(['Errand', 'follow-up']);
    expect(choiceNamed(tags, 'Errand')?.value).toBe('Errand');
    expect(choiceNamed(tags, 'errand')).toBeNull();
    expect(choiceNamed(tags, 'follow up')).toBeNull();
  });

  it('keeps what was typed for it, case and spaces and all', () => {
    expect(filterValueFrom('errand', 'multiSelect', tags)).toBe('errand');
    expect(filterValueFrom('follow up', 'multiSelect', tags)).toBe('follow up');
  });
});
