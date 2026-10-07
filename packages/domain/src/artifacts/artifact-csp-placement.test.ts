// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ARTIFACT_CSP, withArtifactCsp } from './artifact-inline.ts';

/*
 * The policy only governs a page when the parser puts Atlas's `<meta>` in the
 * document's head, ahead of anything that can run or load. These parse the
 * page the way the frame will (a string, as `srcdoc` is) and look at where the
 * meta actually landed, rather than at the text around it.
 */

function parsed(html: string): { doc: Document; meta: Element | null } {
  const doc = new DOMParser().parseFromString(withArtifactCsp(html), 'text/html');
  const meta =
    [...doc.querySelectorAll('meta')].find(
      (element) => element.getAttribute('content') === ARTIFACT_CSP,
    ) ?? null;
  return { doc, meta };
}

/** True when the meta is the head's first element and precedes every script in the document. */
function governs(html: string): boolean {
  const { doc, meta } = parsed(html);
  if (meta === null || doc.head.firstElementChild !== meta) return false;
  return [...doc.querySelectorAll('script, link, img, style')].every(
    (element) =>
      element === meta ||
      (meta.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
}

describe('withArtifactCsp puts the policy where the parser honours it', () => {
  it('governs a well-formed page (control)', () => {
    expect(governs('<!doctype html><html><head><title>t</title></head><body></body></html>')).toBe(
      true,
    );
  });

  it('is not fooled by a <head> inside a comment before the real head', () => {
    expect(
      governs(
        '<!doctype html><!-- <head> --><html><head><title>t</title></head>' +
          '<body><script>new Image().src="https://x.test/"</script></body></html>',
      ),
    ).toBe(true);
  });

  it('is not fooled by <head> inside an attribute value', () => {
    expect(
      governs('<!doctype html><html lang="<head>"><head></head><body><script>1</script></body>'),
    ).toBe(true);
  });

  it('is not fooled by a > inside an attribute of the head tag', () => {
    expect(
      governs('<!doctype html><html><head data-x="a>b"><script>1</script></head></html>'),
    ).toBe(true);
  });

  it('comes before a script that precedes the <head> tag', () => {
    // The parser opens the head implicitly for the script, which runs before any later meta.
    expect(
      governs('<!doctype html><script>new Image().src="https://x.test/"</script><head></head>'),
    ).toBe(true);
  });

  it('is not put in the body when content precedes a late <head> tag', () => {
    expect(governs('<!doctype html><p>hi</p><head></head><script>1</script>')).toBe(true);
  });

  it('is not put in the body by a custom element whose name starts with head-', () => {
    expect(governs('<body><head-line>x</head-line><script>1</script></body>')).toBe(true);
  });
});
