import { describe, expect, it } from 'vitest';
import { messageWithoutPaths } from './message-without-paths.ts';

const stripped = (message: string) => messageWithoutPaths(new Error(message));

describe('messageWithoutPaths', () => {
  it.each([
    [
      'a vault in a folder with a space',
      'unable to open /Users/j/My Vault/.atlas-cache/index.sqlite',
      'unable to open <path>',
    ],
    [
      'an iCloud vault',
      'unable to open /Users/j/Library/Mobile Documents/com~apple~CloudDocs/Notes Vault/.atlas-cache/index.sqlite',
      'unable to open <path>',
    ],
    [
      'a note whose own name has spaces, then the reason',
      'cannot read /Users/j/My Vault/Notes/Weekly Plan.md: permission denied',
      'cannot read <path>: permission denied',
    ],
    [
      'a path followed by prose',
      'cannot open /Users/j/Vault/a.md because it is locked',
      'cannot open <path> because it is locked',
    ],
    [
      'a Windows path with spaces',
      'unable to open C:\\Users\\J\\My Vault\\.atlas-cache\\index.sqlite',
      'unable to open <path>',
    ],
    [
      'a quoted path, and the words after the quote',
      'no such file "/Volumes/Big Disk/Vault/x.md" (os error 2)',
      'no such file "<path>" (os error 2)',
    ],
    [
      'a UNC share',
      'cannot reach \\\\nas\\Home Share\\My Vault\\a.md now',
      'cannot reach <path> now',
    ],
    [
      'a path after a comma, as Node names one',
      'ENOENT: no such file or directory,/Users/j/My Vault/a.md',
      'ENOENT: no such file or directory,<path>',
    ],
    [
      'a path under the home folder',
      'no such file: ~/Documents/My Vault/diary.md',
      'no such file: <path>',
    ],
    [
      'a folder whose name holds an apostrophe',
      "cannot read /Users/j/Bob's Vault/a.md, try again",
      'cannot read <path>, try again',
    ],
    [
      'a quoted folder whose name holds an apostrophe',
      'cannot read ‘/Users/j/Bob’s Vault/Plans’ now',
      'cannot read ‘<path>’ now',
    ],
    [
      'a quoted folder with spaces and no file name',
      'no such folder "/Volumes/Big Disk/My Vault" here',
      'no such folder "<path>" here',
    ],
    [
      'two paths',
      'rename /Users/j/My Vault/a.md to /Users/j/My Vault/b c.md',
      'rename <path> to <path>',
    ],
  ])('takes out the whole of %s', (_, message, expected) => {
    expect(stripped(message)).toBe(expected);
  });

  it.each([
    ['a lone slash quoted back from a syntax error', 'near "/": syntax error'],
    ['a division', 'no such column: a / b'],
    ['a relative path', 'no such table: v_task in notes/x'],
    ['a lone slash in backticks', 'unexpected `/` in expression'],
    ['a tilde on its own', 'about ~ 3 notes, ~/ alone'],
    ['a fraction in brackets', 'ratio [1/2] and {3/4}'],
  ])('leaves %s alone', (_, message) => {
    expect(stripped(message)).toBe(message);
  });
});

/*
 * Property-style: paths built from random folder names, in every wrapper the
 * app's errors arrive in, must leave none of their folder names behind and
 * keep the words around them. Seeded, so a failure is the same every run.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROOTS = [
  { lead: '/Users/', sep: '/' },
  { lead: '/Volumes/', sep: '/' },
  { lead: '~/', sep: '/' },
  { lead: 'C:\\', sep: '\\' },
  { lead: 'D:/', sep: '/' },
  { lead: '\\\\server\\', sep: '\\' },
] as const;
const WRAPS = [
  ['', ''],
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['“', '”'],
  ['‘', '’'],
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['<', '>'],
] as const;
const BEFORE = ['', 'cannot open ', 'path=', 'error: ', 'EACCES, open '] as const;
const AFTER = ['', ' (os error 2)', ': permission denied', '\nnext line'] as const;

describe('messageWithoutPaths over generated paths', () => {
  it('leaves no folder name from a path in any wrapper, and keeps the words around it', () => {
    const random = seeded(20260928);
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
    for (let n = 0; n < 2000; n++) {
      const root = pick(ROOTS);
      const [open, close] = pick(WRAPS);
      const names = Array.from({ length: 1 + Math.floor(random() * 4) }, (_, i) =>
        random() < 0.5 ? `Zq${n}x${i}` : `Zq${n}x${i} Folder`,
      );
      // A bare path ending in a folder with a space reads as prose; a bare one ends in a file.
      const last = open === '' || random() < 0.5 ? `Zq${n}last note.md` : `Zq${n}last`;
      const path = `${root.lead}${[...names, last].join(root.sep)}`;
      const before = pick(BEFORE);
      const after = pick(AFTER);
      const message = `${before}${open}${path}${close}${after}`;
      const kept = stripped(message);
      expect(kept, message).not.toMatch(/Zq\d/);
      expect(kept, message).toBe(`${before}${open}<path>${close}${after}`);
    }
  });
});
