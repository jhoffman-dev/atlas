/**
 * How an email address is compared, everywhere a person is found by one —
 * meeting import, a merge of people, the possible-duplicates list (#464) —
 * so a merge never keeps an address import would read as another, nor drops
 * one it would read as theirs.
 */

/** The address itself: the part in `<…>` when written as a mail client copies it, composed and trimmed. */
function writtenAddress(written: string): string {
  const bracketed = /<([^<>]+)>\s*$/u.exec(written)?.[1] ?? written;
  return bracketed.normalize('NFC').trim();
}

/**
 * An address as two are the same one: written alike once its case and the
 * spaces round it are set aside. `mara+payroll@` is not `mara@` here: it is
 * kept as its own address, and only matched to `mara@` by {@link untaggedAddressKey}.
 */
export function addressKey(written: string): string {
  return writtenAddress(written).toLowerCase();
}

/** A domain as written in a note or an address: `@`, `www.`, a scheme, a path and a final dot dropped. */
export function hostKey(written: string): string {
  return written
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//u, '')
    .replace(/[/?#].*$/u, '')
    .replace(/:\d*$/u, '')
    .replace(/^@/u, '')
    .replace(/^www\./u, '')
    .replace(/\.$/u, '');
}

/** An address split for comparing: its local part, its `+tag` dropped, and its domain, both folded. */
export interface AddressParts {
  readonly local: string;
  readonly domain: string;
}

/** {@link AddressParts} of an address, or null for text with no `@` or nothing either side. */
export function addressParts(written: string): AddressParts | null {
  const address = addressKey(written);
  const at = address.lastIndexOf('@');
  if (at <= 0) return null;
  const local = (address.slice(0, at).split('+')[0] ?? '').trim();
  const domain = hostKey(address.slice(at + 1));
  return local === '' || domain === '' ? null : { local, domain };
}

/**
 * The mailbox an address reaches, its `+tag` dropped: `mara+payroll@larkspur.example`
 * is `mara@larkspur.example`. What finds a person when no address of theirs
 * is written exactly so. Null for text that is not an address.
 */
export function untaggedAddressKey(written: string): string | null {
  const parts = addressParts(written);
  return parts === null ? null : `${parts.local}@${parts.domain}`;
}
