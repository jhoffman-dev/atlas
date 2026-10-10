import { describe, expect, it } from 'vitest';
import { parseObjectType, type ObjectType } from './property-def.ts';
import { isDoneValue, statusOf, statusToRemember, untickedValue } from './status-property.ts';
import { applyTypeEdit, TypeEditError } from './type-edit.ts';
import { propertySpec, typeFrontmatter } from './type-frontmatter.ts';

const typeOf = (properties: Record<string, unknown>): ObjectType =>
  parseObjectType({ name: 'task', properties });

describe('reading a done option from a type file', () => {
  it('reads `done:` on a select that lists it', () => {
    const type = typeOf({
      status: { kind: 'select', options: ['open', 'shipped'], done: 'shipped' },
    });
    expect(type.properties[0]?.done).toBe('shipped');
  });

  it('drops a done option the select does not list', () => {
    const type = typeOf({ status: { kind: 'select', options: ['open', 'shipped'], done: 'gone' } });
    expect(type.properties[0]?.done).toBeUndefined();
  });

  it('ignores `done:` on anything but a single choice', () => {
    const type = typeOf({ tags: { kind: 'multiSelect', options: ['a', 'b'], done: 'a' } });
    expect(type.properties[0]?.done).toBeUndefined();
  });

  it('writes it back, and a type without one is written as it was', () => {
    const marked = typeOf({
      status: { kind: 'select', options: ['open', 'shipped'], done: 'shipped' },
    });
    expect(propertySpec(marked.properties[0]!)).toEqual({
      kind: 'select',
      options: ['open', 'shipped'],
      done: 'shipped',
    });
    const plain = typeOf({ status: { kind: 'select', options: ['open', 'done'] } });
    expect(propertySpec(plain.properties[0]!)).toEqual({
      kind: 'select',
      options: ['open', 'done'],
    });
  });

  it('round-trips through the frontmatter a type is saved as', () => {
    const type = typeOf({
      status: { kind: 'select', options: ['open', 'shipped'], done: 'shipped' },
    });
    const again = parseObjectType({ name: 'task', ...typeFrontmatter(type) });
    expect(again.properties[0]?.done).toBe('shipped');
  });
});

describe('statusOf', () => {
  it('takes the select that names its done option', () => {
    const type = typeOf({
      stage: { kind: 'select', options: ['todo', 'done'] },
      status: { kind: 'select', options: ['open', 'shipped'], done: 'shipped' },
    });
    expect(statusOf(type)).toEqual({
      key: 'status',
      done: 'shipped',
      options: ['open', 'shipped'],
    });
  });

  it('falls back to the first select with an option named like done, for older types', () => {
    const type = typeOf({
      priority: { kind: 'select', options: ['low', 'high'] },
      status: { kind: 'select', options: ['todo', 'Complete'] },
      stage: { kind: 'select', options: ['a', 'done'] },
    });
    expect(statusOf(type)).toEqual({
      key: 'status',
      done: 'Complete',
      options: ['todo', 'Complete'],
    });
  });

  it('is null for a type with nothing that means finished', () => {
    expect(statusOf(typeOf({ priority: { kind: 'select', options: ['low'] } }))).toBeNull();
    expect(statusOf(typeOf({ tags: { kind: 'multiSelect', options: ['done'] } }))).toBeNull();
    expect(statusOf(null)).toBeNull();
  });
});

describe('isDoneValue', () => {
  const status = { key: 'status', done: 'done', options: ['todo', 'done'] };

  it('is the done option exactly', () => {
    expect(isDoneValue(status, 'done')).toBe(true);
    expect(isDoneValue(status, 'todo')).toBe(false);
    expect(isDoneValue(status, null)).toBe(false);
    expect(isDoneValue(status, 'Done')).toBe(false);
  });
});

