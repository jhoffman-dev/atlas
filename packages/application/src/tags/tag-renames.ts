import {
  formatTag,
  isTagWithin,
  renamedTagName,
  tagKey,
  type TagCount,
  type TagRename,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { LinkUpdatePanes } from '../vault/update-links.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { loadTagCounts } from './load-tags.ts';
import {
  renameTag,
  tagMergeTarget,
  tagRenamePlan,
  type TagRenamePlan,
  type TagRenameReport,
} from './rename-tag.ts';

/** A rename that would, at the moment of writing, join a tag in use without that being agreed. */
export class TagMergeError extends Error {
  /** The tag in use it would join. */
  readonly into: string;

  constructor(into: string) {
    super(`${formatTag(into)} is in use already, so the rename would merge into it.`);
    this.name = 'TagMergeError';
    this.into = into;
  }
}

interface TagPorts {
  readonly index: IndexPort;
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
}

/** Tag renames in one vault: planned against what earlier ones wrote, and written one at a time. */
export interface VaultTagRenames {
  /** {@link tagRenamePlan}, counting as in use what earlier renames wrote. */
  plan(args: TagPorts & { rename: TagRename }): Promise<TagRenamePlan>;
  /**
   * {@link renameTag}, once every rename queued before it has settled. Just
   * before writing, whether it merges is asked again; unless `merge` says a
   * merge was agreed, one that would now merge is refused with {@link TagMergeError}.
   */
  rename(
    args: TagPorts & { openNotes: LinkUpdatePanes; plan: TagRenamePlan; merge: boolean },
  ): Promise<TagRenameReport>;
}

/** The window's tag renames, one queue per vault, shared by the tags page and the API. */
export interface TagRenames {
  forVault(vault: string): VaultTagRenames;
}

/**
 * The index catches up with a write a moment later, so two renames into one
 * name, planned together, would each find it free. Serialising them and
 * remembering the names each one wrote — until the index shows them — lets the
 * second see the first.
 */
export function createTagRenames(): TagRenames {
  const vaults = new Map<string, VaultTagRenames>();
  return {
    forVault: (vault) => {
      const found = vaults.get(vault) ?? vaultTagRenames();
      vaults.set(vault, found);
      return found;
    },
  };
}

function vaultTagRenames(): VaultTagRenames {
  /** Tags renames here wrote that the index had not shown yet, by key. */
  const written = new Map<string, TagCount>();
  let tail: Promise<unknown> = Promise.resolve();

  /**
   * The index's tags, archived notes' included as a rename's plan counts them,
   * plus what was written that it does not show yet.
   */
  const inUse = async (index: IndexPort): Promise<TagCount[]> => {
    const counts = await loadTagCounts({ index, includeArchived: true });
    for (const tag of counts) written.delete(tag.key);
    return [...counts, ...written.values()];
  };

  const write = async ({
    plan,
    merge,
    ...ports
  }: Parameters<VaultTagRenames['rename']>[0]): Promise<TagRenameReport> => {
    const counts = await inUse(ports.index);
    const into = tagMergeTarget(counts, plan.rename);
    if (into !== null && !merge) throw new TagMergeError(into);
    const report = await renameTag({ ...ports, plan });
    if (report.updated.length > 0) remember(written, counts, plan.rename);
    return report;
  };

  return {
    plan: async ({ rename, ...ports }) =>
      tagRenamePlan({ ...ports, rename, alsoInUse: [...written.values()] }),
    rename: (args) => {
      const done = tail.then(() => write(args));
      // The queue only orders renames; each caller hears its own rename's failure.
      tail = done.catch(() => undefined);
      return done;
    },
  };
}

/** The names a rename wrote: those it moved stop being remembered, their new ones start. */
function remember(written: Map<string, TagCount>, counts: readonly TagCount[], rename: TagRename) {
  const fromKey = tagKey(rename.from);
  for (const key of [...written.keys()]) if (isTagWithin(key, fromKey)) written.delete(key);
  for (const tag of counts) {
    const name = renamedTagName({ name: tag.name, ...rename });
    if (name !== null) written.set(tagKey(name), { key: tagKey(name), name, count: tag.count });
  }
}
