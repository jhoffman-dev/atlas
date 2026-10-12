import { describe, expect, it, vi } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { inThreadNoteDeriver, type MarkdownPort, type NoteFile } from '@atlas/application';
import { remarkMarkdown } from '../markdown/markdown-port.ts';
import { ROUND_TRIP_CORPUS } from '../markdown/round-trip-corpus.ts';
import {
  serveNoteDerivation,
  workerNoteDeriver,
  type DerivationAnswer,
  type DerivationRequest,
  type DerivationWorker,
} from './worker-note-deriver.ts';

type Heard = Parameters<DerivationWorker['listen']>[0];

/**
 * The worker's side run in this process, with what a real one puts between the
 * two: every message is copied as `postMessage` copies it, and arrives in a
 * later task. `crash` is the worker dying, as its `error` event says it.
 */
function inProcessWorker(markdown: MarkdownPort = remarkMarkdown) {
  let heard: Heard | null = null;
  const requests: DerivationRequest[] = [];
  const serve = serveNoteDerivation({
    markdown,
    answer: (answer: DerivationAnswer) => {
      const copy = structuredClone(answer);
      setTimeout(() => heard?.onAnswer(copy));
    },
  });
  const worker: DerivationWorker = {
    post: (request) => {
      const copy = structuredClone(request);
      requests.push(copy);
      setTimeout(() => serve(copy));
    },
    listen: (listener) => {
      heard = listener;
    },
  };
  return { worker, requests, crash: (problem: string) => heard?.onCrash(problem) };
}

const FRONTMATTER = [
  '---',
  'type: task',
  'title: A title of its own',
  'status: next',
  'due: 2026-10-12',
  'project: "[[one paragraph]]"',
  'people: ["[[Mara Quill]]", "[[Tobias Fenn]]"]',
  'tags: [alpha, beta/gamma]',
  '---',
  '',
].join('\n');

/** Every entry of the round-trip corpus as a note, with and without frontmatter. */
function corpusFiles(): NoteFile[] {
  return ROUND_TRIP_CORPUS.flatMap(([label, markdown], position) => [
    { path: `${label}.md`, text: markdown, modified: position, size: markdown.length },
    {
      path: `Typed/${label}.md`,
      text: FRONTMATTER + markdown,
      modified: position,
      size: FRONTMATTER.length + markdown.length,
    },
  ]);
}

const pathsOf = (files: readonly NoteFile[]) => files.map((file) => createVaultPath(file.path));

describe('workerNoteDeriver', () => {
  it('derives the same rows as this thread does, for the whole round-trip corpus', async () => {
    const files = corpusFiles();
    const paths = [...pathsOf(files), createVaultPath('People/Mara Quill.md')];
    const { worker } = inProcessWorker();

    const here = await inThreadNoteDeriver(remarkMarkdown).begin(paths).derive(files);
    const there = await workerNoteDeriver(() => worker)
      .begin(paths)
      .derive(files);

    expect(there).toEqual(here);
    expect(there.failed).toEqual([]);
    expect(there.notes).toHaveLength(ROUND_TRIP_CORPUS.length * 2);
    // Not a comparison of two empty answers: every kind of row is among them.
    const rows = there.notes;
    expect(rows.some((note) => note.links.some((link) => link.path !== null))).toBe(true);
    expect(rows.some((note) => note.relations.some((held) => held.path !== null))).toBe(true);
    expect(rows.some((note) => note.tags.length > 0)).toBe(true);
    expect(rows.some((note) => note.blocks.length > 0)).toBe(true);
    expect(rows.some((note) => note.checks.length > 0)).toBe(true);
    expect(rows.some((note) => note.properties.length > 0)).toBe(true);
    expect(rows.every((note) => note.digest !== '')).toBe(true);
  });

  it('resolves every batch of a build against the notes the build began with', async () => {
    const paths = [createVaultPath('Plans/Camping.md'), createVaultPath('Idea.md')];
    const { worker } = inProcessWorker();
    const deriving = workerNoteDeriver(() => worker).begin(paths);
    const idea = { path: 'Idea.md', text: 'See [[Camping]].\n', modified: 1, size: 17 };

    await deriving.derive([]);
    const second = await deriving.derive([idea]);

    expect(second.notes[0]?.links).toEqual([
      { target: 'Camping', path: 'Plans/Camping.md', kind: 'wikilink' },
    ]);
  });

  it('keeps one worker for every build', async () => {
    const { worker } = inProcessWorker();
    const spawn = vi.fn(() => worker);
    const deriver = workerNoteDeriver(spawn);

    const first = deriver.begin([]);
    await first.derive([]);
    first.end();
    await deriver.begin([]).derive([]);

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('spawns no worker until a build begins', () => {
    const spawn = vi.fn(() => inProcessWorker().worker);
    workerNoteDeriver(spawn);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('says which note could not be read, and still answers with the others', async () => {
    const torn: MarkdownPort = {
      ...remarkMarkdown,
      plainText: (body) => {
        if (body.includes('torn')) throw new Error('unexpected end of note');
        return remarkMarkdown.plainText(body);
      },
    };
    const { worker } = inProcessWorker(torn);
    const files = [
      { path: 'Idea.md', text: 'a spark\n', modified: 1, size: 8 },
      { path: 'Torn.md', text: 'torn\n', modified: 1, size: 5 },
    ];

    const derived = await workerNoteDeriver(() => worker)
      .begin(pathsOf(files))
      .derive(files);

    expect(derived.notes.map((note) => note.path)).toEqual(['Idea.md']);
    expect(derived.failed).toEqual([{ path: 'Torn.md', problem: 'unexpected end of note' }]);
  });

  it('fails the batch it was waiting for when the worker dies, and starts another for the next build', async () => {
    const first = inProcessWorker();
    const second = inProcessWorker();
    const spawn = vi.fn<() => DerivationWorker>();
    spawn.mockReturnValueOnce(first.worker).mockReturnValueOnce(second.worker);
    const deriver = workerNoteDeriver(spawn);

    const waiting = deriver.begin([]).derive([]);
    first.crash('out of memory');
    await expect(waiting).rejects.toThrow('The notes could not be read for the index: out of memory');

    const again = await deriver.begin([]).derive([]);
    expect(again).toEqual({ notes: [], failed: [] });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('fails a batch asked of a worker that cannot be started', async () => {
    const deriver = workerNoteDeriver(() => {
      throw new Error('workers are not allowed here');
    });

    expect(() => deriver.begin([])).toThrow('workers are not allowed here');
  });

  it('refuses a batch for a build it has let go of, rather than answering from another', async () => {
    const { worker } = inProcessWorker();
    const deriving = workerNoteDeriver(() => worker).begin([]);

    deriving.end();

    await expect(deriving.derive([])).rejects.toThrow('this build of the index has ended');
  });

  it('tells the worker to forget a build that has ended', async () => {
    const { worker, requests } = inProcessWorker();
    const deriving = workerNoteDeriver(() => worker).begin([createVaultPath('Idea.md')]);
    await deriving.derive([]);

    deriving.end();

    expect(requests.map((request) => request.kind)).toEqual(['begin', 'derive', 'end']);
  });
});
