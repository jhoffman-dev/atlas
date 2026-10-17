/**
 * `mergeSettings` with the real markdown adapter (#233): what the sync writes
 * for a settings file both Macs changed — every line of the side it keeps
 * byte for byte (ADR-0003), and the other side's additions as new lines.
 */
import { describe, expect, it } from 'vitest';
import { mergeSettings } from '@atlas/application';
import { remarkMarkdown } from '@atlas/adapters';

const TYPE = '.atlas/types/meeting.md';

const typeFile = (properties: string[], { extra = '', body = '\nMeetings.\n' } = {}) =>
  [
    '---',
    'name: meeting',
    '# kept as written',
    'label: Meeting',
    ...(extra === '' ? [] : [extra]),
    'properties:',
    ...properties,
    '---',
    body,
  ].join('\n');

const ATTENDEES = ['  attendees:', '    kind: relation', '    target: person'];
const TASKS = ['  tasks:', '    kind: relation', '    target: task', '    many: true'];
const SUMMARY = ['  atlas_summary_of: { kind: text, label: Summary of }'];

const merge = (versions: { base: string | null; ours: string; theirs: string }, path = TYPE) =>
  mergeSettings(remarkMarkdown, { path, ...versions });

const keysOf = (text: string) =>
  Object.keys(
    remarkMarkdown.frontmatterProperties(text.slice(0, text.indexOf('\n---\n') + 5))[
      'properties'
    ] as Record<string, unknown>,
  );

describe('mergeSettings (#233)', () => {
  it('keeps this Mac’s file byte for byte and puts the other’s new entries after its own', () => {
    const base = typeFile(ATTENDEES);
    const ours = typeFile([...ATTENDEES, ...TASKS]);
    const theirs = typeFile([...ATTENDEES, ...SUMMARY]);
    const merged = merge({ base, ours, theirs });
    expect(merged).not.toBeNull();
    expect(merged!.startsWith(ours.slice(0, ours.indexOf('\n---\n')))).toBe(true);
    expect(merged!.endsWith('---\n\nMeetings.\n')).toBe(true);
    expect(keysOf(merged!)).toEqual(['attendees', 'tasks', 'atlas_summary_of']);
  });

  it('is this Mac’s file exactly when it already holds everything the other added', () => {
    const base = typeFile(ATTENDEES);
    const ours = typeFile([...ATTENDEES, ...TASKS, ...SUMMARY]);
    const theirs = typeFile([...ATTENDEES, ...TASKS]);
    expect(merge({ base, ours, theirs })).toBe(ours);
  });

  it('writes this Mac’s additions into the other’s file when only that way round is additive', () => {
    const base = typeFile(ATTENDEES);
    const ours = typeFile([...ATTENDEES, ...TASKS]);
    const theirs = typeFile(ATTENDEES, { body: '\nMeetings, rewritten.\n' });
    const merged = merge({ base, ours, theirs });
    expect(merged?.endsWith('\nMeetings, rewritten.\n')).toBe(true);
    expect(keysOf(merged!)).toEqual(['attendees', 'tasks']);
  });

  it('copies a top-level key the other side added as it wrote it', () => {
    const base = typeFile(ATTENDEES);
    const theirs = typeFile(ATTENDEES, { extra: 'icon:   "calendar" # theirs' });
    const merged = merge({ base, ours: base, theirs });
    expect(merged).toContain('icon:   "calendar" # theirs\n');
  });

  it('is null for a real conflict: both Macs gave a key different values', () => {
    const base = typeFile(ATTENDEES);
    const ours = typeFile(ATTENDEES, { extra: 'icon: calendar' });
    const theirs = typeFile(ATTENDEES, { extra: 'icon: phone' });
    expect(merge({ base, ours, theirs })).toBeNull();
  });

  it('is null when the new entries cannot go in as lines: an inline map', () => {
    const inline = (keys: string) =>
      `---\nname: meeting\nproperties: { ${keys} }\n---\n\nMeetings.\n`;
    expect(
      merge({
        base: inline('date: { kind: date }'),
        ours: inline('date: { kind: date }, tasks: { kind: text }'),
        theirs: inline('date: { kind: date }, mood: { kind: text }'),
      }),
    ).toBeNull();
  });

  it('is null for a file whose frontmatter cannot be read, or that has none', () => {
    const base = typeFile(ATTENDEES);
    expect(merge({ base, ours: '---\nname: [\n---\n', theirs: base })).toBeNull();
    expect(merge({ base, ours: 'No frontmatter.\n', theirs: base })).toBeNull();
  });

  it('is null for a file outside `.atlas`: a note is the person’s, kept whole with a copy', () => {
    const base = typeFile(ATTENDEES);
    const ours = typeFile([...ATTENDEES, ...TASKS]);
    expect(merge({ base, ours, theirs: base }, 'Notes/meeting.md')).toBeNull();
  });

  it('merges the record of shipped properties as the union, and refuses one Atlas did not write', () => {
    const recordText = (keys: string[]) =>
      `---\natlas: migration\n---\n\n\`\`\`json\n${JSON.stringify({ settled: { meeting: keys } })}\n\`\`\`\n`;
    const path = '.atlas/migrations/type-properties.md';
    const merged = merge(
      { base: null, ours: recordText(['tasks']), theirs: recordText(['decisions']) },
      path,
    );
    expect(merged).toContain('"meeting":["decisions","tasks"]');
    expect(merge({ base: null, ours: 'mine\n', theirs: recordText([]) }, path)).toBeNull();
  });
});
