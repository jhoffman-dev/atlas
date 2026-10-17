import { describe, expect, it } from 'vitest';
import { isSettingsFile, settingsAdditions, type SettingsSide } from './settings-merge.ts';

const side = (frontmatter: Record<string, unknown>, body = '\nMine.\n'): SettingsSide => ({
  frontmatter,
  body,
});

const attendees = { kind: 'relation', target: 'person', many: true };
const tasks = { kind: 'relation', target: 'task', many: true };
const summary = { kind: 'text', label: 'Summary of' };

const BASE = side({ name: 'meeting', properties: { attendees } });

describe('isSettingsFile', () => {
  it('is a markdown file under `.atlas`, and nothing else', () => {
    expect(isSettingsFile('.atlas/types/meeting.md')).toBe(true);
    expect(isSettingsFile('.atlas/migrations/type-properties.MD')).toBe(true);
    expect(isSettingsFile('.atlas/sources/logo.png')).toBe(false);
    expect(isSettingsFile('Notes/.atlas/types/meeting.md')).toBe(false);
    expect(isSettingsFile('.atlas-cache/meeting.md')).toBe(false);
    expect(isSettingsFile('Meeting.md')).toBe(false);
  });
});

describe('settingsAdditions', () => {
  it('gives one side the entries the other added to a map, in its order', () => {
    const onto = side({ name: 'meeting', properties: { attendees, tasks } });
    const from = side({ name: 'meeting', properties: { attendees, tasks, summary } });
    expect(settingsAdditions({ base: BASE, onto, from })).toEqual({
      keys: [],
      entries: { properties: ['summary'] },
    });
  });

  it('adds nothing where the other side’s additions are all there already, maps in any key order', () => {
    const onto = side({ name: 'meeting', properties: { attendees, tasks, summary } });
    const from = side({
      name: 'meeting',
      properties: { attendees, tasks: { many: true, target: 'task', kind: 'relation' } },
    });
    expect(settingsAdditions({ base: BASE, onto, from })).toEqual({ keys: [], entries: {} });
  });

  it('gives one side a top-level key the other added', () => {
    const onto = side({ name: 'meeting', label: 'Meeting', properties: { attendees } });
    const from = side({ name: 'meeting', icon: 'calendar', properties: { attendees } });
    const base = side({ name: 'meeting', properties: { attendees } });
    expect(settingsAdditions({ base, onto, from })).toEqual({ keys: ['icon'], entries: {} });
  });

  it('keeps a change only one side made to a key: the other left it as it was', () => {
    const onto = side({ name: 'meeting', label: 'Meetings', properties: { attendees } });
    const from = side({ name: 'meeting', label: 'Meeting', properties: { attendees, tasks } });
    const base = side({ name: 'meeting', label: 'Meeting', properties: { attendees } });
    expect(settingsAdditions({ base, onto, from })).toEqual({
      keys: [],
      entries: { properties: ['tasks'] },
    });
  });

  it('is null when both sides gave a key different values', () => {
    const onto = side({ name: 'meeting', label: 'Meetings' });
    const from = side({ name: 'meeting', label: 'Calls' });
    expect(settingsAdditions({ base: side({ name: 'meeting' }), onto, from })).toBeNull();
  });

  it('is null when both sides added the same entry differently', () => {
    const onto = side({ name: 'meeting', properties: { attendees, tasks } });
    const from = side({ name: 'meeting', properties: { attendees, tasks: { kind: 'text' } } });
    expect(settingsAdditions({ base: BASE, onto, from })).toBeNull();
  });

  it('is null when the other side changed what this side kept: only a person can choose', () => {
    const onto = side({ name: 'meeting', properties: { attendees } });
    const from = side({ name: 'meeting', properties: { attendees: { kind: 'text' } } });
    expect(settingsAdditions({ base: BASE, onto, from })).toBeNull();
  });

  it('is null when the other side removed a key or an entry this side still has', () => {
    const removedKey = side({ properties: { attendees } });
    expect(settingsAdditions({ base: BASE, onto: BASE, from: removedKey })).toBeNull();
    const removedEntry = side({ name: 'meeting', properties: {} });
    expect(settingsAdditions({ base: BASE, onto: BASE, from: removedEntry })).toBeNull();
  });

  it('leaves out a key this side removed that the other left as it was', () => {
    const onto = side({ name: 'meeting', properties: {} });
    const from = side({ name: 'meeting', properties: { attendees, tasks } });
    expect(settingsAdditions({ base: BASE, onto, from })).toEqual({
      keys: [],
      entries: { properties: ['tasks'] },
    });
  });

  it('is null when this side removed an entry the other changed', () => {
    const onto = side({ name: 'meeting', properties: {} });
    const from = side({ name: 'meeting', properties: { attendees: { kind: 'text' } } });
    expect(settingsAdditions({ base: BASE, onto, from })).toBeNull();
  });

  it('is null when a map on one side is something else on the other', () => {
    const onto = side({ name: 'meeting', properties: ['attendees'] });
    const from = side({ name: 'meeting', properties: { attendees, tasks } });
    expect(settingsAdditions({ base: BASE, onto, from })).toBeNull();
  });

  it('takes this side’s body when only it changed the body, and is null when both did', () => {
    const onto = side({ name: 'meeting', properties: { attendees } }, '\nRewritten.\n');
    const from = side({ name: 'meeting', properties: { attendees, tasks } });
    expect(settingsAdditions({ base: BASE, onto, from })).not.toBeNull();
    const both = side({ name: 'meeting', properties: { attendees, tasks } }, '\nMine too.\n');
    expect(settingsAdditions({ base: BASE, onto, from: both })).toBeNull();
  });

  it('with no base — both Macs made the file — adds only what this side lacks, the rest the same', () => {
    const onto = side({ name: 'daily', properties: { date: { kind: 'date' } } });
    const from = side({ name: 'daily', properties: { date: { kind: 'date' }, mood: summary } });
    expect(settingsAdditions({ base: null, onto, from })).toEqual({
      keys: [],
      entries: { properties: ['mood'] },
    });
    const otherBody = side({ name: 'daily' }, '\nTheirs.\n');
    expect(settingsAdditions({ base: null, onto, from: otherBody })).toBeNull();
  });

  it('compares dates by the time they say, and lists by their items in order', () => {
    const at = (iso: string) => new Date(iso);
    const base = side({ since: at('2026-10-01'), tags: ['a', 'b'] });
    expect(
      settingsAdditions({
        base,
        onto: base,
        from: side({ since: at('2026-10-01'), tags: ['a', 'b'] }),
      }),
    ).toEqual({ keys: [], entries: {} });
    expect(
      settingsAdditions({
        base,
        onto: side({ since: at('2026-10-02'), tags: ['a', 'b'] }),
        from: side({ since: at('2026-10-03'), tags: ['a', 'b'] }),
      }),
    ).toBeNull();
    expect(
      settingsAdditions({
        base,
        onto: side({ since: at('2026-10-01'), tags: ['b', 'a'] }),
        from: side({ since: at('2026-10-01'), tags: ['a', 'c'] }),
      }),
    ).toBeNull();
  });
});
