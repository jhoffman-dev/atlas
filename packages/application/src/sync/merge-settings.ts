import {
  isSettingsFile,
  KeyAsWritten,
  mergeShippedPropertiesRecords,
  parseShippedPropertiesRecord,
  SHIPPED_PROPERTIES_RECORD_PATH,
  settingsAdditions,
  shippedPropertiesRecordText,
  ShippedPropertiesRecordError,
  splitFrontmatter,
  type SettingsAdditions,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';

/** The three versions of a file both Macs changed, as text; `base` is null when both made it. */
export interface SettingsVersions {
  readonly path: string;
  readonly base: string | null;
  readonly ours: string;
  readonly theirs: string;
}

/**
 * One file holding both Macs' changes to a settings file of Atlas's own
 * (#233), or null when only a person can merge them and both versions are to
 * be kept. The record of the properties Atlas added to built-in types is the
 * union of both; any other `.atlas/` markdown file gains what the other side
 * added — a key, or an entry in a map such as a type's `properties` — with
 * every line it had kept byte for byte (ADR-0003).
 */
export function mergeSettings(markdown: MarkdownPort, versions: SettingsVersions): string | null {
  if (versions.path === (SHIPPED_PROPERTIES_RECORD_PATH as string)) return mergeRecords(versions);
  if (!isSettingsFile(versions.path)) return null;
  return mergeByKeys(markdown, versions);
}

function mergeRecords({ ours, theirs }: SettingsVersions): string | null {
  try {
    return shippedPropertiesRecordText(
      mergeShippedPropertiesRecords(
        parseShippedPropertiesRecord(ours),
        parseShippedPropertiesRecord(theirs),
      ),
    );
  } catch (cause) {
    // A record that is not one Atlas wrote is a person's: both are kept as they are.
    if (cause instanceof ShippedPropertiesRecordError) return null;
    throw cause;
  }
}

interface ReadSide {
  readonly frontmatterText: string;
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
}

function mergeByKeys(markdown: MarkdownPort, versions: SettingsVersions): string | null {
  const ours = read(markdown, versions.ours);
  const theirs = read(markdown, versions.theirs);
  if (ours === null || theirs === null) return null;
  const base = versions.base === null ? null : read(markdown, versions.base);
  if (versions.base !== null && base === null) return null;
  const intoOurs = settingsAdditions({ base, onto: ours, from: theirs });
  if (intoOurs !== null)
    return withAdditions(markdown, { onto: ours, from: theirs, additions: intoOurs });
  const intoTheirs = settingsAdditions({ base, onto: theirs, from: ours });
  if (intoTheirs === null) return null;
  return withAdditions(markdown, { onto: theirs, from: ours, additions: intoTheirs });
}

/** A version with frontmatter Atlas can read; null for one without, or one it cannot. */
function read(markdown: MarkdownPort, text: string): ReadSide | null {
  const { frontmatter, body } = splitFrontmatter(text);
  if (frontmatter === null || markdown.frontmatterProblem(frontmatter) !== null) return null;
  return {
    frontmatterText: frontmatter,
    frontmatter: markdown.frontmatterProperties(frontmatter),
    body,
  };
}

/** `onto` with `from`'s additions written in; null when the block cannot take them as new lines. */
function withAdditions(
  markdown: MarkdownPort,
  { onto, from, additions }: { onto: ReadSide; from: ReadSide; additions: SettingsAdditions },
): string | null {
  let block = onto.frontmatterText;
  if (additions.keys.length > 0) {
    const written = markdown.frontmatterKeyTexts(from.frontmatterText);
    if (additions.keys.some((key) => !Object.hasOwn(written, key))) return null;
    block = markdown.updateFrontmatter(
      block,
      Object.fromEntries(additions.keys.map((key) => [key, new KeyAsWritten(written[key]!)])),
    );
  }
  for (const [key, entries] of Object.entries(additions.entries)) {
    const map = from.frontmatter[key] as Record<string, unknown>;
    const next = markdown.addToFrontmatterMap(
      block,
      key,
      Object.fromEntries(entries.map((entry) => [entry, map[entry]])),
    );
    if (next === null) return null;
    block = next;
  }
  return block + onto.body;
}
