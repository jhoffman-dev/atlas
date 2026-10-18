// @vitest-environment jsdom
import { Profiler, Suspense, useState, type ElementType } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { onFirstUse } from './on-first-use.ts';

function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}</p>;
}

/** What the page showed at each commit, after a click opens the component. */
async function commitsOnOpen(Component: ElementType<{ name: string }>) {
  const shown: string[] = [];
  function Host() {
    const [open, setOpen] = useState(false);
    return (
      <Profiler id="host" onRender={() => shown.push(document.body.textContent ?? '')}>
        <button onClick={() => setOpen(true)}>Open</button>
        <Suspense fallback={<p>Loading</p>}>{open && <Component name="Mara" />}</Suspense>
      </Profiler>
    );
  }
  render(<Host />);
  shown.length = 0;
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  });
  return shown;
}

describe('onFirstUse', () => {
  it('loads nothing until it is wanted', () => {
    const load = vi.fn(() => Promise.resolve(Greeting));
    onFirstUse(load);
    expect(load).not.toHaveBeenCalled();
  });

  it('shows the fallback while its chunk loads, then the component', async () => {
    const page = onFirstUse(() => Promise.resolve(Greeting));
    const shown = await commitsOnOpen(page.Component);
    expect(shown[0]).toBe('OpenLoading');
    expect(shown.at(-1)).toBe('OpenHello, Mara');
  });

  it('draws a preloaded component in one commit, with no fallback', async () => {
    const load = vi.fn(() => Promise.resolve(Greeting));
    const page = onFirstUse(load);
    await page.preload();
    expect(await commitsOnOpen(page.Component)).toEqual(['OpenHello, Mara']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads once however often it is preloaded', async () => {
    const load = vi.fn(() => Promise.resolve(Greeting));
    const page = onFirstUse(load);
    await Promise.all([page.preload(), page.preload()]);
    await page.preload();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('rejects a preload whose chunk cannot be loaded, and again when asked again', async () => {
    const page = onFirstUse<{ name: string }>(() => Promise.reject(new Error('chunk missing')));
    await expect(page.preload()).rejects.toThrow('chunk missing');
    await expect(page.preload()).rejects.toThrow('chunk missing');
  });
});
