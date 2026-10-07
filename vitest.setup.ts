/**
 * jsdom performs no layout: every element measures 0x0 and there is no
 * ResizeObserver. A virtualiser asks for both, and without them it concludes the
 * viewport is empty and renders no rows. These shims give it a plausible window
 * so component tests exercise the real rendering path.
 */
if (typeof window !== 'undefined') {
  const VIEWPORT = { width: 280, height: 800 };

  Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      top: 0,
      left: 0,
      bottom: VIEWPORT.height,
      right: VIEWPORT.width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };

  // A virtualiser measures its scroll container with offsetWidth/offsetHeight,
  // which jsdom hardcodes to 0 regardless of any styling.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => VIEWPORT.width,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => VIEWPORT.height,
  });

  Element.prototype.scrollTo = () => {};

  // ProseMirror maps a click back to a document position through this. jsdom has
  // no hit testing, and returning null makes it fall back to its own resolution.
  document.elementFromPoint ??= () => null;

  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
