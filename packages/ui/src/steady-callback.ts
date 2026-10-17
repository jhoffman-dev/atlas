import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * `act` behind a function that stays the same from one render to the next,
 * and calls the `act` of the latest render. For a callback handed to rows
 * drawn with `memo`: a parent that makes a new one on each render would
 * otherwise draw every row again for it (#217).
 *
 * Not for calling while rendering — the latest `act` is in place once the
 * render is committed — only from an event or an effect.
 */
export function useSteadyCallback<Args extends unknown[], Result>(
  act: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(act);
  useLayoutEffect(() => {
    latest.current = act;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
