/**
 * A table sheet jsdom can scroll: 880px tall, its rows 44px, with `scrollTop`
 * held as a browser holds it, and `scrollTo` recording where it was asked to
 * go without the scroll event yet, as a browser does until its next frame.
 * jsdom lays nothing out, so without this a virtualised table draws a fixed
 * window and never reaches a row past it.
 *
 * Test support only: call it inside a `describe`, which it gives a
 * `beforeEach` and an `afterEach`. Installed before the table mounts, since
 * the virtualiser measures its scroller then.
 */
import { afterEach, beforeEach } from 'vitest';
import { fireEvent } from '@testing-library/react';

const SHEET = 'table__sheet';

/** The sheet in the page, and a way to scroll it by hand. */
export interface ScrollableSheet {
  readonly sheetOf: () => HTMLElement;
  /** Scrolls the sheet as a reader's wheel does: the scroll event comes with it. */
  readonly scrollSheet: (sheet: HTMLElement, top: number) => void;
}

export function scrollableSheet(): ScrollableSheet {
  const tops = new WeakMap<Element, number>();
  const real = {
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
    offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
    scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop'),
    scrollTo: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo'),
  };
  beforeEach(() => {
    const isSheet = (element: Element) => element.classList.contains(SHEET);
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        // A row is as tall as the stylesheet makes it, so the virtualiser measures it so.
        if (this.tagName === 'TR') return 44;
        return isSheet(this) ? 880 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return isSheet(this) ? 960 : 0;
      },
    });
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get(this: Element) {
        return tops.get(this) ?? 0;
      },
      set(this: Element, next: number) {
        tops.set(this, next);
      },
    });
    Object.defineProperty(Element.prototype, 'scrollTo', {
      configurable: true,
      value(this: Element, options?: ScrollToOptions) {
        tops.set(this, options?.top ?? tops.get(this) ?? 0);
      },
    });
  });
  afterEach(() => {
    for (const [key, descriptor] of Object.entries(real)) {
      const owner = key.startsWith('offset') ? HTMLElement.prototype : Element.prototype;
      if (descriptor === undefined) Reflect.deleteProperty(owner, key);
      else Object.defineProperty(owner, key, descriptor);
    }
  });
  return {
    sheetOf: () => document.querySelector(`.${SHEET}`) as HTMLElement,
    scrollSheet: (sheet, top) => {
      sheet.scrollTop = top;
      fireEvent.scroll(sheet);
    },
  };
}
