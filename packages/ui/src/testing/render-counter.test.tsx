// @vitest-environment jsdom
/**
 * The render counter the perf budgets read (`tools/perf/budgets.spec.ts`):
 * it counts React's commits as well as its renders, and only while on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { startCountingRenders, stopCountingRenders } from './render-counter.ts';

// Before React loads, so every commit is handed to the counter.
await vi.hoisted(async () => {
  const { installRenderCounter } = await import('./render-counter.ts');
  installRenderCounter();
});

function Clicker() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((was) => was + 1)}>{count}</button>;
}

const bump = () => fireEvent.click(screen.getByRole('button'));

afterEach(cleanup);

describe('the render counter', () => {
  it('counts each commit React makes while it is on', () => {
    render(<Clicker />);
    startCountingRenders();
    bump();
    bump();
    const counts = stopCountingRenders();
    expect(counts.commits).toBe(2);
    expect(counts.renders.Clicker).toBe(2);
  });

  it('counts nothing once it is off', () => {
    render(<Clicker />);
    startCountingRenders();
    stopCountingRenders();
    bump();
    startCountingRenders();
    expect(stopCountingRenders()).toEqual({ commits: 0, renders: {}, changedProps: {} });
  });

  it('remembers when React last committed, counting or not', () => {
    render(<Clicker />);
    // A fixed clock, so the commit is found at the moment it was stamped, not merely after another.
    const now = vi.spyOn(performance, 'now').mockReturnValue(4_200);
    try {
      bump();
    } finally {
      now.mockRestore();
    }
    const counter = (globalThis as { __renderCounter?: { lastCommitAt: number | null } })
      .__renderCounter;
    expect(counter?.lastCommitAt).toBe(4_200);
  });
});
