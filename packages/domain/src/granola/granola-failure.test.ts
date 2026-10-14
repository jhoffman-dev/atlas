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
    expect(fix).toMatch(/scopes.*Sync now/);
  });

  it('says a note Granola no longer has (404) was skipped, with nothing else to do', () => {
    expect(explainGranolaFailure(refused(404))).toEqual({
      problem: 'Granola no longer has the note, or it is no longer shared with you.',
      fix: 'It was skipped; Sync now tries it again.',
    });
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
    expect(explainGranolaFailure(refused(400))).toEqual({
      problem: 'Granola refused the request (400).',
      fix: 'It was skipped; Sync now tries it again.',
    });
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

  it('names an answer Atlas cannot read, without its body, and says it was skipped', () => {
    const { problem, fix } = explainGranolaFailure(failure('malformed'));
    expect(problem).toBe(
      'Granola answered in a way Atlas does not understand: what the host said.',
    );
    expect(fix).toBe('It was skipped; Sync now tries it again.');
  });

  it('says a request Granola did not answer in time (408) is tried on the next pull', () => {
    const { problem, fix } = explainGranolaFailure(refused(408));
    expect(problem).toMatch(/did not answer in time/);
    expect(fix).toMatch(/next pull/);
  });

  it('names a request the host would not make, with what it said, and that the next pull asks again', () => {
    expect(explainGranolaFailure(failure('invalid'))).toEqual({
      problem: 'Atlas could not ask Granola: what the host said.',
      fix: 'Atlas stops pulling; the next pull asks again.',
    });
  });

  it('points a Keychain that would not give up the key at the Keychain and the card', () => {
    const { problem, fix } = explainGranolaFailure(failure('keychain'));
    expect(problem).toBe(
      'The Keychain did not give Atlas the Granola API key: what the host said.',
    );
    expect(fix).toBe(
      'Unlock the Keychain, or paste the key again in Settings → Granola. Atlas stops pulling; the next pull asks again.',
    );
    expect(fix).not.toMatch(/until it has a key/);
  });

  it('says a list of notes that failed was not skipped, and that the next pull lists again', () => {
    for (const failed of [failure('malformed'), refused(404), refused(503), failure('timeout')]) {
      const { fix } = explainGranolaFailure(failed, 'listing');
      expect(fix).toMatch(/The notes could not be listed; the next pull lists them again\.$/);
      expect(fix).not.toMatch(/skipped|Sync now tries it again/);
    }
    expect(explainGranolaFailure(refused(403), 'listing').fix).toMatch(
      /^Check the key’s scopes .* The notes could not be listed/,
    );
  });

  it('says a list stopped by the key, the Keychain or the host stopped, as for a note', () => {
    for (const failed of [
      refused(401),
      failure('no_key'),
      failure('keychain'),
      failure('invalid'),
    ]) {
      expect(explainGranolaFailure(failed, 'listing')).toEqual(explainGranolaFailure(failed));
    }
  });

  it('says an answer larger than Atlas reads was skipped', () => {
    const { problem, fix } = explainGranolaFailure(failure('too_large'));
    expect(problem).toBe('Granola answered with more than Atlas will read.');
    expect(fix).toBe('It was skipped; Sync now tries it again.');
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
    expect(isGranolaFailureKind('keychain')).toBe(true);
    expect(isGranolaFailureKind('refused')).toBe(false);
    expect(isGranolaFailureKind(undefined)).toBe(false);
  });
});

