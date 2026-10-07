import type { ReactNode } from 'react';
import { Icon, type IconName } from './icon.tsx';

/** One part of Settings, as a card with an icon and a title — Connections, Index. */
export function SettingsCard({
  id,
  icon,
  title,
  children,
}: {
  /** Names the section for assistive technology, through its heading. */
  id: string;
  icon: IconName;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="settings__card" aria-labelledby={id}>
      <h2 className="settings__heading" id={id}>
        <span className="settings__heading-icon">
          <Icon name={icon} size={16} />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}
