/**
 * Pieces of a statement that carry their own bound values, so a statement
 * built from them binds its `?`s in the order they appear — however the
 * pieces were nested to make it.
 *
 * Only a {@link Fragment} can be put into another, so a value from a query can
 * reach the statement only through {@link bound}: the one way in is the safe one.
 */

export type BoundValue = string | number;

export interface Fragment {
  readonly text: string;
  readonly values: readonly BoundValue[];
}

/** A value, as a placeholder the index binds. */
export function bound(value: BoundValue): Fragment {
  return { text: '?', values: [value] };
}

/** Text of the statement itself: a constant of the app, never anything from a query. */
export function fixed(text: string): Fragment {
  return { text, values: [] };
}

/** `sql\`a = ${bound(1)}\``: the text around fragments, and theirs, in order. */
export function sql(strings: TemplateStringsArray, ...parts: readonly Fragment[]): Fragment {
  let text = strings[0] ?? '';
  const values: BoundValue[] = [];
  parts.forEach((part, at) => {
    text += part.text + (strings[at + 1] ?? '');
    values.push(...part.values);
  });
  return { text, values };
}

export function joined(parts: readonly Fragment[], separator: string): Fragment {
  return {
    text: parts.map((part) => part.text).join(separator),
    values: parts.flatMap((part) => part.values),
  };
}
