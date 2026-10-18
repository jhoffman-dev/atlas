/** What every Inbox offer says besides its own content. */
export interface InboxOfferReading {
  /**
   * The vault is still being read for it, so whether there is anything to
   * offer is not known yet. Not shown: the Inbox holds its rows back until
   * every offer is known, or a short while has passed, so that no offer lands
   * above rows already under the pointer (#130).
   */
  readonly reading?: boolean;
  /**
   * Still read only once the vault's index is ready, as on a vault just
   * opened. The rows are held for as long as that takes, with no time limit:
   * the Inbox's list is the index's answer too, so it has no rows to hold back
   * until then. Set only with `reading`.
   */
  readonly waitingForIndex?: boolean;
}
