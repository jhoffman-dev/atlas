import { describe, expect, it } from 'vitest';
import {
  isSettingsFile,
  mergeSettingsText,
  sameFrontmatterValue,
  writtenMap,
  type SettingsText,
} from './settings-merge.ts';

/** A version from its keys' texts, each cut into entries where it can be. */
const version = (texts: string[], body = '\nMeetings.\n'): SettingsText => ({
  keys: texts.map((text) => ({ key: keyOf(text), text, map: writtenMap(text) })),
  body,
});

/** The key a text writes: its first line that is not a comment or blank. */
const keyOf = (text: string) => {
  const line = text.split('\n').find((each) => each.trim() !== '' && !each.startsWith('#')) ?? '';
  return line.slice(0, line.indexOf(':'));
};

const NAME = 'name: meeting\n';
const props = (...entries: string[]) => `properties:\n${entries.join('')}`;
const DATE = '  date:\n    kind: date\n';
const TASKS = '  tasks:\n    kind: relation\n';
const ROOM = '  # Mara Quill: the room it was in\n  room:\n    kind: text\n';

const BASE = version([NAME, props(DATE)]);

describe('isSettingsFile', () => {
  it('is a markdown file under `.atlas`, and nothing else', () => {
    expect(isSettingsFile('.atlas/types/meeting.md')).toBe(true);
    expect(isSettingsFile('.atlas/migrations/type-properties.MD')).toBe(true);
    expect(isSettingsFile('.atlas/sources/logo.png')).toBe(false);
    expect(isSettingsFile('Notes/.atlas/types/meeting.md')).toBe(false);
    expect(isSettingsFile('.atlas-cache/meeting.md')).toBe(false);
  });
});

describe('writtenMap', () => {
  it('cuts a block map into its entries, each with the comments just above it', () => {
    expect(writtenMap(props(DATE, ROOM))).toEqual({
      head: 'properties:\n',
      indent: 2,
      entries: [
        { name: 'date', text: DATE },
        { name: 'room', text: ROOM },
      ],
    });
  });

  it('keeps a comment deeper than the entries with the entry it is in', () => {
    const inner = '  date:\n    kind: date\n    # held, not invited\n';
    expect(writtenMap(props(inner, TASKS))?.entries.map(({ text }) => text)).toEqual([
      inner,
      TASKS,
    ]);
  });

  it.each([
    ['a value on the key’s line', 'properties: { date: { kind: date } }\n'],
    ['a list', 'tags:\n  - one\n'],
    ['a quoted entry name', 'properties:\n  "date":\n    kind: date\n'],
    ['no entries', 'properties:\n'],
    ['a scalar', 'label: Meeting\n'],
  ])('is null for %s', (_, text) => {
    expect(writtenMap(text)).toBeNull();
  });
});

