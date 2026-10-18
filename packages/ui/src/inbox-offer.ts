/** What every Inbox offer says besides its own content. */
export interface InboxOfferReading {
  /**
   * The vault is still being read for it, so whether there is anything to
   * offer is not known yet. Not shown: the Inbox holds its rows back until
   * every offer is known, or a short while has passed, so that no offer lands
   * above rows already under the pointer (#130).
   */
  readonly reading?: boolean;
}
