import { describe, expect, it } from 'vitest';
import { graphTypeTones, nodeRadius } from './graph-style.ts';

describe('nodeRadius', () => {
  it('draws an unconnected note smallest', () => {
    expect(nodeRadius(0)).toBe(5);
    expect(nodeRadius(-3)).toBe(5);
  });

  it('grows with connections, more slowly the more there are', () => {
    expect(nodeRadius(1)).toBe(7);
    expect(nodeRadius(4)).toBe(9);
    expect(nodeRadius(9) - nodeRadius(4)).toBeLessThan(nodeRadius(4) - nodeRadius(0));
  });

  it('never grows past its ceiling', () => {
    expect(nodeRadius(10_000)).toBe(18);
  });
});

describe('graphTypeTones', () => {
  it('gives types tones by alphabetical order, whatever order they arrive in', () => {
    const tones = graphTypeTones(['task', 'person', 'project']);
    expect([...tones]).toEqual([
      ['person', 'next'],
      ['project', 'doing'],
      ['task', 'review'],
    ]);
  });

  it('gives no tone to "no type", and repeats the ramp past five types', () => {
    const tones = graphTypeTones(['', 'a', 'b', 'c', 'd', 'e', 'f', 'a']);
    expect(tones.has('')).toBe(false);
    expect(tones.get('e')).toBe('backlog');
    expect(tones.get('f')).toBe('next');
    expect(tones.size).toBe(6);
  });
});
