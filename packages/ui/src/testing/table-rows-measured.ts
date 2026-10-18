/**
 * Table rows measure as the stylesheet makes them. jsdom performs no layout
 * and the shim in vitest.setup.ts measures every element a window tall, so a
 * virtualised table would draw one row and its overscan; with its rows at
 * their real height it draws a screenful, as it does in the app.
 */
import { afterEach, beforeEach } from 'vitest';
import { ROW_ESTIMATE } from '../grouped-rows.tsx';

export function tableRowsMeasured(): void {
  const real = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (this.tagName === 'TR') return ROW_ESTIMATE;
        return real?.get?.call(this) ?? 0;
      },
    });
  });
  afterEach(() => {
    if (real === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight');
    else Object.defineProperty(HTMLElement.prototype, 'offsetHeight', real);
  });
}