describe('mergeSettingsText', () => {
  it('keeps one side whole and puts the other’s new entries after its own, as written', () => {
    const merged = mergeSettingsText({
      base: BASE,
      onto: version([NAME, props(DATE, TASKS)]),
      from: version([NAME, props(DATE, ROOM)]),
    });
    expect(merged?.frontmatter).toBe(NAME + props(DATE, TASKS, ROOM));
    expect(merged?.folded).toEqual({ keys: [], entries: new Map([['properties', ['room']]]) });
  });

  it('puts a top-level key the other side added after this side’s keys, as written', () => {
    const icon = '# the calendar glyph\nicon:   "calendar"\n';
    const merged = mergeSettingsText({
      base: BASE,
      onto: version([NAME, props(DATE)]),
      from: version([NAME, icon, props(DATE)]),
    });
    expect(merged?.frontmatter).toBe(NAME + props(DATE) + icon);
    expect(merged?.folded.keys).toEqual(['icon']);
  });

  it('keeps every edit of the side kept: only the side folded in must have only added', () => {
    const relabelled = 'name: meetings # plural now\n';
    const merged = mergeSettingsText({
      base: BASE,
      onto: version([relabelled, props(DATE)]),
      from: version([NAME, props(DATE, TASKS)]),
    });
    expect(merged?.frontmatter).toBe(relabelled + props(DATE, TASKS));
  });

  it.each([
    ['a comment', version([NAME, props(DATE, '  # Tobias Fenn: held, not invited\n')])],
    ['a comment on a key', version(['# ours\nname: meeting\n', props(DATE, TASKS)])],
    ['a restyled value', version(['name: "meeting"\n', props(DATE, TASKS)])],
    ['a reorder', version([props(DATE, TASKS), NAME])],
    ['a blank line', version([NAME, `\n${props(DATE, TASKS)}`])],
    ['a removed key', version([props(DATE, TASKS)])],
    ['a removed entry', version([NAME, props(TASKS)])],
    ['a changed entry', version([NAME, props('  date:\n    kind: text\n', TASKS)])],
  ])('is null when the side folded in has %s beside what it added', (_, from) => {
    expect(mergeSettingsText({ base: BASE, onto: BASE, from })).toBeNull();
  });

  it('is null when both sides added one key written differently', () => {
    expect(
      mergeSettingsText({
        base: BASE,
        onto: version([NAME, props(DATE, TASKS)]),
        from: version([NAME, props(DATE, '  tasks:\n    kind: text\n')]),
      }),
    ).toBeNull();
    expect(
      mergeSettingsText({
        base: BASE,
        onto: version([NAME, 'icon: calendar\n', props(DATE)]),
        from: version([NAME, 'icon: phone\n', props(DATE)]),
      }),
    ).toBeNull();
  });

  it('is the side kept as it is when the other only added what it has, written the same', () => {
    const onto = version([NAME, props(DATE, TASKS, ROOM)]);
    const merged = mergeSettingsText({
      base: BASE,
      onto,
      from: version([NAME, props(DATE, TASKS)]),
    });
    expect(merged?.frontmatter).toBe(NAME + props(DATE, TASKS, ROOM));
    expect(merged?.folded).toEqual({ keys: [], entries: new Map() });
  });

  it('is null when the side kept dropped the map the other side added entries to', () => {
    expect(
      mergeSettingsText({
        base: BASE,
        onto: version([NAME]),
        from: version([NAME, props(DATE, TASKS)]),
      }),
    ).toBeNull();
  });

  it('takes this side’s body when only it changed it, and is null when both did', () => {
    const onto = version([NAME, props(DATE)], '\nRewritten.\n');
    const from = version([NAME, props(DATE, TASKS)]);
    expect(mergeSettingsText({ base: BASE, onto, from })?.body).toBe('\nRewritten.\n');
    const both = version([NAME, props(DATE, TASKS)], '\nMine too.\n');
    expect(mergeSettingsText({ base: BASE, onto, from: both })).toBeNull();
  });

  it('with no base, adds what one side has beyond what both share written the same', () => {
    const onto = version(['name: board\n', 'group: status\n']);
    const from = version(['name: board\n', 'sort: due\n']);
    expect(mergeSettingsText({ base: null, onto, from })?.frontmatter).toBe(
      'name: board\ngroup: status\nsort: due\n',
    );
    const restyled = version(['name: "board"\n', 'sort: due\n']);
    expect(mergeSettingsText({ base: null, onto, from: restyled })).toBeNull();
  });

  it('is null for a key or entry that does not end its line', () => {
    expect(
      mergeSettingsText({ base: BASE, onto: BASE, from: version([NAME, props(DATE), 'icon: x']) }),
    ).toBeNull();
  });
});

describe('sameFrontmatterValue', () => {
  it('compares maps in any key order, lists in order, and dates by their time', () => {
    expect(sameFrontmatterValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameFrontmatterValue([1, 2], [2, 1])).toBe(false);
    expect(sameFrontmatterValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameFrontmatterValue(new Date('2026-10-01'), new Date('2026-10-01'))).toBe(true);
    expect(sameFrontmatterValue(new Date('2026-10-01'), '2026-10-01')).toBe(false);
  });
});
