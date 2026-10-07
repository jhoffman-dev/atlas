/**
 * A change to a note's body, as the model proposes it: exact spans of the
 * text and what each becomes. Everything outside the spans keeps its bytes,
 * which is what makes the proposal safe to show and to write (ADR-0021).
 */
export interface TextEdit {
  readonly find: string;
  readonly replace: string;
}

export type EditOutcome =
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly problem: string };

/**
 * Applies every edit to `text` at once. Each `find` must occur exactly once in
 * the text as it is — not as the edits before it left it — and no two may
 * overlap, so the order the model listed them in cannot change the result.
 */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): EditOutcome {
  const located: { at: number; edit: TextEdit }[] = [];
  for (const edit of edits) {
    const found = locate(text, edit.find);
    if (typeof found === 'string') return { ok: false, problem: found };
    located.push({ at: found, edit });
  }
  located.sort((a, b) => a.at - b.at);

  let result = '';
  let cursor = 0;
  for (const { at, edit } of located) {
    if (at < cursor) return { ok: false, problem: 'Two edits change the same text.' };
    result += text.slice(cursor, at) + edit.replace;
    cursor = at + edit.find.length;
  }
  return { ok: true, text: result + text.slice(cursor) };
}

/** Where `find` is, or why it cannot be used. */
function locate(text: string, find: string): number | string {
  if (find === '') return 'An edit must name the text it changes; "find" was empty.';
  const at = text.indexOf(find);
  if (at === -1) return `The note has no text ${quoted(find)}; read it again and copy it exactly.`;
  if (text.indexOf(find, at + 1) !== -1) {
    return `${quoted(find)} occurs more than once; include more of the text around it.`;
  }
  return at;
}

function quoted(text: string): string {
  const short = text.length > 60 ? `${text.slice(0, 57)}…` : text;
  return JSON.stringify(short);
}
