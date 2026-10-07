import {
  compileSourceNotesQuery,
  isSecretName,
  parseDatasource,
  parseSecretOrigins,
  secretsUsedBy,
  splitFrontmatter,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { atlasNotes } from '../sidebar/load-catalog.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import type { SecretStorePort } from './ports.ts';

/** One secret as Settings lists it: its name, the sources that use it, and where it may go. Never its value. */
export interface SecretListing {
  readonly name: string;
  readonly usedBy: readonly string[];
  /** Empty when it is sent nowhere yet: unset, or set before bindings existed. */
  readonly origins: readonly string[];
}

const UNUSABLE_SITES = 'Where it may be sent is an https site, such as https://api.github.com.';

/**
 * Stores a secret, or replaces one, under a name a source can refer to.
 *
 * Returns why it was refused, or null once stored. Whitespace around the value
 * is dropped: a token pasted with its trailing newline would otherwise be sent
 * with it, and no header value may carry one. `sites`, as typed, binds it to
 * where it may be sent; left out, a replaced value keeps the sites it had.
 */
export async function saveSecret({
  store,
  name,
  value,
  sites,
  vault,
}: {
  store: SecretStorePort;
  name: string;
  value: string;
  sites?: string;
  /** The vault the value was typed for, so a switch in between refuses the write. */
  vault: string;
}): Promise<string | null> {
  const trimmedName = name.trim();
  const trimmedValue = value.trim();
  if (!isSecretName(trimmedName)) {
    return 'A name is a letter or digit, then letters, digits, dots, dashes and underscores, up to 64.';
  }
  if (trimmedValue === '') return 'A secret needs a value.';
  const origins = sites === undefined ? undefined : parseSecretOrigins(sites);
  if (origins === null) return UNUSABLE_SITES;

  return failureOf(() =>
    store.set({
      name: trimmedName,
      value: trimmedValue,
      vault,
      ...(origins === undefined ? {} : { origins }),
    }),
  );
}

/**
 * Changes where a stored secret may be sent. Returns why it was refused — sites
 * that are not https sites, or the person declining the host's question — or
 * null once bound.
 */
export async function bindSecret({
  store,
  name,
  sites,
  vault,
}: {
  store: SecretStorePort;
  name: string;
  sites: string;
  vault: string;
}): Promise<string | null> {
  const origins = parseSecretOrigins(sites);
  if (origins === null) return UNUSABLE_SITES;
  return failureOf(() => store.bind({ name, origins, vault }));
}

/** Removes a secret from the keychain. Returns why it could not be, or null once gone. */
export function deleteSecret({
  store,
  name,
  vault,
}: {
  store: SecretStorePort;
  name: string;
  vault: string;
}): Promise<string | null> {
  return failureOf(() => store.remove({ name, vault }));
}

async function failureOf(action: () => Promise<void>): Promise<string | null> {
  try {
    await action();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * The open vault's secrets, each with the sources that name it.
 *
 * A name a source refers to but the keychain does not hold is listed too, with
 * nothing to show for it: that is the source that will fail to refresh on this
 * machine, and Settings is where it gets set.
 */
export async function listSecrets({
  store,
  fs,
  markdown,
  index,
}: {
  store: SecretStorePort;
  fs: VaultFsPort;
  markdown: MarkdownPort;
  index: IndexPort;
}): Promise<{
  readonly stored: readonly SecretListing[];
  readonly unset: readonly SecretListing[];
}> {
  const [secrets, usage] = await Promise.all([store.list(), secretUsage({ fs, markdown, index })]);
  const origins = new Map(secrets.map((secret) => [secret.name, secret.origins]));
  const listing = (name: string): SecretListing => ({
    name,
    usedBy: usage.get(name) ?? [],
    origins: origins.get(name) ?? [],
  });

  return {
    stored: [...origins.keys()].sort().map(listing),
    unset: [...usage.keys()]
      .filter((name) => !origins.has(name))
      .sort()
      .map(listing),
  };
}

/** Each secret name, and the paths of the sources that use it. */
async function secretUsage({
  fs,
  markdown,
  index,
}: {
  fs: VaultFsPort;
  markdown: MarkdownPort;
  index: IndexPort;
}): Promise<ReadonlyMap<string, readonly string[]>> {
  const sources = new Map<string, Readonly<Record<string, unknown>>>();

  for (const [path, { properties }] of await atlasNotes({ fs, markdown })) {
    sources.set(path, properties);
  }
  for (const file of await fs.readNotes(await indexedSourcePaths(index))) {
    const { frontmatter } = splitFrontmatter(file.text);
    if (frontmatter !== null) sources.set(file.path, markdown.frontmatterProperties(frontmatter));
  }

  const usage = new Map<string, string[]>();
  for (const [path, properties] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
    const source = parseDatasource(properties);
    for (const name of source === null ? [] : secretsUsedBy(source)) {
      usage.set(name, [...(usage.get(name) ?? []), path]);
    }
  }
  return usage;
}

async function indexedSourcePaths(index: IndexPort): Promise<readonly string[]> {
  const { sql, parameters } = compileSourceNotesQuery();
  try {
    const result = await index.query(sql, parameters);
    const at = result.columns.indexOf('path');
    return result.rows.map((row) => String(row[at] ?? '')).filter((path) => path !== '');
  } catch {
    // An index that is not open yet, or is mid-rebuild, leaves "used by" to the
    // sources in `.atlas` for a moment. The list of names does not depend on it.
    return [];
  }
}
