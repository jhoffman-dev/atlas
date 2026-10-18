import { describe, expect, it } from 'vitest';
import { isKnownStatus, statusTone } from './status-tone.ts';

describe('isKnownStatus', () => {
  it('knows the seven tones, their aliases and the GTD statuses, however they are cased', () => {
    for (const value of [
      'inbox',
      'backlog',
      'next',
      'doing',
      'waiting',
      'review',
      'done',
      'todo',
      'Todo',
      'in progress',
      'In progress',
      'complete',
      'Complete',
      'next-action',
      'in-progress',
      'someday',
      'longterm',
      'archive',
      '  Done  ',
    ]) {
      expect(isKnownStatus(value), value).toBe(true);
    }
  });

  it('does not know a custom option, the gathered "Other", or no value', () => {
    for (const value of ['blocked', 'cancelled', 'Other', '', '   ', 'done-ish']) {
      expect(isKnownStatus(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('agrees with statusTone: a known value has the tone it is drawn in, an unknown one only the fallback', () => {
    expect(statusTone('in-progress')).toBe('doing');
    expect(statusTone('Complete')).toBe('done');
    expect(statusTone('blocked')).toBe('backlog');
    expect(isKnownStatus('blocked')).toBe(false);
  });

  it('reads the ramp only, not the prototype: "constructor" is no status', () => {
    expect(isKnownStatus('constructor')).toBe(false);
    expect(isKnownStatus('toString')).toBe(false);
  });
});
