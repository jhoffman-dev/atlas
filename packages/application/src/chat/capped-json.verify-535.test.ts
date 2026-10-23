import { describe, expect, it } from 'vitest';
import { cappedJson } from './capped-json.ts';

/** Verification attacks on #535's chat capping (head 89fc092e). */

const cite = (at: number) => ({
  link: `[[Task ${at}]]`,
  kind: 'note',
  path: `Tasks/Task ${at}.md`,
});
const task = (at: number) => ({
  path: `Tasks/Task ${at}.md`,
  title: 'x'.repeat(80),
  cite: cite(at),
});
const tasks = (count: number) => Array.from({ length: count }, (_, at) => task(at));

describe('cappedJson, verified', () => {
  it('sets the brief’s truncated when it cuts a list one object further down, in lastMeeting', () => {
    const body = {
      brief: {
        openTasks: tasks(2),
        lastMeeting: { meeting: task(999), tasks: tasks(100), decisions: [] },
        truncated: false,
      },
    };
    const text = cappedJson(body, 3_000);
    const parsed = JSON.parse(text) as {
      brief: { truncated: boolean; lastMeeting: { tasks: unknown[] } };
      cut: { list: string };
    };
    expect(parsed.cut.list).toBe('brief.lastMeeting.tasks');
    expect(parsed.brief.lastMeeting.tasks.length).toBeLessThan(100);
    // A list of the brief was cut, and the brief says it is whole.
    expect(parsed.brief.truncated).toBe(true);
  });
});
