import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

type Handler = (event: { payload: unknown }) => void;
let deliver: Handler | null = null;
const unlisten = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_event: string, handler: Handler) => {
    deliver = handler;
    return unlisten;
  },
}));

const { tauriModelProcess, MODEL_PROCESS_EVENT } = await import('./tauri-model-process.ts');
const { tauriModelHttp } = await import('./tauri-model-http.ts');
const { ProgramNotFound } = await import('./model-process.ts');

const emit = (payload: unknown) => deliver?.({ payload });
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('tauriModelProcess', () => {
  beforeEach(() => {
    invoke.mockReset();
    unlisten.mockReset();
    deliver = null;
  });

  it('starts claude with its run id, hands on its lines, and settles on its exit', async () => {
    invoke.mockResolvedValue(null);
    const lines: string[] = [];
    const running = tauriModelProcess(() => 'run-1').run({
      args: ['auth', 'status'],
      stdin: 'in',
      onLine: (line) => lines.push(line),
      signal: new AbortController().signal,
    });
    await tick();
    expect(MODEL_PROCESS_EVENT).toBe('model-process');
    expect(invoke).toHaveBeenCalledWith('model_process_start', {
      run: 'run-1',
      args: ['auth', 'status'],
      stdin: 'in',
    });
    emit({ run: 'other-run', kind: 'line', text: 'not mine' });
    emit({ run: 'run-1', kind: 'line', text: '{"loggedIn":true}' });
    emit({ run: 'run-1', kind: 'exit', code: 0, stderr: '' });
    expect(await running).toEqual({ code: 0, stderr: '' });
    expect(lines).toEqual(['{"loggedIn":true}']);
    expect(unlisten).toHaveBeenCalled();
  });

  it('cancels the run when Stop is pressed', async () => {
    invoke.mockResolvedValue(null);
    const stop = new AbortController();
    const running = tauriModelProcess(() => 'run-2').run({
      args: ['-p'],
      stdin: '',
      onLine: () => {},
      signal: stop.signal,
    });
    await tick();
    stop.abort();
    await tick();
    expect(invoke).toHaveBeenCalledWith('model_process_cancel', { run: 'run-2' });
    emit({ run: 'run-2', kind: 'exit', code: null, stderr: '' });
    expect(await running).toEqual({ code: null, stderr: '' });
  });

  it('turns the host finding no claude into ProgramNotFound, and other refusals into errors', async () => {
    invoke.mockRejectedValueOnce('not_found: no claude in ~/.local/bin');
    const run = () =>
      tauriModelProcess(() => 'r').run({
        args: [],
        stdin: '',
        onLine: () => {},
        signal: new AbortController().signal,
      });
    await expect(run()).rejects.toBeInstanceOf(ProgramNotFound);
    invoke.mockRejectedValueOnce('the arguments are not ones Atlas runs claude with');
    await expect(run()).rejects.toThrow('not ones Atlas runs');
    expect(unlisten).toHaveBeenCalledTimes(2);
  });
});

describe('tauriModelHttp', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('sends the request with its secret named, never filled', async () => {
    invoke.mockResolvedValue({ status: 200, body: '{}' });
    const headers = [{ name: 'x-api-key', value: [{ secret: 'anthropic' }] }];
    const answer = await tauriModelHttp.post({
      vault: '/v',
      url: 'https://api.anthropic.com/v1/messages',
      headers,
      body: '{}',
    });
    expect(answer).toEqual({ status: 200, body: '{}' });
    expect(invoke).toHaveBeenCalledWith('model_http_post', {
      vault: '/v',
      request: { url: [{ text: 'https://api.anthropic.com/v1/messages' }], headers },
      body: '{}',
    });
  });

  it('turns a refusal into an Error', async () => {
    invoke.mockRejectedValue('the secret "anthropic" may not be sent to that site');
    await expect(
      tauriModelHttp.post({ vault: '/v', url: 'https://x', headers: [], body: '' }),
    ).rejects.toThrow('may not be sent');
  });
});
