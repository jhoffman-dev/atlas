import type { Widget } from '@atlas/domain';
import { Icon, widgetGlyph } from '../icon.tsx';

/** One number, centred on a small raised tile: its glyph, the value, its title under it. */
export function NumberTile({ widget, value }: { widget: Widget; value: string }) {
  return (
    <div className="stat">
      <Icon name={widgetGlyph(widget.icon ?? 'hash')} size={20} className="stat__icon" />
      <p className="stat__value">{value}</p>
      <p className="stat__label">{widget.title}</p>
    </div>
  );
}
