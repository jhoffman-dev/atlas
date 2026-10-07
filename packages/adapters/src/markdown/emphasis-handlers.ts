import type { Emphasis, Nodes, Parents, Strong } from 'mdast';
import { defaultHandlers, type Info, type State } from 'mdast-util-to-markdown';

/**
 * Italic and bold that sit side by side, written so they read back apart
 * (A21-03). Remark writes both with `*`, and `*a*` then `**b**` is
 * `*a***b**`: markdown reads a run of three stars as one delimiter, and the
 * text comes back with stars in it and a mark gone. The second of two
 * neighbours is written with `_` instead — `*a*__b__` — and a third with `*`
 * again. Remark's own handlers do the writing, with the marker set for the
 * one node, so its care over which characters to encode still applies.
 */
export const writeEmphasis = alternating('emphasis');
export const writeStrong = alternating('strong');

type Attention = Emphasis | Strong;

const isAttention = (node: Nodes | undefined): node is Attention =>
  node?.type === 'emphasis' || node?.type === 'strong';

/** Whether `node` follows a neighbour written with `*`, and so takes `_`. */
function followsStar(node: Attention, parent: Parents | undefined): boolean {
  const siblings = (parent?.children ?? []) as Nodes[];
  const at = siblings.indexOf(node);
  const previous = at > 0 ? siblings[at - 1] : undefined;
  return isAttention(previous) && !followsStar(previous, parent);
}

function alternating(option: 'emphasis' | 'strong') {
  const base = defaultHandlers[option] as (
    node: Attention,
    parent: Parents | undefined,
    state: State,
    info: Info,
  ) => string;
  const marker = (node: Attention, parent: Parents | undefined) =>
    followsStar(node, parent) ? '_' : '*';
  const handler = (node: Attention, parent: Parents | undefined, state: State, info: Info) => {
    const before = state.options[option];
    state.options[option] = marker(node, parent);
    try {
      return base(node, parent, state, info);
    } finally {
      state.options[option] = before;
    }
  };
  handler.peek = (node: Attention, parent: Parents | undefined) => marker(node, parent);
  return handler;
}
