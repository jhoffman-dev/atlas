/**
 * What a test outside the package may use of its test support: `@atlas/ui/testing`.
 * `settles` / `drained` are not here but at `@atlas/ui/testing/settles`: they
 * load React (Testing Library's act), and a test that counts renders must
 * install the counter before React loads, which importing them from here would
 * do first.
 */
export {
  installRenderCounter,
  startCountingRenders,
  stopCountingRenders,
  type RenderCounts,
} from './render-counter.ts';
export { tableRowsMeasured } from './table-rows-measured.ts';
