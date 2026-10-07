import type { VaultTreeRow } from '../vault/vault-tree.ts';
import { isArchiveFolder } from '../archive/archive.ts';
import { treeEntryIcon, type SidebarIcon } from './sidebar-icon.ts';
import { treeEntryLabel } from './sidebar-names.ts';

/** A row of Pages, with what it shows as and what it is drawn with. */
export interface SidebarTreeRow extends VaultTreeRow {
  readonly label: string;
  readonly icon: SidebarIcon;
  /**
   * The Archive's row opens the Archive rather than expanding: a folder of
   * thousands of put-away notes is not something to scroll past in Pages.
   */
  readonly opensArchive: boolean;
}

/** The vault's tree, named and drawn the way the sidebar shows it. */
export function sidebarTreeRows(rows: readonly VaultTreeRow[]): SidebarTreeRow[] {
  return rows.map((row) => ({
    ...row,
    label: treeEntryLabel(row.entry),
    icon: treeEntryIcon(row.entry),
    opensArchive: isArchiveFolder(row.entry),
  }));
}
