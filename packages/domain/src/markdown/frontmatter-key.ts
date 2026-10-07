/**
 * A frontmatter key to be written back as exactly this text — its own lines,
 * comments above it included, as they were once found — rather than rendered
 * from a value. Rendering loses how a value was written: `0x1F` comes back as
 * `31`, `True` as `true`, `archived:` with nothing after it as no key at all.
 *
 * A class, not a shape, so that no value arriving as JSON can pass for one.
 */
export class KeyAsWritten {
  constructor(readonly text: string) {}
}
