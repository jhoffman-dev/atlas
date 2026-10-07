import { describe, expect, it } from 'vitest';
import { ChatCancelled, type ModelEvent, type ModelRequest } from '@atlas/application';
import {
  ANTHROPIC_ORIGIN,
  anthropicApiProvider,
  messagesBody,
  type ModelHttpHost,
} from './anthropic-api-provider.ts';

const REQUEST: ModelRequest = {
  model: 'claude-opus-5-5',
  system: 'System.',
  messages: [
    { role: 'user', text: 'Find Sam' },
    {
      role: 'assistant',
      text: '',
      toolCalls: [{ id: 'tu_1', name: 'atlas_search', input: { q: 'Sam' } }],
    },
    {
      role: 'tool',
      results: [
        { callId: 'tu_1', name: 'atlas_search', content: '{"hits":[]}', isError: false },
        { callId: 'malformed-1', name: 'invalid_tool_call', content: 'x', isError: true },
      ],
    },
  ],
  tools: [{ name: 'atlas_search', description: 'Search.', inputSchema: { type: 'object' } }],
};

function fakeHttp(answer: { status: number; body: string } | Promise<never>) {
  const sent: Parameters<ModelHttpHost['post']>[0][] = [];
  const http: ModelHttpHost = {
    post: async (args) => {
      sent.push(args);
      return answer;
    },
  };
  return { http, sent };
}

const provider = (
  http: ModelHttpHost,
  origins: string[] = [ANTHROPIC_ORIGIN],
  vault: string | null = '/v',
) =>
  anthropicApiProvider({
    http,
    secrets: { list: async () => (origins.length === 0 ? [] : [{ name: 'anthropic', origins }]) },
    vault: () => vault,
  });

async function collect(stream: AsyncIterable<ModelEvent>) {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('messagesBody', () => {
  it("translates Atlas's conversation into the API's messages and tools", () => {
    expect(messagesBody(REQUEST)).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 8192,
      system: 'System.',
      messages: [
        { role: 'user', content: 'Find Sam' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'atlas_search', input: { q: 'Sam' } }],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: '{"hits":[]}', is_error: false },
          ],
        },
      ],
      tools: [{ name: 'atlas_search', description: 'Search.', input_schema: { type: 'object' } }],
    });
  });
});

describe('anthropicApiProvider', () => {
  it('names the key rather than holding it, and sends it only to the API', async () => {
    const { http, sent } = fakeHttp({
      status: 200,
      body: JSON.stringify({
        content: [
          { type: 'text', text: 'Searching.' },
          { type: 'tool_use', id: 'tu_2', name: 'atlas_read_note', input: { path: 'Sam.md' } },
        ],
      }),
    });
    const events = await collect(provider(http).stream(REQUEST, new AbortController().signal));
    expect(events).toEqual([
      { type: 'text', text: 'Searching.' },
      {
        type: 'tool_call',
        call: { id: 'tu_2', name: 'atlas_read_note', input: { path: 'Sam.md' } },
      },
    ]);
    expect(sent[0]).toMatchObject({ vault: '/v', url: 'https://api.anthropic.com/v1/messages' });
    expect(sent[0]?.headers[0]).toEqual({ name: 'x-api-key', value: [{ secret: 'anthropic' }] });
  });

  it('says the key was refused, and passes on any other failure', async () => {
    const refused = fakeHttp({ status: 401, body: '{"error":{"message":"invalid x-api-key"}}' });
    await expect(
      collect(provider(refused.http).stream(REQUEST, new AbortController().signal)),
    ).rejects.toMatchObject({
      problem: 'no_key',
      message: expect.stringContaining('invalid x-api-key'),
    });
    const overloaded = fakeHttp({ status: 529, body: 'nope' });
    await expect(
      collect(provider(overloaded.http).stream(REQUEST, new AbortController().signal)),
    ).rejects.toThrow('The Anthropic API could not answer: status 529');
    const garbled = fakeHttp({ status: 200, body: '{"content":7}' });
    await expect(
      collect(provider(garbled.http).stream(REQUEST, new AbortController().signal)),
    ).rejects.toThrow(/unreadable/);
  });

  it('reports a host refusal, such as a key not bound to the site', async () => {
    const http: ModelHttpHost = { post: async () => Promise.reject(new Error('not bound')) };
    await expect(
      collect(provider(http).stream(REQUEST, new AbortController().signal)),
    ).rejects.toThrow('could not be reached: not bound');
  });

  it('stops at once when Stop is pressed, dropping the answer when it comes', async () => {
    const http: ModelHttpHost = { post: () => new Promise(() => {}) };
    const stop = new AbortController();
    const reading = collect(provider(http).stream(REQUEST, stop.signal));
    stop.abort();
    await expect(reading).rejects.toBeInstanceOf(ChatCancelled);
    const already = new AbortController();
    already.abort();
    await expect(collect(provider(http).stream(REQUEST, already.signal))).rejects.toBeInstanceOf(
      ChatCancelled,
    );
  });

  it('is ready only with a key bound to api.anthropic.com in an open vault', async () => {
    const { http } = fakeHttp({ status: 200, body: '{}' });
    expect(await provider(http).status()).toEqual({ ready: true });
    expect(await provider(http, []).status()).toMatchObject({
      problem: 'no_key',
      fix: expect.stringContaining('Secrets'),
    });
    expect(await provider(http, ['https://evil.example']).status()).toMatchObject({
      problem: 'no_key',
      message: expect.stringContaining('not bound'),
    });
    expect(await provider(http, [ANTHROPIC_ORIGIN], null).status()).toMatchObject({
      problem: 'unavailable',
    });
    await expect(
      collect(
        provider(http, [ANTHROPIC_ORIGIN], null).stream(REQUEST, new AbortController().signal),
      ),
    ).rejects.toThrow('Open a vault first.');
  });
});
