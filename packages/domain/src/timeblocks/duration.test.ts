import { describe, expect, it } from 'vitest';
import { durationLabel, estimateMinutes } from './duration.ts';

/** P31-01: a task's estimate as written, read as minutes, and minutes as a schedule shows them. */
describe('estimateMinutes', () => {
  it('reads a number as minutes, rounded to the whole minute', () => {
    expect(estimateMinutes(45)).toBe(45);
    expect(estimateMinutes(0)).toBe(0);
    expect(estimateMinutes(12.6)).toBe(13);
    expect(estimateMinutes('90')).toBe(90);
    expect(estimateMinutes(' 30 ')).toBe(30);
  });

  it('reads hours and minutes as a vault with its own text estimate writes them', () => {
    expect(estimateMinutes('2h')).toBe(120);
    expect(estimateMinutes('30m')).toBe(30);
    expect(estimateMinutes('1h30m')).toBe(90);
    expect(estimateMinutes('1h 15m')).toBe(75);
    expect(estimateMinutes('1.5h')).toBe(90);
    expect(estimateMinutes('45 min')).toBe(45);
    expect(estimateMinutes('2 hours')).toBe(120);
    expect(estimateMinutes('1 hr 20 mins')).toBe(80);
    expect(estimateMinutes('3H')).toBe(180);
  });

  it('says nothing for a day or a week, whose minutes of work are the person’s to say', () => {
    expect(estimateMinutes('1d')).toBeNull();
    expect(estimateMinutes('0.5d')).toBeNull();
    expect(estimateMinutes('1w')).toBeNull();
  });

  it('says nothing for what is no estimate', () => {
    for (const value of [null, undefined, '', '  ', 'soon', 'h', 'm', '2h30', -5, '-5', '-1h']) {
      expect(estimateMinutes(value), String(value)).toBeNull();
    }
    expect(estimateMinutes(Number.NaN)).toBeNull();
    expect(estimateMinutes(Number.POSITIVE_INFINITY)).toBeNull();
    expect(estimateMinutes([60])).toBeNull();
    expect(estimateMinutes(true)).toBeNull();
  });
});

describe('durationLabel', () => {
  it('writes hours and minutes, leaving out a part that is nothing', () => {
    expect(durationLabel(0)).toBe('0m');
    expect(durationLabel(20)).toBe('20m');
    expect(durationLabel(60)).toBe('1h');
    expect(durationLabel(90)).toBe('1h 30m');
    expect(durationLabel(605)).toBe('10h 5m');
  });

  it('writes whole minutes, never fewer than none', () => {
    expect(durationLabel(19.6)).toBe('20m');
    expect(durationLabel(-15)).toBe('0m');
  });
});
