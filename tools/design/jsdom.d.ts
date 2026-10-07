// jsdom ships no types, and the design tools need only this much of it: a
// window whose DOMParser the renderer is handed.
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string);
    readonly window: Window & typeof globalThis;
  }
}
