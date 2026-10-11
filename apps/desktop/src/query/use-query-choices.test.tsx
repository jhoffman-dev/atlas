// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { parseObjectType, propertyField } from '@atlas/domain';
import { fakeIndexPort } from '@atlas/application';
import { useQueryChoices } from './use-query-choices.ts';

const TASK = parseObjectType({
  name: 'task',
  properties: {
    project: { kind: 'relation', target: ['project', 'area'] },
    owner: { kind: 'relation', target: 'person' },
  },
});
const [PROJECT_FIELD, OWNER_FIELD] = TASK.properties.map(propertyField);

const index = fakeIndexPort({
  notesOfType: async (type) =>
    ({
      project: [{ path: 'Projects/Atlas.md', title: 'Atlas' }],
      area: [{ path: 'Areas/Garden.md', title: 'Garden' }],
      person: [{ path: 'People/Mara Quill.md', title: 'Mara Quill' }],
    })[type] ?? [],
});
const NOTE_PATHS = ['Projects/Atlas.md', 'Areas/Garden.md', 'People/Mara Quill.md'];
const FIELDS = [PROJECT_FIELD!, OWNER_FIELD!];

describe('useQueryChoices — a relation to several types (P30-01)', () => {
  it('offers the notes of every type it points at, and of no other', async () => {
    const { result } = renderHook(() =>
      useQueryChoices({
        index,
        types: [TASK],
        fields: FIELDS,
        notePaths: NOTE_PATHS,
        indexKey: '1',
      }),
    );
    await waitFor(() => expect(result.current.valueChoices(PROJECT_FIELD!)).toHaveLength(2));
    expect(result.current.valueChoices(PROJECT_FIELD!)).toEqual(['Atlas', 'Garden']);
    expect(result.current.valueChoices(OWNER_FIELD!)).toEqual(['Mara Quill']);
  });
});
