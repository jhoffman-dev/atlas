/**
 * What a link points at — its note, heading and alias — as HTML attributes,
 * written and read back (A22-01). ProseMirror copies a slice as the schema's
 * HTML and parses it again on paste, even within one note, so an attribute
 * that is only rendered, never parsed, is lost on the way.
 *
 * `target` is written as `targetAttribute` (`data-wikilink`, `data-bookmark`),
 * never as `target`, which on a link names a browser window.
 */
export function linkAttributes(targetAttribute: string) {
  return {
    target: {
      default: '',
      parseHTML: (element: HTMLElement) => element.getAttribute(targetAttribute) ?? '',
      renderHTML: (attrs: Record<string, unknown>) => ({
        [targetAttribute]: String(attrs['target'] ?? ''),
      }),
    },
    heading: optionalAttribute('heading', 'data-heading'),
    alias: optionalAttribute('alias', 'data-alias'),
  };
}

/** An attribute that is null when the link does not say it, and then not written. */
function optionalAttribute(name: string, attribute: string) {
  return {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute(attribute),
    renderHTML: (attrs: Record<string, unknown>) => {
      const value = attrs[name];
      return typeof value === 'string' ? { [attribute]: value } : {};
    },
  };
}
