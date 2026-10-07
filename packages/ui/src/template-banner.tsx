import type { TemplateUse } from '@atlas/domain';
import { Icon } from './icon.tsx';
import { templateUsesText } from './template-words.ts';

/** What a template's page says about the template, and the way to all of them. */
export interface TemplateNotice {
  readonly uses: readonly TemplateUse[];
  readonly onOpenTemplates: () => void;
  /** Asks to turn the template into one of the vault's notes, for one that was a note all along. */
  readonly onMoveToNotes: () => void;
}

/**
 * The band over a template being edited, so it is never taken for a note:
 * it says this is a template, what is made from it, and that editing it
 * touches no note already made.
 */
export function TemplateBanner({ uses, onOpenTemplates, onMoveToNotes }: TemplateNotice) {
  return (
    <aside className="template-banner" aria-label="Template">
      <Icon name="template" size={16} className="template-banner__icon" />
      <p className="template-banner__text">
        <strong>Template</strong> · Used for: {templateUsesText(uses)}. Editing it changes what new
        notes start as — never the notes already made.
      </p>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onMoveToNotes}>
        Move to notes…
      </button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onOpenTemplates}>
        All templates
      </button>
    </aside>
  );
}
