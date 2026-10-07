import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  quickAddChoice,
  quickAddFields,
  DEFAULT_FAB_ANCHOR,
  type FabAnchor,
  type ObjectType,
  type VaultPath,
} from '@atlas/domain';
import {
  findTypeTemplate,
  notesInUseOfType,
  quickAddNote,
  type IndexPort,
  type MarkdownPort,
  type NoteTemplate,
  type VaultFsPort,
} from '@atlas/application';
import type { FabAnchorStore, QuickAddRequest, RelationChoice } from '@atlas/ui';
import type { Overlay } from '../overlay.ts';
import type { QuickAddSetting } from './use-quick-add-setting.ts';

/** The note just added, for the toast that offers to open it. */
export interface QuickAdded {
  readonly label: string;
  readonly path: VaultPath;
}

export interface QuickAddPorts {
  readonly fs: VaultFsPort;
  readonly markdown: MarkdownPort;
  readonly index: Pick<IndexPort, 'notesOfType'>;
  readonly store: FabAnchorStore;
}

/**
 * The add button's state and what it does: which types it offers, where it
 * rests, which type is being added, and adding it — through `quickAddNote`,
 * from the type's template as capture uses one.
 */
export function useQuickAdd({
  ports,
  setting,
  types,
  templates,
  contentsOf,
  notePaths,
  beside,
  overlay,
  onCreated,
}: {
  ports: QuickAddPorts;
  setting: QuickAddSetting;
  types: readonly ObjectType[];
  templates: readonly NoteTemplate[];
  contentsOf: (template: NoteTemplate) => Promise<string>;
  notePaths: readonly VaultPath[];
  beside: VaultPath | null;
  overlay: { readonly show: (overlay: Overlay) => void; readonly hide: (overlay: Overlay) => void };
  /** A note was added: the tree and the index follow it; `open` when it should be opened. */
  onCreated: (args: { path: VaultPath; open: boolean }) => void;
}) {
  const offered = useMemo(
    () => quickAddChoice({ configured: setting.configured, types }).types,
    [setting.configured, types],
  );
  const [anchor, setAnchor] = useState<FabAnchor>(() => ports.store.read() ?? DEFAULT_FAB_ANCHOR);
  const [chosen, setChosen] = useState<ObjectType | null>(null);
  const [added, setAdded] = useState<QuickAdded | null>(null);
  const choices = useRelationChoices(ports.index, chosen);
  const { show, hide } = overlay;

  const pick = useCallback(
    (name: string) => {
      const type = offered.find((candidate) => candidate.name === name) ?? null;
      if (type === null) return;
      setChosen(type);
      show('quick-add');
    },
    [offered, show],
  );

  /** What the button and its shortcut do: ask for the one type, or offer them all. */
  const start = useCallback(() => {
    const [only, ...others] = offered;
    if (only === undefined) return;
    if (others.length === 0) pick(only.name);
    else show('quick-add-menu');
  }, [offered, pick, show]);

  const add = useCallback(
    async ({ name, values, open }: QuickAddRequest) => {
      if (chosen === null) return;
      const template = findTypeTemplate(templates, chosen);
      const path = await quickAddNote({
        fs: ports.fs,
        markdown: ports.markdown,
        type: chosen,
        name,
        values,
        template: template === null ? null : await contentsOf(template),
        beside,
        notePaths,
      });
      hide('quick-add');
      setAdded(open ? null : { label: chosen.label, path });
      onCreated({ path, open });
    },
    [chosen, templates, ports, contentsOf, beside, notePaths, hide, onCreated],
  );

  const move = useCallback(
    (next: FabAnchor) => {
      setAnchor(next);
      ports.store.write(next);
    },
    [ports.store],
  );

  return {
    offered,
    anchor,
    move,
    chosen,
    fields: chosen === null ? [] : quickAddFields(chosen),
    choices,
    start,
    pick,
    add,
    added,
    dismissAdded: useCallback(() => setAdded(null), []),
  };
}

/** The notes each of a type's relations can point at, read when that type is being added. */
function useRelationChoices(
  index: Pick<IndexPort, 'notesOfType'>,
  type: ObjectType | null,
): Readonly<Record<string, readonly RelationChoice[]>> {
  const [choices, setChoices] = useState<Readonly<Record<string, readonly RelationChoice[]>>>({});
  useEffect(() => {
    const relations = (type === null ? [] : quickAddFields(type)).filter(
      (field) => field.kind === 'relation' && field.target !== null,
    );
    let cancelled = false;
    Promise.all(
      relations.map(
        async (field) =>
          [field.key, await notesInUseOfType({ index, type: field.target ?? '' })] as const,
      ),
    )
      .then((pairs) => {
        if (!cancelled) setChoices(Object.fromEntries(pairs));
      })
      .catch(() => {
        // An index that is not ready yet offers nothing to link rather than failing the add.
        if (!cancelled) setChoices({});
      });
    return () => {
      cancelled = true;
    };
  }, [index, type]);
  return choices;
}
