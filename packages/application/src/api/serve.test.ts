/**
 * Serving the API: every request that arrives is answered, and the app is told
 * after a write lands — never after a read, and never for a write that was
 * refused.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from './contract.ts';
import type { ApiBridgePort, OpenNotes } from './ports.ts';
import { serveApi } from './serve.ts';
import { apiFixture, encoded } from '../testing/api-fixture.ts';
import { fakeOpenNotes } from '../testing/fake-ports.ts';

const NOTE = '---\nstatus: todo\n---\n\n# Call Sam\n';

/** A bridge a test drives by hand: it sends a request and reads the answer. */
function handBridge() {
  let answer: ((request: ApiRequest) => Promise<ApiResponse>) | null = null;
  const stop = vi.fn();
  const bridge: ApiBridgePort = {
    serve: async (handler) => {
      answer = handler;
      return stop;
    },
  };
  const send = (request: Partial<ApiRequest> & Pick<ApiRequest, 'method' | 'path'>) => {
    if (answer === null) throw new Error('nothing is serving');
    return answer({ id: 'r1', query: {}, body: null, ...request });
  };
  return { bridge, send, stop };
}

async function serving(openNotes: Partial<OpenNotes> = {}) {
  const api = apiFixture({ files: { 'Call.md': NOTE } });
  const { bridge, send, stop } = handBridge();
  const onWrote = vi.fn();
  const stopServing = await serveApi({
    bridge,
    deps: { ...api.deps, openNotes: fakeOpenNotes(openNotes) },
    onWrote,
  });
  return { api, send, stop, stopServing, onWrote };
}

describe('serving the local API', () => {
  it('answers a request that arrives through the bridge', async () => {
    const { send } = await serving();

    const response = await send({ method: 'GET', path: '/v1/status' });

    expect(response).toMatchObject({ id: 'r1', status: 200, body: { app: 'atlas' } });
  });

  it('hands back what stops it', async () => {
    const { stop, stopServing } = await serving();

    stopServing();

    expect(stop).toHaveBeenCalledOnce();
  });

  it('tells the app once a note it created has landed', async () => {
    const { api, send, onWrote } = await serving();

    const response = await send({ method: 'POST', path: '/v1/notes', body: { name: 'Fresh' } });

    expect(response.status).toBe(201);
    expect(api.files.has('Fresh.md')).toBe(true);
    expect(onWrote).toHaveBeenCalledOnce();
  });

  it('tells the app after a write to a note no pane holds', async () => {
    const { send, onWrote } = await serving();

    await send({
      method: 'PATCH',
      path: `/v1/notes/${encoded('Call.md')}/properties`,
      body: { set: { status: 'done' } },
    });

    expect(onWrote).toHaveBeenCalledOnce();
  });

  it('tells the app after properties are saved through the pane that holds the note', async () => {
    const setPropertiesIfOpen = vi.fn(async () => true);
    const { api, send, onWrote } = await serving({ state: () => 'clean', setPropertiesIfOpen });

    const response = await send({
      method: 'PATCH',
      path: `/v1/notes/${encoded('Call.md')}/properties`,
      body: { set: { status: 'done' } },
    });

    expect(response.status).toBe(200);
    expect(setPropertiesIfOpen).toHaveBeenCalledOnce();
    expect(api.writes).toEqual([]);
    expect(onWrote).toHaveBeenCalledOnce();
  });

  it('says nothing after a read', async () => {
    const { send, onWrote } = await serving();

    const response = await send({ method: 'GET', path: `/v1/notes/${encoded('Call.md')}` });

    expect(response.status).toBe(200);
    expect(onWrote).not.toHaveBeenCalled();
  });

  it('says nothing after listing and searching the vault', async () => {
    const { send, onWrote } = await serving();

    const listed = await send({ method: 'GET', path: '/v1/notes' });
    const types = await send({ method: 'GET', path: '/v1/types' });

    expect(listed.body).toMatchObject({ notes: [{ path: 'Call.md' }] });
    expect(types.status).toBe(200);
    expect(onWrote).not.toHaveBeenCalled();
  });

  it('says nothing when the pane refuses the write', async () => {
    const { send, onWrote } = await serving({
      state: () => 'clean',
      setPropertiesIfOpen: async () => {
        throw new Error('the note changed on disk since it was opened');
      },
    });

    const response = await send({
      method: 'PATCH',
      path: `/v1/notes/${encoded('Call.md')}/properties`,
      body: { set: { status: 'done' } },
    });

    expect(response.status).toBe(500);
    expect(onWrote).not.toHaveBeenCalled();
  });

  it('says nothing when a create is refused', async () => {
    const { send, onWrote } = await serving();

    const response = await send({ method: 'POST', path: '/v1/notes', body: { name: 'Call' } });

    expect(response.status).toBe(409);
    expect(onWrote).not.toHaveBeenCalled();
  });

  it('passes reads and pane state through untouched', async () => {
    const reload = vi.fn();
    const { send } = await serving({ state: () => 'clean', reload });

    await send({
      method: 'POST',
      path: `/v1/notes/${encoded('Call.md')}/append`,
      body: { markdown: 'More.' },
    });

    expect(reload).toHaveBeenCalledWith('Call.md');
  });
});
