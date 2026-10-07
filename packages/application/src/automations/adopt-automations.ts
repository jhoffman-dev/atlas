import { lastScheduleMark, splitFrontmatter, type LocalTime } from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import type { Clock } from '../ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { appendToRuleLog } from './automation-log.ts';
import type { AutomationListing, LoadedAutomation } from './load-automations.ts';

/** What adopting a listing would write: rules to stamp with their id, rules to mark as first seen. */
function adoptionsOf(listing: AutomationListing, now: LocalTime) {
  return {
    unstamped: listing.automations.filter((loaded) => !loaded.idWritten),
    unmarked: listing.automations.filter((loaded) => neverMarked(loaded, now)),
  };
}

/** An enabled rule on a clock whose log has no mark to count its next run from. */
function neverMarked({ rule, log }: LoadedAutomation, now: LocalTime): boolean {
  const scheduled = rule.when.kind === 'daily' || rule.when.kind === 'hourly';
  return rule.enabled && scheduled && lastScheduleMark(log, now) === null;
}

/** Whether {@link adoptAutomations} has anything to write for this listing. */
export function needsAdoption(listing: AutomationListing, now: LocalTime): boolean {
  const { unstamped, unmarked } = adoptionsOf(listing, now);
  return unstamped.length + unmarked.length > 0;
}

/**
 * Takes in the rules Atlas has found (A25-01), so each is one it can keep
 * track of:
 *
 * - A rule without an `id:` — written by hand, or by the feature before ids —
 *   has the id it is known by written into its file. That id is the name its
 *   log was already kept under, so the log needs no move, and from now on
 *   renaming the file keeps its history.
 * - An enabled rule on a clock that has never run nor been turned on here is
 *   marked as first seen, so its schedule counts from now: a daily rule whose
 *   time only ever falls while Atlas is closed still runs by the next day.
 */
export async function adoptAutomations({
  fs,
  markdown,
  clock,
  listing,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  clock: Pick<Clock, 'localNow'>;
  listing: AutomationListing;
}): Promise<void> {
  const now = clock.localNow();
  const { unstamped, unmarked } = adoptionsOf(listing, now);
  for (const { rule } of unstamped) {
    const { text, modified } = await fs.readTextFile(rule.path);
    const document = splitFrontmatter(text);
    const frontmatter = markdown.updateFrontmatter(document.frontmatter, { id: rule.id });
    await fs.writeTextFile({
      path: rule.path,
      contents: frontmatter + document.body,
      expectedModified: modified,
    });
  }
  for (const { rule } of unmarked) {
    await appendToRuleLog({ fs, rule, entry: { kind: 'seen', at: now } });
  }
}
