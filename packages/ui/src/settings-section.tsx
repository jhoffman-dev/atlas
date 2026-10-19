import type { ReactNode } from 'react';
import type { SettingsSectionLink } from './settings-section-links.ts';

/**
 * One part of Settings — Connections, Index — as a hairline group under a
 * 15/600 title (UI v2 slice 13f): no card, no icon tile. The heading takes
 * focus when its row in the dialog's list is chosen, so the next Tab lands on
 * the section's first control.
 */
export function SettingsSection({
  section,
  children,
}: {
  /** Names the section for assistive technology, through its heading. */
  section: SettingsSectionLink;
  children: ReactNode;
}) {
  return (
    <section className="settings__section" aria-labelledby={section.id}>
      <h2 className="settings__heading" id={section.id} tabIndex={-1}>
        {section.title}
      </h2>
      {children}
    </section>
  );
}
