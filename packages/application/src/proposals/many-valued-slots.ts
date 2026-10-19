import {
  proposalSlotOf,
  splitFrontmatter,
  type ProposalNote,
  type ProposalSlot,
  type VaultPath,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import { VaultAccessError, type VaultFsPort } from '../vault/ports.ts';

/**
 * Which of the slots that two or more open proposals fill hold many values,
 * by the type of the note they change: those proposals are not a pick-one,
 * since each is right. Only a slot shared is looked up, so a list of proposals
 * that cannot conflict reads nothing but themselves.
 */
export async function manyValuedSlots({
  fs,
  markdown,
  open,
}: {
  fs: VaultFsPort;
  markdown: Pick<MarkdownPort, 'frontmatterProperties'>;
  open: readonly ProposalNote[];
}): Promise<readonly ProposalSlot[]> {
  const shared = sharedSlots(open);
  if (shared.length === 0) return [];
  const types = await loadObjectTypes({ fs, markdown });
  const many: ProposalSlot[] = [];
  for (const slot of shared) {
    const text = await textOf(fs, slot.note);
    if (text === null) continue;
    const properties = markdown.frontmatterProperties(splitFrontmatter(text).frontmatter);
    const typeName = properties['type'];
    if (typeof typeName !== 'string') continue;
    const folded = typeName.trim().toLowerCase();
    const relation = types
      .find((type) => type.name.trim().toLowerCase() === folded)
      ?.properties.find((each) => each.key === slot.property && each.kind === 'relation');
    if (relation !== undefined && relation.many) many.push(slot);
  }
  return many;
}

function sharedSlots(open: readonly ProposalNote[]): readonly ProposalSlot[] {
  const counted = new Map<string, { slot: ProposalSlot; count: number }>();
  for (const proposal of open) {
    const slot = proposalSlotOf(proposal);
    if (slot === null) continue;
    const key = `${slot.note}\u0000${slot.property}`;
    const held = counted.get(key);
    if (held === undefined) counted.set(key, { slot, count: 1 });
    else held.count += 1;
  }
  return [...counted.values()].filter((each) => each.count > 1).map((each) => each.slot);
}

/** A note's text; null when it is not there — then its proposals are refused when answered, not grouped. */
async function textOf(fs: VaultFsPort, note: VaultPath): Promise<string | null> {
  try {
    return (await fs.readTextFile(note)).text;
  } catch (cause) {
    if (cause instanceof VaultAccessError) return null;
    throw cause;
  }
}
