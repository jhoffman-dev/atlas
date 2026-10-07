import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_REQUEST_EVENT,
  API_RESPOND_COMMAND,
  type ApiRequest,
  type ApiResponse,
} from '@atlas/application';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

/** The one handler `listen` was given, so a test can deliver an event to it. */
let deliver: ((event: { payload: ApiRequest }) => void) | null = null;
const unlisten = vi.fn();
const listen = vi.fn(async (_event: string, handler: (event: { payload: ApiRequest }) => void) => {
  deliver = handler;
  return unlisten;
});
vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (event: { payload: ApiRequest }) => void) =>
    listen(event, handler),
}));

const { tauriApiBridge } = await import('./tauri-api-bridge.ts');
const { tauriApiSettings } = await import('./tauri-api-settings.ts');

const REQUEST: ApiRequest = { id: 'r7', method: 'GET', path: '/v1/status', query: {}, body: null };
const ANSWER: ApiResponse = {
  id: 'r7',
  status: 200,
  body: { app: 'atlas', version: '1', vault: null, index: { ready: false, notes: 0 } },
};

/** Lets the promise chain started by a delivered event run to its end. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('tauriApiBridge', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(null);
    listen.mockClear();
    unlisten.mockReset();
    deliver = null;
  });

  it('listens for requests on the event the host emits them on', async () => {
    await tauriApiBridge.serve(async () => ANSWER);
    expect(listen).toHaveBeenCalledWith(API_REQUEST_EVENT, expect.any(Function));
  });

  it('hands each request to the handler and sends back its answer', async () => {
    const answer = vi.fn(async () => ANSWER);
    await tauriApiBridge.serve(answer);

    deliver?.({ payload: REQUEST });
    await settle();

    expect(answer).toHaveBeenCalledWith(REQUEST);
    expect(invoke).toHaveBeenCalledWith(API_RESPOND_COMMAND, {
      id: 'r7',
      status: 200,
      body: ANSWER.body,
    });
  });

  it('stops listening when the function it handed back is called', async () => {
    const stop = await tauriApiBridge.serve(async () => ANSWER);
    stop();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('tells the host the router is ready only once it is listening', async () => {
    const order: string[] = [];
    listen.mockImplementationOnce(async (_event, handler) => {
      order.push('listen');
      deliver = handler;
      return unlisten;
    });
    invoke.mockImplementation(async (command: string) => {
      order.push(command);
      return null;
    });

    await tauriApiBridge.serve(async () => ANSWER);

    expect(order).toEqual(['listen', 'api_router_ready']);
    expect(invoke).toHaveBeenCalledWith('api_router_ready', { ready: true });
  });

  it('tells the host the router is gone when it stops', async () => {
    const stop = await tauriApiBridge.serve(async () => ANSWER);
    invoke.mockClear();

    stop();

    expect(invoke).toHaveBeenCalledWith('api_router_ready', { ready: false });
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('stops listening and fails when the host cannot be told it is ready', async () => {
    invoke.mockRejectedValueOnce('the API is not ready yet');

    await expect(tauriApiBridge.serve(async () => ANSWER)).rejects.toBe('the API is not ready yet');

    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('keeps serving when an answer cannot be sent back', async () => {
    const answer = vi.fn(async (request: ApiRequest) => ({ ...ANSWER, id: request.id }));
    await tauriApiBridge.serve(answer);
    invoke.mockRejectedValueOnce('no one is waiting on r7');

    deliver?.({ payload: REQUEST });
    await settle();
    deliver?.({ payload: { ...REQUEST, id: 'r8' } });
    await settle();

    expect(invoke).toHaveBeenLastCalledWith(API_RESPOND_COMMAND, {
      id: 'r8',
      status: 200,
      body: ANSWER.body,
    });
  });

  it('sends nothing back for a request whose handler failed', async () => {
    await tauriApiBridge.serve(async () => {
      throw new Error('boom');
    });

    invoke.mockClear();
    deliver?.({ payload: REQUEST });
    await settle();

    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('tauriApiSettings', () => {
  const STATUS = { enabled: true, port: 7420, running: true, file: '/tmp/api.json' };

  beforeEach(() => {
    invoke.mockReset();
  });

  it('reads the status', async () => {
    invoke.mockResolvedValue(STATUS);
    await expect(tauriApiSettings.status()).resolves.toEqual(STATUS);
    expect(invoke).toHaveBeenCalledWith('api_status');
  });

  it('switches the API and answers with the status after', async () => {
    invoke.mockResolvedValue(STATUS);
    await expect(tauriApiSettings.setEnabled(true)).resolves.toEqual(STATUS);
    expect(invoke).toHaveBeenCalledWith('api_set_enabled', { enabled: true });
  });

  it('reads the token', async () => {
    invoke.mockResolvedValue('secret');
    await expect(tauriApiSettings.token()).resolves.toBe('secret');
    expect(invoke).toHaveBeenCalledWith('api_token');
  });

  it('rotates the token and answers with the new one', async () => {
    invoke.mockResolvedValue('fresh');
    await expect(tauriApiSettings.rotateToken()).resolves.toBe('fresh');
    expect(invoke).toHaveBeenCalledWith('api_rotate_token');
  });

  it('turns the host refusing to start into an Error with its words', async () => {
    invoke.mockRejectedValue('cannot listen on 127.0.0.1: address in use');
    const failure = tauriApiSettings.setEnabled(true);
    await expect(failure).rejects.toThrow('cannot listen on 127.0.0.1: address in use');
    await expect(failure).rejects.toBeInstanceOf(Error);
  });
});