describe('granolaFailureEffect', () => {
  it('stops the pull when there is no key or Granola refused it', () => {
    expect(granolaFailureEffect(failure('no_key'))).toBe('stop');
    expect(granolaFailureEffect(refused(401))).toBe('stop');
  });

  it('stops the pull when the host will not send, or the Keychain will not give the key', () => {
    expect(granolaFailureEffect(failure('invalid'))).toBe('stop');
    expect(granolaFailureEffect(failure('keychain'))).toBe('stop');
    expect(granolaFailureEffect({ ...failure('keychain'), transcriptPage: true })).toBe('stop');
  });

  it('skips an answer larger than Atlas reads: it is as large on every pull', () => {
    expect(granolaFailureEffect(failure('too_large'))).toBe('skip');
  });

  it('skips a note Granola no longer has, rather than hold the watermark for it', () => {
    expect(granolaFailureEffect(refused(404))).toBe('skip');
  });

  it.each([408, 429, 500, 503, 599])(
    'retries a status that may pass by itself (%i), holding the watermark',
    (status) => {
      expect(granolaFailureEffect(refused(status))).toBe('retry');
    },
  );

  it('retries a network failure and a timeout', () => {
    expect(granolaFailureEffect(failure('unreachable'))).toBe('retry');
    expect(granolaFailureEffect(failure('timeout'))).toBe('retry');
  });

  it('retries a 413, which the next pull reads in pages', () => {
    expect(granolaFailureEffect(refused(413))).toBe('retry');
  });

  it('treats a failed page of a transcript by its status, as any other request', () => {
    const page = (failed: GranolaFailure): GranolaFailure => ({ ...failed, transcriptPage: true });
    expect(granolaFailureEffect(page(refused(404)))).toBe('skip');
    expect(granolaFailureEffect(page(refused(400)))).toBe('skip');
    expect(granolaFailureEffect(page(refused(403)))).toBe('skip');
    expect(granolaFailureEffect(page(failure('malformed')))).toBe('skip');
    expect(granolaFailureEffect(page(refused(401)))).toBe('stop');
    expect(granolaFailureEffect(page(refused(429)))).toBe('retry');
    expect(granolaFailureEffect(page(refused(503)))).toBe('retry');
    expect(granolaFailureEffect(page(failure('timeout')))).toBe('retry');
    expect(granolaFailureEffect(page(failure('unreachable')))).toBe('retry');
  });

  it('skips a page of a transcript Granola says is still too large (413): paging was the remedy', () => {
    expect(granolaFailureEffect({ ...refused(413), transcriptPage: true })).toBe('skip');
  });

  it('skips a failure of a kind it does not know, rather than hold the watermark or stop', () => {
    const unknown = { kind: 'surprise', message: 'x' } as unknown as GranolaFailure;
    expect(granolaFailureEffect(unknown)).toBe('skip');
  });

  it.each([400, 403, 405, 409, 410, 422, 499, 302, 600])(
    'skips a refusal that would come back the same on every pull (%i)',
    (status) => {
      expect(granolaFailureEffect(refused(status))).toBe('skip');
    },
  );

  it('skips an answer Atlas cannot read, and a refusal with no status', () => {
    expect(granolaFailureEffect(failure('malformed'))).toBe('skip');
    expect(granolaFailureEffect({ kind: 'api_refused', message: 'x' })).toBe('skip');
  });
});

/*
 * The person is told what the pull did. Every failure there can be — each
 * kind, an unknown one, every status from 99 to 1000, and none, as a page of
 * a transcript or not — says it was skipped, that Atlas tries again, or that
 * it stopped, exactly as granolaFailureEffect decides, and says nothing else.
 */
describe('explainGranolaFailure, against granolaFailureEffect', () => {
  const CLAUSES = {
    skip: /skipped/,
    retry: /tries again on the next pull/,
    stop: /stops pulling/,
  } as const;
  const kinds = [...GRANOLA_FAILURE_KINDS, 'surprise'] as GranolaFailure['kind'][];
  const statuses = [undefined, ...Array.from({ length: 1000 - 99 + 1 }, (_, at) => 99 + at)];
  const failures = kinds.flatMap((kind) =>
    statuses.flatMap((status) =>
      [undefined, false, true].map((transcriptPage): GranolaFailure => ({
        kind,
        message: 'what the host said',
        ...(status === undefined ? {} : { status }),
        ...(transcriptPage === undefined ? {} : { transcriptPage }),
      })),
    ),
  );

  it('says what the pull does with every failure, and nothing it does not', () => {
    const disagreements = failures.flatMap((failed) => {
      const effect = granolaFailureEffect(failed);
      const { problem, fix } = explainGranolaFailure(failed);
      const said = `${problem} ${fix ?? ''}`;
      const wrong = Object.entries(CLAUSES).filter(
        ([named, clause]) => clause.test(said) !== (named === effect),
      );
      return wrong.length === 0 ? [] : [{ failed, effect, said }];
    });
    expect(disagreements).toEqual([]);
    expect(failures.length).toBe(kinds.length * statuses.length * 3);
  });
});
