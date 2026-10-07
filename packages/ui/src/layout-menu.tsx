import { Menu } from '@base-ui/react/menu';
import { layoutLabel, viewIcon, type LayoutChoice, type ViewLayout } from '@atlas/domain';
import { Icon, sidebarGlyph } from './icon.tsx';
import type { OverlaySlot } from './overlay-slot.ts';

/**
 * The toolbar's Layout control: every way the view can be drawn, the current
 * one ticked. One the type cannot draw — a calendar with no date to place
 * notes on — is listed, disabled, with what it would need, so it is clear why
 * rather than simply missing. Focus, typeahead and Escape are Base UI's.
 */
export function LayoutMenu({
  choices,
  current,
  onChoose,
  slot,
}: {
  choices: readonly LayoutChoice[];
  current: ViewLayout;
  onChoose: (layout: ViewLayout) => void;
  slot?: OverlaySlot | undefined;
}) {
  return (
    <Menu.Root {...slot}>
      {/* Named "Layout" alone: the current one is the checked item inside, and a
          name holding it would answer to a search for the layout's own region. */}
      <Menu.Trigger className="view-toolbar__button" data-layout={current}>
        <Icon name={sidebarGlyph(viewIcon(current))} size={16} />
        Layout
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="menu-positioner" side="bottom" align="end" sideOffset={6}>
          <Menu.Popup className="menu layout-menu" aria-label="Layout">
            <Menu.RadioGroup
              value={current}
              onValueChange={(chosen: ViewLayout) => {
                if (chosen !== current) onChoose(chosen);
              }}
            >
              {choices.map((choice) => (
                <Menu.RadioItem
                  key={choice.layout}
                  value={choice.layout}
                  label={layoutLabel(choice.layout)}
                  disabled={!choice.available}
                  closeOnClick
                  className="layout-menu__item"
                >
                  <Icon name={sidebarGlyph(viewIcon(choice.layout))} size={16} />
                  <span className="layout-menu__words">
                    <span className="menu__label">{layoutLabel(choice.layout)}</span>
                    {choice.reason !== null && (
                      <span className="layout-menu__reason">{choice.reason}</span>
                    )}
                  </span>
                  <Menu.RadioItemIndicator className="layout-menu__current">
                    <Icon name="check" size={14} />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
