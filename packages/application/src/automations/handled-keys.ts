import {
  answeredMeetingOf,
  claudeStepsOf,
  proposalSchemaNamed,
  splitFrontmatter,
  type AutomationRule,
  type NoteVersionRef,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/**
 * The versions with the keys the rule's output knows a note by, besides its
 * whole-file digest (`ProposalSchema.handledKeyOf`): for `meeting-items`, the
 * meeting's words. Accepting a proposal writes the meeting's `tasks` or
 * `decisions` — Atlas's change, not something said — so a rule that has
 * answered the words is not asked again, however the frontmatter has changed.
 * The keys ride on the version, so the ledger records them when the rule
 * answers and finds them when it looks again; no other memory is kept.
 *
 * Versions are returned as they came for a rule with no such output, and for
 * a note that cannot be read: it is then known by its digest alone. A rule of
 * several steps (P29-06) is known by every Claude step's output.
 */
export async function withHandledKeys({
  fs,
  markdown,
  rule,
  versions,
}: {
  fs: Pick<VaultFsPort, 'readNotes'>;
  markdown: Pick<MarkdownPort, 'frontmatterProperties'>;
  rule: Pick<AutomationRule, 'action'>;
  versions: readonly NoteVersionRef[];
}): Promise<NoteVersionRef[]> {
  const keysOf = handledKeyReaders(rule);
  if (keysOf.length === 0 || versions.length === 0) return [...versions];
  const texts = new Map(
    (await fs.readNotes(versions.map(({ path }) => path))).map((note) => [note.path, note.text]),
  );
  return versions.map((version) => {
    const text = texts.get(version.path);
    if (text === undefined) return version;
    const meeting = answeredMeetingOf(
      markdown.frontmatterProperties(splitFrontmatter(text).frontmatter),
    );
    const note = { text, ...(meeting !== undefined && { meeting }) };
    const keys = keysOf.flatMap((keyOf) => keyOf(note) ?? []);
    const known = new Set(version.keys ?? []);
    const added = [...new Set(keys)].filter((key) => !known.has(key));
    return added.length === 0 ? version : { ...version, keys: [...known, ...added] };
  });
}

/**
 * How each of the rule's Claude steps knows a note besides its whole-file
 * digest: its one step's output, or — for a rule of several steps — every
 * step's that has one. Two steps that read the same words name the same key,
 * which is then recorded once.
 */
function handledKeyReaders(rule: Pick<AutomationRule, 'action'>) {
  return claudeStepsOf(rule.action).flatMap((step) => {
    const keyOf =
      step.output.kind === 'proposals'
        ? proposalSchemaNamed(step.output.schema)?.handledKeyOf
        : null;
    return keyOf === null || keyOf === undefined ? [] : [keyOf];
  });
}
