import { preloadAll } from './pages-on-first-use.ts';

describe('preloadAll', () => {
  afterEach(() => vi.restoreAllMocks());

  it('runs every preload, and warns of each that fails without stopping the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ran: string[] = [];
    const fine = (name: string) => () => {
      ran.push(name);
      return Promise.resolve();
    };
    const broken = new Error('chunk missing');
    await expect(
      preloadAll([fine('graph'), () => Promise.reject(broken), fine('terms')]),
    ).resolves.toBeUndefined();
    expect(ran).toEqual(['graph', 'terms']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('A part of Atlas could not preload:', broken);
  });

  it('warns of nothing when every preload succeeds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await preloadAll([() => Promise.resolve()]);
    expect(warn).not.toHaveBeenCalled();
  });
});
