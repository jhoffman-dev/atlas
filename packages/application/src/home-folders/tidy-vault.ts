import {
  createVaultPath,
  foldedVaultPath,
  isTidyCandidate,
  splitFrontmatter,
  tidyPlan,
  type TidyMove,
  type TidyPlan,
  type VaultPath,
} from '@dfai/domain';
import {
  moveAndStampNotes,
  type ArchiveFailure,
  type ArchivePorts,
} from '../archive/archive-notes.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { listVaultNotes } from '../vault/read-vault.ts';

/** What the tidy reads: the vault's notes and how their frontmatter reads. */
export interface TidyPorts {
  readonly fs: VaultFsPort;
  readonly markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'frontmatterProblem'>;
}

/**
 * What tidying the vault would do now (#214), read and not done: every note
 * loose at the root, and every meeting in the older `Inbox/Meetings`, with
 * where each would go or why it stays (`tidyPlan`). Nothing is written.
 *
 * `known` is the vault's notes as already listed — the index's, read ahead of
 * the Inbox (#130) — in place of walking the vault for them. A walk then would
 * be taken for a refresh after whatever the vault last reported (#254).
 */
export async function previewVaultTidy(
  ports: TidyPorts,
  today: string,
  known?: readonly VaultPath[],
): Promise<TidyPlan> {
  const notePaths = known ?? (await listVaultNotes({ fs: ports.fs }));
  const candidates = notePaths.filter(isTidyCandidate);
  const files = candidates.length === 0 ? [] : await ports.fs.readNotes(candidates);
  const notes = files.map((file) => ({
    path: createVaultPath(file.path),
    properties: frontmatterOf(ports.markdown, file.text),
  }));
  const types = await loadObjectTypes(ports);
  return tidyPlan({ notes, notePaths, types, today });
}

/** A note's frontmatter as values; none when its block cannot be read, so it is judged as a plain note. */
function frontmatterOf(
  markdown: TidyPorts['markdown'],
  text: string,
): Readonly<Record<string, unknown>> {
  const { frontmatter } = splitFrontmatter(text);
  if (markdown.frontmatterProblem(frontmatter) !== null) return {};
  return markdown.frontmatterProperties(frontmatter);
}

/** What the tidy did: the notes it moved, the ones it left where they were, and the links it rewrote. */
export interface TidyOutcome {
  readonly moved: readonly TidyMove[];
  readonly failed: readonly ArchiveFailure[];
  readonly linksUpdated: number;
}

/**
 * Tidies the vault as `shown` previewed it, once the person said so (#214).
 *
 * The plan is read again first, and a move is made only when it is still in
 * both: a note edited, moved or given a namesake since the preview stays
 * where it is rather than going somewhere the person never saw. Each moves
 * through the Archive's batch, under its own name — never numbered: one whose
 * place was taken since is reported and stays — and the links the moves
 * leave behind, relations among them, are rewritten once at the end, so
 * every link still opens the note it opened.
 */
export async function applyVaultTidy({
  ports,
  shown,
  today,
}: {
  ports: ArchivePorts;
  shown: TidyPlan;
  /** `YYYY-MM-DD`, from the injected clock. */
  today: string;
}): Promise<TidyOutcome> {
  const now = await previewVaultTidy(ports, today);
  const asShown = new Set(shown.moves.map(moveKey));
  const moves = now.moves.filter((move) => asShown.has(moveKey(move)));
  const destinations = new Map(moves.map(({ from, to }) => [from, to]));
  const notePaths = await listVaultNotes({ fs: ports.fs });
  const outcome = await moveAndStampNotes(
    { ports, paths: moves.map(({ from }) => from), notePaths, updateLinks: true },
    {
      refusal: () => null,
      destination: async ({ path, taken }) => exactly(destinations.get(path) ?? path, taken),
      // Nothing is written into a note the tidy moves: only where it is changes.
      stamp: () => () => ({ changes: {}, keepsBlock: true }),
    },
  );
  return {
    moved: outcome.moves.map(({ move }) => ({ from: move.from, to: move.to })),
    failed: outcome.failed,
    linksUpdated: outcome.linksUpdated,
  };
}

const moveKey = ({ from, to }: TidyMove) => `${from}\n${to}`;

/** `to`, unless a note has taken it since: the tidy refuses rather than renames. */
function exactly(to: VaultPath, taken: ReadonlySet<string>): VaultPath {
  const landing = foldedVaultPath(to);
  if ([...taken].some((path) => foldedVaultPath(path) === landing)) {
    throw new Error(`${to} is already a note there, so it stays where it is.`);
  }
  return to;
}
