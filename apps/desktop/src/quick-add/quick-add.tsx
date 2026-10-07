import { objectTypeIcon, quickAddStartValues, type VaultPath } from '@atlas/domain';
import { FloatingAddButton, QuickAddPopover, sidebarGlyph, Toast } from '@atlas/ui';
import type { Overlay } from '../overlay.ts';
import type { useQuickAdd } from './use-quick-add.ts';

/** What Alt+Cmd+N does, as the button's tooltip shows it. */
export const QUICK_ADD_SHORTCUT = '⌥⌘N';

/**
 * The floating add button, its speed dial and popover, and the toast after an
 * add — drawn from `useQuickAdd`. Both the dial and the popover are overlays,
 * under the rule that only one is ever up.
 */
export function QuickAdd({
  quickAdd,
  overlay,
  onOpen,
}: {
  quickAdd: ReturnType<typeof useQuickAdd>;
  overlay: {
    readonly current: Overlay | null;
    readonly show: (overlay: Overlay) => void;
    readonly hide: (overlay: Overlay) => void;
  };
  onOpen: (path: VaultPath) => void;
}) {
  const { offered, chosen, added } = quickAdd;
  const items = offered.map((type) => ({
    name: type.name,
    label: type.label,
    icon: sidebarGlyph(objectTypeIcon(type)),
  }));
  const popoverOpen = overlay.current === 'quick-add' && chosen !== null;

  return (
    <>
      {items.length > 0 && (
        <FloatingAddButton
          items={items}
          anchor={quickAdd.anchor}
          onMove={quickAdd.move}
          dialOpen={overlay.current === 'quick-add-menu'}
          onDialOpenChange={(open) =>
            open ? overlay.show('quick-add-menu') : overlay.hide('quick-add-menu')
          }
          onPick={quickAdd.pick}
          shortcut={QUICK_ADD_SHORTCUT}
          popover={
            popoverOpen ? (
              <QuickAddPopover
                // A fresh form for each type, rather than one type's values carried to the next.
                key={chosen.name}
                label={chosen.label}
                icon={sidebarGlyph(objectTypeIcon(chosen))}
                fields={quickAdd.fields}
                startValues={quickAddStartValues(quickAdd.fields)}
                choices={quickAdd.choices}
                onAdd={quickAdd.add}
                onClose={() => overlay.hide('quick-add')}
              />
            ) : null
          }
          onPopoverClose={() => overlay.hide('quick-add')}
        />
      )}
      {added !== null && (
        <Toast
          key={added.path}
          message={`${added.label} added`}
          action={{ label: 'Open', onClick: () => onOpen(added.path) }}
          onDismiss={quickAdd.dismissAdded}
        />
      )}
    </>
  );
}
