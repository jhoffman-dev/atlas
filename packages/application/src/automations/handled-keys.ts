import {
  answeredMeetingOf,
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
 * `decisions` — DFAI's change, not something said — so a rule that has
 * answered the words is not asked again, however the frontmatter has changed.
 * The keys ride on the version, so the ledger records them when the rule
 * answers and finds them when it looks again; no other memory is kept.
 *
 * Versions are returned as they came for a rule with no such output, and for
 * a note that cannot be read: it is then known by its digest alone.
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
  const { action } = rule;
  const keyOf =
    action.kind === 'claude' && action.output.kind === 'proposals'
      ? proposalSchemaNamed(action.output.schema)?.handledKeyOf
      : null;
  if (keyOf === null || keyOf === undefined || versions.length === 0) return [...versions];
  const texts = new Map(
    (await fs.readNotes(versions.map(({ path }) => path))).map((note) => [note.path, note.text]),
  );
  return versions.map((version) => {
    const text = texts.get(version.path);
    if (text === undefined) return version;
    const meeting = answeredMeetingOf(
      markdown.frontmatterProperties(splitFrontmatter(text).frontmatter),
    );
    const key = keyOf({ text, ...(meeting !== undefined && { meeting }) });
    return key === null ? version : { ...version, keys: [...(version.keys ?? []), key] };
  });
}
