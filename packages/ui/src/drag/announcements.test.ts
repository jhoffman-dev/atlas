import { describe, expect, it } from 'vitest';
import {
  boardWords,
  calendarWords,
  dashboardWords,
  spokenDate,
  timelineWords,
} from './announcements.ts';

describe('spokenDate', () => {
  it('says a date the way a person would', () => {
    expect(spokenDate('2026-09-23')).toBe('Wednesday 23 September 2026');
    expect(spokenDate('2026-03-01')).toBe('Sunday 1 March 2026');
  });

  it('repeats what was written when it is not a real date', () => {
    expect(spokenDate('2026-02-31')).toBe('2026-02-31');
    expect(spokenDate('someday')).toBe('someday');
  });
});

describe('boardWords', () => {
  it('names the card and its column on pick-up', () => {
    expect(boardWords.start('First', 'backlog')).toBe('Picked up First, in backlog.');
  });

  it('names the column the card is over, or says it is over none', () => {
    expect(boardWords.over('First', 'done')).toBe('First is over done.');
    expect(boardWords.over('First', null)).toBe('First is not over a column.');
  });

  it('tells a move from a drop back where it came from', () => {
    expect(boardWords.end('First', 'backlog', 'done')).toBe('First moved to done.');
    expect(boardWords.end('First', 'backlog', 'backlog')).toBe(
      'First was dropped back in backlog.',
    );
    expect(boardWords.end('First', 'backlog', null)).toBe(
      'First was dropped outside the board, so it stays in backlog.',
    );
  });

  it('says where a cancelled card stays', () => {
    expect(boardWords.cancel('First', 'backlog')).toBe('Cancelled. First stays in backlog.');
  });
});

describe('calendarWords', () => {
  it('names the note and its day', () => {
    expect(calendarWords.start('Launch', '2026-09-23')).toBe(
      'Picked up Launch, on Wednesday 23 September 2026.',
    );
    expect(calendarWords.over('Launch', '2026-09-24')).toBe(
      'Launch is over Thursday 24 September 2026.',
    );
    expect(calendarWords.over('Launch', null)).toBe('Launch is not over a day.');
  });

  it('tells a move from a drop back on the same day', () => {
    expect(calendarWords.end('Launch', '2026-09-23', '2026-09-30')).toBe(
      'Launch moved to Wednesday 30 September 2026.',
    );
    expect(calendarWords.end('Launch', '2026-09-23', '2026-09-23')).toBe(
      'Launch was dropped back on Wednesday 23 September 2026.',
    );
    expect(calendarWords.end('Launch', '2026-09-23', null)).toBe(
      'Launch was dropped outside the calendar, so it stays on Wednesday 23 September 2026.',
    );
    expect(calendarWords.cancel('Launch', '2026-09-23')).toBe(
      'Cancelled. Launch stays on Wednesday 23 September 2026.',
    );
  });
});

describe('timelineWords', () => {
  it('names the bar and the dates it covers', () => {
    expect(timelineWords.start('Build', '2026-09-21', '2026-09-24')).toBe(
      'Picked up Build, from Monday 21 September 2026 to Thursday 24 September 2026.',
    );
  });

  it('says a milestone is on one day rather than from a day to itself', () => {
    expect(timelineWords.start('Ship', '2026-09-24', '2026-09-24')).toBe(
      'Picked up Ship, on Thursday 24 September 2026.',
    );
  });

  it('says how far and which way a bar would move, and where it would land', () => {
    expect(
      timelineWords.move({ title: 'Build', moved: 2, start: '2026-09-23', end: '2026-09-26' }),
    ).toBe(
      'Build would move 2 days later, from Wednesday 23 September 2026 to Saturday 26 September 2026.',
    );
    expect(
      timelineWords.move({ title: 'Build', moved: -1, start: '2026-09-20', end: '2026-09-23' }),
    ).toBe(
      'Build would move 1 day earlier, from Sunday 20 September 2026 to Wednesday 23 September 2026.',
    );
    expect(
      timelineWords.move({ title: 'Build', moved: 0, start: '2026-09-21', end: '2026-09-24' }),
    ).toBe('Build is back where it started.');
  });

  it('says where a dropped or cancelled bar is', () => {
    expect(
      timelineWords.end({ title: 'Build', moved: 1, start: '2026-09-22', end: '2026-09-25' }),
    ).toBe('Build moved 1 day later, from Tuesday 22 September 2026 to Friday 25 September 2026.');
    expect(
      timelineWords.end({ title: 'Build', moved: 0, start: '2026-09-21', end: '2026-09-24' }),
    ).toBe('Build was dropped where it started.');
    expect(timelineWords.cancel('Ship', '2026-09-24', '2026-09-24')).toBe(
      'Cancelled. Ship stays on Thursday 24 September 2026.',
    );
  });
});

describe('dashboardWords', () => {
  const tasks = { title: 'Tasks', position: 2, count: 5, span: 6 };

  it('says where the widget is and how wide', () => {
    expect(dashboardWords.start(tasks)).toBe('Picked up Tasks, 2 of 5, 6 columns wide.');
    expect(dashboardWords.move({ ...tasks, span: 1 })).toBe('Tasks is 2 of 5, 1 column wide.');
  });

  it('says whether the drop changed anything', () => {
    expect(dashboardWords.end(tasks, true)).toBe('Tasks dropped at 2 of 5, 6 columns wide.');
    expect(dashboardWords.end(tasks, false)).toBe('Tasks was dropped where it started.');
  });

  it('says where a cancelled widget stays', () => {
    expect(dashboardWords.cancel(tasks)).toBe('Cancelled. Tasks stays 2 of 5, 6 columns wide.');
  });
});
