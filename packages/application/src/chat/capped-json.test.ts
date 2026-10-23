import { describe, expect, it } from 'vitest';
import { cappedJson } from './capped-json.ts';

const item = (at: number) => ({ id: at, text: 'x'.repeat(100) });
const items = (count: number) => Array.from({ length: count }, (_, at) => item(at));

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

describe('cappedJson', () => {
  it('leaves an answer that fits exactly as it is', () => {
    const body = { views: items(2) };
    expect(cappedJson(body, 10_000)).toBe(JSON.stringify(body));
  });

  it('drops whole items from the end of the longest list, and says how many were kept', () => {
    const parsed = JSON.parse(cappedJson({ views: items(100), seen: 1 }, 2_000)) as {
      views: unknown[];
      cut: { list: string; shown: number; of: number };
    };
    expect(parsed.cut).toMatchObject({ list: 'views', of: 100, shown: parsed.views.length });
    expect(parsed.views.length).toBeGreaterThan(0);
  });

  it('cuts a list the answer wraps, and flags the object that holds it as truncated', () => {
    const body = { brief: { openTasks: items(100), followUps: [], truncated: false } };
    const text = cappedJson(body, 2_000);
    expect(text.length).toBeLessThanOrEqual(2_000);
    const parsed = JSON.parse(text) as {
      brief: { openTasks: unknown[]; truncated: boolean };
      cut: { list: string };
    };
    expect(parsed.brief.truncated).toBe(true);
    expect(parsed.cut.list).toBe('brief.openTasks');
    expect(parsed.brief.openTasks.length).toBeLessThan(100);
  });

  it('cuts the next longest list too when the longest alone, emptied, is still too long', () => {
    const body = {
      brief: { waitingFor: items(30), openTasks: items(40), followUps: [], truncated: false },
    };
    const text = cappedJson(body, 1_000);
    expect(text.length).toBeLessThanOrEqual(1_000);
    const parsed = JSON.parse(text) as {
      alsoCut?: { list: string }[];
      brief: { truncated: boolean };
    };
    expect(parsed.brief.truncated).toBe(true);
    expect(parsed.alsoCut?.map((cut) => cut.list)).toBeDefined();
  });

  it('falls back to the start of the text, in a JSON string, for an answer with no list', () => {
    const parsed = JSON.parse(cappedJson({ note: 'y'.repeat(5_000) }, 1_000)) as {
      start: string;
    };
    expect(parsed.start.length).toBeGreaterThan(0);
  });

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
