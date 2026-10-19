import { act } from '@testing-library/react';

/**
 * A stand-in for layout in jsdom, which lays nothing out: each element that
 * matches `blocks` is a band `height` tall, stacked in document order inside
 * the element matching `scroller`, which shows `viewport` of them and
 * scrolls. Any other element sits where its nearest band does. An element's
 * `style.height` in px, if set, is its own height instead (the room a list
 * anchor gives below the page). ResizeObservers are fired by `flush`, as the
 * browser would after a layout, rather than on their own.
 *
 * Test support only.
 */
export interface FakeLayout {
  /** Runs every ResizeObserver, as after a layout. */
  flush(): void;
  /** Where `element` is on screen: its band's top, less how far the scroller is scrolled. */
  topOf(element: Element): number;
  readonly scroller: () => HTMLElement;
  restore(): void;
}

export function installFakeLayout({
  blocks,
  scroller,
  height = 50,
  viewport = 200,
}: {
  blocks: string;
  scroller: string;
  height?: number;
  viewport?: number;
}): FakeLayout {
  const scrolled = new WeakMap<Element, number>();
  const observers = new Set<{ callback: ResizeObserverCallback; observer: ResizeObserver }>();
  const area = () => {
    const found = document.querySelector<HTMLElement>(scroller);
    if (found === null) throw new Error(`no ${scroller}`);
    return found;
  };
  const sized = (element: Element) =>
    element instanceof HTMLElement && element.style.height.endsWith('px')
      ? Number.parseFloat(element.style.height)
      : null;
  const bands = () =>
    [...area().querySelectorAll('*')].filter(
      (element) => element.matches(blocks) || sized(element) !== null,
    );
  const bandOf = (element: Element) => {
    for (let at: Element | null = element; at !== null; at = at.parentElement) {
      if (at.matches(blocks) || sized(at) !== null) return at;
    }
    return null;
  };
  /** Where the band starts in the scroller's content, and how tall it is. */
  const placeOf = (band: Element) => {
    let top = 0;
    for (const each of bands()) {
      if (each === band) return { top, height: sized(each) ?? height };
      top += sized(each) ?? height;
    }
    return { top: 0, height: 0 };
  };
  const content = () => bands().reduce((sum, band) => sum + (sized(band) ?? height), 0);

  const proto = HTMLElement.prototype;
  const saved = {
    rect: Element.prototype.getBoundingClientRect,
    scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop'),
    scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight'),
    clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'),
    scrollTo: proto.scrollTo,
    observer: globalThis.ResizeObserver,
  };
  const isArea = (element: Element) => element.matches(scroller);
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    const band = isArea(this) ? null : bandOf(this);
    const place = band === null ? { top: 0, height: isArea(this) ? viewport : 0 } : placeOf(band);
    const top = band === null ? 0 : place.top - (scrolled.get(area()) ?? 0);
    return new DOMRect(0, top, 100, place.height);
  };
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return scrolled.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      const most = isArea(this) ? Math.max(0, content() - viewport) : 0;
      scrolled.set(this, Math.min(Math.max(0, value), most));
      this.dispatchEvent(new Event('scroll'));
    },
  });
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Element) {
      return isArea(this) ? Math.max(content(), viewport) : 0;
    },
  });
  Object.defineProperty(Element.prototype, 'clientHeight', {
    configurable: true,
    get(this: Element) {
      return isArea(this) ? viewport : 0;
    },
  });
  proto.scrollTo = function scrollTo(this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === 'object') this.scrollTop = options.top ?? this.scrollTop;
  } as typeof proto.scrollTo;
  globalThis.ResizeObserver = class {
    private readonly entry: { callback: ResizeObserverCallback; observer: ResizeObserver };
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, observer: this as unknown as ResizeObserver };
    }
    observe() {
      observers.add(this.entry);
    }
    unobserve() {}
    disconnect() {
      observers.delete(this.entry);
    }
  };

  return {
    flush: () =>
      act(() => {
        for (const { callback, observer } of [...observers]) callback([], observer);
      }),
    topOf: (element) => element.getBoundingClientRect().top,
    scroller: area,
    restore: () => {
      Element.prototype.getBoundingClientRect = saved.rect;
      for (const name of ['scrollTop', 'scrollHeight', 'clientHeight'] as const) {
        const descriptor = saved[name];
        if (descriptor === undefined) Reflect.deleteProperty(Element.prototype, name);
        else Object.defineProperty(Element.prototype, name, descriptor);
      }
      proto.scrollTo = saved.scrollTo;
      globalThis.ResizeObserver = saved.observer;
    },
  };
}
