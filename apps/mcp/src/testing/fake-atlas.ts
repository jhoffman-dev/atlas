/**
 * A stand-in for the running app: a real HTTP server on 127.0.0.1, port 0,
 * that records every request and answers with whatever the test scripted.
 * Test support only.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  readonly method: string;
  /** Exactly as sent, still percent-encoded: `/v1/notes/Tasks%2FCall%20Sam.md`. */
  readonly url: string;
  readonly authorization: string | undefined;
  readonly contentType: string | undefined;
  /** Parsed JSON, or null when the request had no body. */
  readonly body: unknown;
}

export interface ScriptedAnswer {
  readonly status: number;
  /** Serialised as JSON unless it is already a string. `undefined` never answers at all. */
  readonly body?: unknown;
}

export type Responder = (request: RecordedRequest) => ScriptedAnswer;

export interface FakeAtlas {
  readonly baseUrl: string;
  readonly port: number;
  readonly requests: RecordedRequest[];
  /** Replaces how the server answers from now on. */
  respondWith(responder: Responder): void;
  close(): Promise<void>;
}

export async function startFakeAtlas(
  responder: Responder = () => ({ status: 200, body: {} }),
): Promise<FakeAtlas> {
  const requests: RecordedRequest[] = [];
  let respond = responder;
  const server = createServer((req, res) => {
    void record(req).then((request) => {
      requests.push(request);
      answer(res, respond(request));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    requests,
    respondWith: (next) => {
      respond = next;
    },
    close: () => closeServer(server),
  };
}

async function record(req: IncomingMessage): Promise<RecordedRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return {
    method: req.method ?? '',
    url: req.url ?? '',
    authorization: req.headers.authorization,
    contentType: req.headers['content-type'],
    body: text === '' ? null : JSON.parse(text),
  };
}

function answer(res: ServerResponse, scripted: ScriptedAnswer): void {
  if (scripted.body === undefined) return; // Deliberately silent: the caller should time out.
  const text = typeof scripted.body === 'string' ? scripted.body : JSON.stringify(scripted.body);
  res.writeHead(scripted.status, { 'Content-Type': 'application/json' });
  res.end(text);
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

/** A port nothing is listening on: bound, read, and released. */
export async function closedPort(): Promise<number> {
  const fake = await startFakeAtlas();
  await fake.close();
  return fake.port;
}

export const errorBody = (code: string, message: string) => ({ error: { code, message } });
