import { describe, expect, it } from 'vitest';
import {
  explainGranolaFailure,
  GRANOLA_FAILURE_KINDS,
  granolaFailureEffect,
  isGranolaFailureKind,
  type GranolaFailure,
} from './granola-failure.ts';

const refused = (status: number): GranolaFailure => ({
  kind: 'api_refused',
  status,
  message: 'what the host said',
});
const failure = (kind: GranolaFailure['kind']): GranolaFailure => ({
  kind,
  message: 'what the host said',
});

describe('explainGranolaFailure', () => {
  it('tells someone whose key Granola refused (401) where to make a new one', () => {
    const { problem, fix } = explainGranolaFailure(refused(401));
    expect(problem).toMatch(/Granola refused the API key/);
    expect(fix).toMatch(/Granola → Settings → Connectors → API keys/);
    expect(fix).toMatch(/Settings → Granola/);
  });

  it('points a key Granola will not let read a note (403) at its scopes', () => {
    const { problem, fix } = explainGranolaFailure(refused(403));
    expect(problem).toMatch(/does not let this API key read the note/);
    expect(fix).toMatch(/scopes/);
  });

  it('says a note Granola no longer has (404) was skipped, with nothing to do', () => {
    const { problem, fix } = explainGranolaFailure(refused(404));
    expect(problem).toMatch(/no longer has the note.*skipped/);
    expect(fix).toBeNull();
  });

  it('says a transcript too large to send at once is read in pages next time', () => {
    const { problem, fix } = explainGranolaFailure(refused(413));
    expect(problem).toMatch(/too large/);
    expect(fix).toMatch(/pages/);
  });

  it('says Granola asked Atlas to slow down, and that it will try again', () => {
    const { problem, fix } = explainGranolaFailure(refused(429));
    expect(problem).toMatch(/slow down/);
    expect(fix).toMatch(/next pull/);
  });

  it.each([500, 502, 503, 599])(
    'names trouble on Granola’s side (%i) with its status',
    (status) => {
      const { problem, fix } = explainGranolaFailure(refused(status));
      expect(problem).toBe(`Granola is having trouble (status ${status}).`);
      expect(fix).toMatch(/Sync now later/);
    },
  );

  it('passes any other status on, as a refusal with its number', () => {
    expect(explainGranolaFailure(refused(400)).problem).toBe('Granola refused the request (400).');
    expect(explainGranolaFailure({ kind: 'api_refused', message: 'x' }).problem).toBe(
      'Granola refused the request (no status).',
    );
  });

  it('tells someone with no key where to make one and where to put it', () => {
    const { problem, fix } = explainGranolaFailure(failure('no_key'));
    expect(problem).toMatch(/No Granola API key/);
    expect(fix).toMatch(/Connectors → API keys/);
  });

  it('names a connection failure with what the host said', () => {
    expect(explainGranolaFailure(failure('unreachable')).problem).toBe(
      'Granola could not be reached: what the host said.',
    );
    expect(explainGranolaFailure(failure('timeout')).problem).toMatch(/did not answer in time/);
  });

  it('names an answer Atlas cannot read, without its body', () => {
    expect(explainGranolaFailure(failure('malformed')).problem).toBe(
      'Granola answered in a way Atlas does not understand: what the host said.',
    );
  });

  it('has words for every kind there is', () => {
    for (const kind of GRANOLA_FAILURE_KINDS) {
      expect(explainGranolaFailure(failure(kind)).problem).not.toBe('');
    }
  });
});

describe('isGranolaFailureKind', () => {
  it('knows the kinds, and nothing else', () => {
    expect(isGranolaFailureKind('no_key')).toBe(true);
    expect(isGranolaFailureKind('api_refused')).toBe(true);
    expect(isGranolaFailureKind('refused')).toBe(false);
    expect(isGranolaFailureKind(undefined)).toBe(false);
  });
});

describe('granolaFailureEffect', () => {
  it('stops the pull when there is no key or Granola refused it', () => {
    expect(granolaFailureEffect(failure('no_key'))).toBe('stop');
    expect(granolaFailureEffect(refused(401))).toBe('stop');
  });

  it('skips a note Granola no longer has, rather than hold the watermark for it', () => {
    expect(granolaFailureEffect(refused(404))).toBe('skip');
  });

  it('retries everything else on the next pull', () => {
    for (const status of [403, 413, 429, 500, 503]) {
      expect(granolaFailureEffect(refused(status))).toBe('retry');
    }
    for (const kind of ['unreachable', 'timeout', 'malformed'] as const) {
      expect(granolaFailureEffect(failure(kind))).toBe('retry');
    }
    expect(granolaFailureEffect({ kind: 'api_refused', message: 'x' })).toBe('retry');
  });
});
