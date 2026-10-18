// @vitest-environment jsdom
import { Profiler, Suspense, useState, type ComponentType, type ElementType } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onFirstUse, type FailedPartProps } from './on-first-use.ts';

function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}</p>;
}

/** Says what failed, with the props it was given, and the button to try again. */
function Failed({ props, retrying, onRetry }: FailedPartProps<{ name: string }>) {
  return (
    <button type="button" disabled={retrying} onClick={onRetry}>
      Reload the greeting for {props.name}
    </button>
  );
}

const part = (load: () => Promise<ComponentType<{ name: string }>>) => onFirstUse(load, Failed);

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

/** The part beside an editor that must outlive it, as a page sits beside the sidebar. */
function renderBesideEditor(Component: ElementType<{ name: string }>) {
  return render(
    <>
      <textarea aria-label="Editor" defaultValue="unsaved words" />
      <Suspense fallback={<p>Loading</p>}>
        <Component name="Mara" />
      </Suspense>
    </>,
  );
}

const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

describe('onFirstUse', () => {
  afterEach(() => vi.restoreAllMocks());

  it('loads nothing until it is wanted', () => {
    const load = vi.fn(() => Promise.resolve(Greeting));
    part(load);
    expect(load).not.toHaveBeenCalled();
  });

  it('shows the fallback while its chunk loads, then the component', async () => {
    const shown = await commitsOnOpen(part(() => Promise.resolve(Greeting)).Component);
    expect(shown[0]).toBe('OpenLoading');
    expect(shown.at(-1)).toBe('OpenHello, Mara');
  });

  it('draws a preloaded component in one commit, with no fallback', async () => {
    const load = vi.fn(() => Promise.resolve(Greeting));
    const greeting = part(load);
    await greeting.preload();
    expect(await commitsOnOpen(greeting.Component)).toEqual(['OpenHello, Mara']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads once however often it is preloaded', async () => {
    const load = vi.fn(() => Promise.resolve(Greeting));
    const greeting = part(load);
    await Promise.all([greeting.preload(), greeting.preload()]);
    await greeting.preload();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('draws a chunk that cannot be loaded as failed, warns, and leaves the rest mounted', async () => {
    const warn = quiet();
    const greeting = part(() => Promise.reject(new Error('chunk missing')));
    renderBesideEditor(greeting.Component);
    expect(
      await screen.findByRole('button', { name: 'Reload the greeting for Mara' }),
    ).toBeDefined();
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Editor' }).value).toBe(
      'unsaved words',
    );
    expect(warn).toHaveBeenCalledWith('A part of Atlas could not load:', expect.any(Error));
  });

  it('readies the failed state on preload, so a broken chunk never throws', async () => {
    quiet();
    const greeting = part(() => Promise.reject(new Error('chunk missing')));
    await expect(greeting.preload()).resolves.toBeUndefined();
    expect(await commitsOnOpen(greeting.Component)).toEqual(['OpenReload the greeting for Mara']);
  });

  it('imports the chunk again on Reload, and draws the part once it arrives', async () => {
    quiet();
    const load = vi
      .fn<() => Promise<ComponentType<{ name: string }>>>()
      .mockRejectedValueOnce(new Error('504 Outdated Optimize Dep'))
      .mockResolvedValue(Greeting);
    renderBesideEditor(part(load).Component);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Reload the greeting for Mara' }),
    );
    expect(await screen.findByText('Hello, Mara')).toBeDefined();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('stays failed, and can try again, when the import fails again', async () => {
    const warn = quiet();
    const load = vi.fn(() => Promise.reject(new Error('still missing')));
    renderBesideEditor(part(load).Component);
    const reload = await screen.findByRole('button', { name: 'Reload the greeting for Mara' });
    await userEvent.click(reload);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    expect(reload.hasAttribute('disabled')).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('draws a recovered part straight away wherever it is drawn next', async () => {
    quiet();
    const load = vi
      .fn<() => Promise<ComponentType<{ name: string }>>>()
      .mockRejectedValueOnce(new Error('chunk missing'))
      .mockResolvedValue(Greeting);
    const greeting = part(load);
    const first = renderBesideEditor(greeting.Component);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Reload the greeting for Mara' }),
    );
    await screen.findByText('Hello, Mara');
    first.unmount();
    renderBesideEditor(greeting.Component);
    expect(await screen.findByText('Hello, Mara')).toBeDefined();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('catches a module that throws as it is evaluated', async () => {
    const warn = quiet();
    const broken = part(() =>
      import('./throws-when-evaluated.fixture.ts').then((m) => m.Broken as never),
    );
    renderBesideEditor(broken.Component);
    expect(
      await screen.findByRole('button', { name: 'Reload the greeting for Mara' }),
    ).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Editor' })).toBeDefined();
    expect(warn).toHaveBeenCalledWith(
      'A part of Atlas could not load:',
      expect.objectContaining({ message: 'broken while evaluating' }),
    );
  });
});
