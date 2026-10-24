/**
 * Verification of PR #547's fix round (#37): the web-link reader after it was
 * made linear, and the host drawn beside a link's label. Fictional hosts only
 * (`.example`, `example.com`).
 */

import { describe, expect, it } from 'vitest';
import { answerInline, isWebAddress, type AnswerInline } from './answer-inline.ts';

const webOf = (text: string) =>
  answerInline(text).filter(
    (piece): piece is Extract<AnswerInline, { kind: 'web' }> => piece.kind === 'web',
  );

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the web-link reader, verified (PR #547)', () => {
  it('reads a run of addresses with no space between them in linear time', () => {
    // Each refused `https://` scans to the end of the run, and each is parsed
    // by `new URL` whole: 100k characters took ~11s before this was fixed.
    const answer = 'https://'.repeat(10_000);
    const started = performance.now();
    answerInline(answer);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('draws the host beside a label that only holds it inside another name', () => {
    // `mybank.example` contains `k.example`: the reader sees a bank's name
    // and nothing says the link opens k.example.
    const [link] = webOf('[mybank.example](https://k.example)');
    expect(link?.host).toBe('k.example');
  });

  it('draws the host beside a label naming a longer host that merely starts with it', () => {
    const [link] = webOf('[example.com.attacker.example](https://example.com)');
    expect(link?.host).toBe('example.com');
  });

  it('keeps the host beside a label written in a lookalike script', () => {
    // A Cyrillic "е" in the label; the address is the punycode host.
    const [link] = webOf('[еxample.com](https://xn--xample-2of.com)');
    expect(link?.host).toBe('xn--xample-2of.com');
  });

  it('agrees with a per-word reference on small answers of known link shapes', () => {
    const U = ['https://a.example', 'https://a.example/p', 'https://b.example/q_(r)'];
    // Each word, and the addresses Ask must read out of it.
    const shapes: readonly ((u: string) => [string, string[]])[] = [
      () => ['word', []],
      (u) => [u, [u]],
      (u) => [`${u}.`, [u]],
      (u) => [`${u},`, [u]],
      (u) => [`<${u}>`, [u]],
      (u) => [`[x](${u})`, [u]],
      (u) => [`(${u})`, [u]],
      (u) => [`[x](${u}`, [u]],
      () => ['[x](http://a.example)', []],
      () => ['[x](file:///etc)', []],
      () => ['[x](https://u@a.example)', []],
      () => ['((((', []],
      () => ['[[[', []],
    ];
    const random = mulberry32(547);
    for (let run = 0; run < 2000; run += 1) {
      const words: string[] = [];
      const expected: string[] = [];
      for (let at = 0; at < 1 + Math.floor(random() * 5); at += 1) {
        const shape = shapes[Math.floor(random() * shapes.length)] as (
          u: string,
        ) => [string, string[]];
        const [word, urls] = shape(U[Math.floor(random() * U.length)] as string);
        words.push(word);
        expected.push(...urls);
      }
      const text = words.join(' ');
      expect({ text, urls: webOf(text).map((piece) => piece.url) }).toEqual({
        text,
        urls: expected,
      });
    }
  });
});

describe('isWebAddress, verified (PR #547)', () => {
  it('opens an address with a query and no path, whose host is plain to see', () => {
    expect(isWebAddress('https://example.com?q=1')).toBe(true);
  });

  it('opens an address with a fragment and no path', () => {
    expect(isWebAddress('https://example.com#top')).toBe(true);
  });
});
