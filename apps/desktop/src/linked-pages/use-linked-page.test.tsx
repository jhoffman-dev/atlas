// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { parseObjectType, type LinkedRange, type LinkedSectionId } from '@atlas/domain';
import type { IndexPort, LinkedRangeStore, QueryResult } from '@atlas/application';
import { useLinkedPage } from './use-linked-page.ts';

const TYPES = [
  parseObjectType({ name: 'person', label: 'Person', properties: {} }),
  parseObjectType({
    name: 'meeting',
    label: 'Meeting',
    properties: { date: 'date', people: { kind: 'relation', target: 'person', many: true } },
  }),
];
const NOTES = ['People/Mara Quill.md', 'People/Tobias Fenn.md', 'Meetings/Kickoff.md'];
const MARA = 'People/Mara Quill.md';
const TOBIAS = 'People/Tobias Fenn.md';

type Ranges = Partial<Record<LinkedSectionId, LinkedRange>>;

function memoryStore(seed: Record<string, Ranges> = {}) {
  const held = new Map(Object.entries(seed));
  const store: LinkedRangeStore = {
    read: (pageType) => held.get(pageType) ?? {},
    write: (pageType, section, range) => {
      held.set(pageType, { ...held.get(pageType), [section]: range });
    },
  };
  return { store, held };
}

/** An index answering each query with one meeting named for the page asked about, and recording it. */
function recordingIndex() {
  const asked: { sql: string; parameters: readonly unknown[] }[] = [];
  const pending: (() => void)[] = [];
  let held = false;
  const answer = (parameters: readonly unknown[], call: number): QueryResult => {
    const page = parameters.find((value) => typeof value === 'string' && value.endsWith('.md'));
    return {
      columns: ['path', 'title', 'type', 'date'],
      rows: [[`Meetings/${String(page)}`, `With ${String(page)}`, 'meeting', `call ${call}`]],
      truncated: false,
    };
  };
  const query: IndexPort['query'] = (sql, parameters) => {
    asked.push({ sql, parameters });
    const call = asked.length;
    if (!held) return Promise.resolve(answer(parameters, call));
    return new Promise((resolve) => pending.push(() => resolve(answer(parameters, call))));
  };
  return {
    index: { query } as IndexPort,
    asked,
    hold: () => {
      held = true;
    },
    release: () => pending.splice(0).forEach((resolve) => resolve()),
    /** Answers what is held back, the last asked first: a slow first read landing late. */
    releaseNewestFirst: () =>
      pending
        .splice(0)
        .reverse()
        .forEach((resolve) => resolve()),
  };
}

const clock = { today: () => '2026-10-13' };

interface PaneProps {
  notePath: string | null;
  typeName: string | null;
  revision: string;
}

const FIRST: PaneProps = { notePath: MARA, typeName: 'person', revision: '1' };

function mount(
  given: { store?: LinkedRangeStore; index?: ReturnType<typeof recordingIndex> } = {},
) {
  const index = given.index ?? recordingIndex();
  const store = given.store ?? memoryStore().store;
  const hook = renderHook(
    (props: PaneProps) =>
      useLinkedPage({ index: index.index, clock, store, types: TYPES, notePaths: NOTES, ...props }),
    { initialProps: FIRST },
  );
  return { ...hook, index };
}

