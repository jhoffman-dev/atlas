import type { TemplateUse } from '@dfai/domain';

/** What each use of a template is called, for a person. Not a hook: a use of a template. */
function nameOfUse(use: TemplateUse): string {
  switch (use.kind) {
    case 'type':
      return `New ${use.typeLabel} notes`;
    case 'daily':
      return 'Today’s note';
    case 'capture':
      return 'Captured tasks';
    case 'artifact':
      return 'Saved artifacts';
  }
}

/** Everything that makes notes from a template, or that only the New menu offers it. */
export function templateUsesText(uses: readonly TemplateUse[]): string {
  return uses.length === 0 ? 'Only the New menu' : uses.map(nameOfUse).join(', ');
}

/** What starts with nothing once these uses lose their template, or null when none do. */
export function lostUsesText(lost: readonly TemplateUse[]): string | null {
  if (lost.length === 0) return null;
  // A type's notes still get their type; the others are bare notes.
  const sentence = (use: TemplateUse) =>
    `${nameOfUse(use)} will start ${use.kind === 'type' ? 'empty' : 'blank'}.`;
  return lost.map(sentence).join(' ');
}