describe('untickedValue', () => {
  const status = { key: 'status', done: 'done', options: ['backlog', 'doing', 'done'] };

  it('puts back what the status was before the tick', () => {
    expect(untickedValue({ status, previous: 'doing' })).toBe('doing');
  });

  it('starts over when the earlier value is unknown, gone, or itself done', () => {
    expect(untickedValue({ status, previous: null })).toBe('backlog');
    expect(untickedValue({ status, previous: 'removed' })).toBe('backlog');
    expect(untickedValue({ status, previous: 'done' })).toBe('backlog');
  });

  it('skips a first option that is the done one', () => {
    expect(
      untickedValue({ status: { ...status, options: ['done', 'open'] }, previous: null }),
    ).toBe('open');
  });

  it('is null when there is nothing but done to go back to', () => {
    expect(untickedValue({ status: { ...status, options: ['done'] }, previous: null })).toBeNull();
  });
  it('reopens a GTD task as Next Action when nothing remembers where it was (ADR-0029)', () => {
    const gtd = {
      key: 'status',
      done: 'archive',
      options: [
        'inbox',
        'backlog',
        'next-action',
        'in-progress',
        'waiting',
        'someday',
        'longterm',
        'archive',
      ],
    };
    expect(untickedValue({ status: gtd, previous: null })).toBe('next-action');
    expect(untickedValue({ status: gtd, previous: 'waiting' })).toBe('waiting');
  });
});

describe('editing the done option', () => {
  const types = { types: ['task'] };
  const status = () =>
    typeOf({ status: { kind: 'select', options: ['open', 'shipped'], done: 'shipped' } });

  it('chooses and clears it', () => {
    const plain = typeOf({ status: { kind: 'select', options: ['open', 'shipped'] } });
    const chosen = applyTypeEdit(
      plain,
      { kind: 'setDoneOption', key: 'status', option: 'shipped' },
      types,
    );
    expect(chosen.type.properties[0]?.done).toBe('shipped');
    const cleared = applyTypeEdit(
      chosen.type,
      { kind: 'setDoneOption', key: 'status', option: null },
      types,
    );
    expect(cleared.type.properties[0]).not.toHaveProperty('done');
  });

  it('refuses an option the select does not have, or a property that is not a single choice', () => {
    expect(() =>
      applyTypeEdit(status(), { kind: 'setDoneOption', key: 'status', option: 'nope' }, types),
    ).toThrow(TypeEditError);
    const tags = typeOf({ tags: { kind: 'multiSelect', options: ['a'] } });
    expect(() =>
      applyTypeEdit(tags, { kind: 'setDoneOption', key: 'tags', option: 'a' }, types),
    ).toThrow(TypeEditError);
  });

  it('follows its option when the option is renamed', () => {
    const renamed = applyTypeEdit(
      status(),
      { kind: 'renameOption', key: 'status', from: 'shipped', to: 'released' },
      types,
    );
    expect(renamed.type.properties[0]?.done).toBe('released');
  });

  it('keeps it when another option is renamed or removed', () => {
    const renamed = applyTypeEdit(
      status(),
      { kind: 'renameOption', key: 'status', from: 'open', to: 'todo' },
      types,
    );
    expect(renamed.type.properties[0]?.done).toBe('shipped');
    const removed = applyTypeEdit(
      status(),
      { kind: 'removeOption', key: 'status', option: 'open' },
      types,
    );
    expect(removed.type.properties[0]?.done).toBe('shipped');
  });

  it('is dropped with its option, and when the property stops being a single choice', () => {
    const removed = applyTypeEdit(
      status(),
      { kind: 'removeOption', key: 'status', option: 'shipped' },
      types,
    );
    expect(removed.type.properties[0]).not.toHaveProperty('done');
    const many = applyTypeEdit(
      status(),
      { kind: 'changeKind', key: 'status', propertyKind: 'multiSelect' },
      types,
    );
    expect(many.type.properties[0]).not.toHaveProperty('done');
  });
});

describe('statusToRemember', () => {
  const status = { key: 'status', done: 'done', options: ['backlog', 'review', 'done'] };

  it('keeps the status a note held when it was ticked, so unticking can put it back', () => {
    expect(statusToRemember({ status, value: 'review' })).toBe('review');
  });

  it('keeps nothing when the note was already done, or held no status', () => {
    expect(statusToRemember({ status, value: 'done' })).toBeNull();
    expect(statusToRemember({ status, value: '' })).toBeNull();
    expect(statusToRemember({ status, value: undefined })).toBeNull();
    expect(statusToRemember({ status, value: ['review'] })).toBeNull();
  });
});