describe('useLinkedPage', () => {
  it('reads a linked page’s sections, nothing shown until they are read', async () => {
    const { result } = mount();
    expect(result.current?.sections).toBeNull();
    await waitFor(() => expect(result.current?.sections).not.toBeNull());
    expect(result.current?.sections?.map((section) => section.id)).toEqual(['meetings', 'notes']);
    expect(result.current?.sections?.[0]?.rows[0]?.title).toBe(`With ${MARA}`);
  });

  it('is nothing for a note of another type, a note with no type, or no note', () => {
    const { result, rerender, index } = mount();
    rerender({ notePath: 'Notes/Loose.md', typeName: 'resource', revision: '1' });
    expect(result.current).toBeNull();
    rerender({ notePath: 'Notes/Loose.md', typeName: null, revision: '1' });
    expect(result.current).toBeNull();
    rerender({ notePath: null, typeName: 'person', revision: '1' });
    expect(result.current).toBeNull();
    // Only the first page was ever asked about.
    expect(index.asked.every(({ parameters }) => parameters.includes(MARA))).toBe(true);
  });

  it('reads the sections again when the index changes, keeping what was shown meanwhile', async () => {
    const { result, rerender, index } = mount();
    await waitFor(() => expect(result.current?.sections).not.toBeNull());
    const before = index.asked.length;
    index.hold();
    rerender({ notePath: MARA, typeName: 'person', revision: '2' });
    expect(index.asked.length).toBe(before * 2);
    expect(result.current?.sections?.[0]?.rows[0]?.title).toBe(`With ${MARA}`);
    await act(async () => index.release());
  });

  it('never shows one page’s sections on another', async () => {
    const { result, rerender, index } = mount();
    await waitFor(() => expect(result.current?.sections).not.toBeNull());
    index.hold();
    rerender({ notePath: TOBIAS, typeName: 'person', revision: '1' });
    expect(result.current?.sections).toBeNull();
    await act(async () => index.release());
    await waitFor(() =>
      expect(result.current?.sections?.[0]?.rows[0]?.title).toBe(`With ${TOBIAS}`),
    );
  });

  it('drops an answer that comes back after the pane has moved on', async () => {
    const index = recordingIndex();
    index.hold();
    const { result, rerender } = mount({ index });
    rerender({ notePath: TOBIAS, typeName: 'person', revision: '1' });
    await act(async () => index.release());
    await waitFor(() => expect(result.current?.sections).not.toBeNull());
    expect(result.current?.sections?.[0]?.rows[0]?.title).toBe(`With ${TOBIAS}`);
  });

  it('keeps the newer read when an older one of the same page lands after it', async () => {
    const index = recordingIndex();
    index.hold();
    const { result, rerender } = mount({ index });
    rerender({ notePath: MARA, typeName: 'person', revision: '2' });
    // Two sections a read: calls 1 and 2, then 3 and 4.
    expect(index.asked).toHaveLength(4);
    await act(async () => index.releaseNewestFirst());
    await waitFor(() => expect(result.current?.sections).not.toBeNull());
    expect(result.current?.sections?.[0]?.rows[0]?.values['date']).toBe('call 3');
  });

  it('opens each section on the range this Mac last left it on', async () => {
    const { store } = memoryStore({ person: { meetings: 'all' } });
    const { result } = mount({ store });
    await waitFor(() => expect(result.current?.sections).not.toBeNull());
    expect(result.current?.sections?.map((section) => section.range)).toEqual(['all', 'recent']);
  });

  it('turns a section to all: remembered for the page’s type, and read again', async () => {
    const { store, held } = memoryStore();
    const { result, index } = mount({ store });
    await waitFor(() => expect(result.current?.sections).not.toBeNull());
    expect(result.current?.sections?.[0]?.range).toBe('recent');
    const before = index.asked.length;
    act(() => result.current?.setRange('meetings', 'all'));
    await waitFor(() => expect(result.current?.sections?.[0]?.range).toBe('all'));
    expect(held.get('person')).toEqual({ meetings: 'all' });
    expect(index.asked.length).toBe(before * 2);
  });

  it('keeps what it showed when reading it again fails outright', async () => {
    let fails = false;
    const failing = {
      today: () => {
        if (fails) throw new Error('no clock');
        return '2026-10-13';
      },
    };
    const index = recordingIndex();
    const { result, rerender } = renderHook(
      ({ revision }: { revision: string }) =>
        useLinkedPage({
          index: index.index,
          clock: failing,
          store: memoryStore().store,
          types: TYPES,
          notePaths: NOTES,
          notePath: MARA,
          typeName: 'person',
          revision,
        }),
      { initialProps: { revision: '1' } },
    );
    await waitFor(() => expect(result.current?.sections).not.toBeNull());
    fails = true;
    rerender({ revision: '2' });
    await act(async () => {});
    expect(result.current?.sections?.[0]?.rows[0]?.title).toBe(`With ${MARA}`);
  });
});
