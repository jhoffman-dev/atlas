import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { chatWindowOf } from './chat-window.ts';
import { chatStamp } from './use-chat.ts';

const note = createVaultPath('Plan.md');

describe('chatWindowOf', () => {
  it('is the query being written while the query page is open', () => {
    expect(chatWindowOf({ query: 'FROM task', otherPage: false, focused: note })).toEqual({
      kind: 'query',
      text: 'FROM task',
    });
  });

  it('is the focused pane, unless another page covers it', () => {
    expect(chatWindowOf({ query: null, otherPage: false, focused: note })).toEqual({
      kind: 'path',
      path: 'Plan.md',
    });
    expect(chatWindowOf({ query: null, otherPage: true, focused: note })).toEqual({ kind: 'none' });
    expect(chatWindowOf({ query: null, otherPage: false, focused: null })).toEqual({
      kind: 'none',
    });
  });
});

describe('chatStamp', () => {
  it('writes the time in the person’s own zone, to the minute', () => {
    const at = new Date(2026, 8, 7, 9, 5, 59).getTime();
    expect(chatStamp(at)).toBe('2026-09-07 09:05');
  });
});
