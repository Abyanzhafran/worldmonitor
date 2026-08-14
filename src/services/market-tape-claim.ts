/**
 * Tape Claim: the label a market surface may show for a quote, bar, or stream.
 * A configured provider key is not a tape. Licensed-live requires a separate
 * commercial display/rebroadcast confirmation that no current source has.
 *
 * Distinct from Panel.setDataBadge('live'), which means a fresh fetch vs cache.
 */

export const TAPE_CLAIMS = [
  'unconfigured',
  'delayed_unverified',
  'end_of_day',
  'historical',
  'stale',
  'licensed_live',
] as const;

export type TapeClaim = (typeof TAPE_CLAIMS)[number];

export type MarketTapeSource = 'yahoo' | 'finnhub' | 'seed';

export type MarketTapeClaimInput = {
  source: MarketTapeSource;
  keyConfigured: boolean;
  /** Must be the operator's confirmed display/rebroadcast right, not key presence. */
  realtimeDisplayConfirmed?: boolean;
};

const TAPE_CLAIM_LABEL: Record<TapeClaim, string> = {
  unconfigured: 'Data source not configured',
  delayed_unverified: 'Delayed / unverified',
  end_of_day: 'End of day',
  historical: 'Historical snapshot',
  stale: 'Stale',
  licensed_live: 'Licensed live',
};

export function tapeClaimLabel(claim: TapeClaim): string {
  return TAPE_CLAIM_LABEL[claim];
}

/**
 * Resolve the honest tape claim for a market source.
 * Yahoo is never licensed-live. Finnhub/seed with a key stay delayed unless
 * an explicit rebroadcast confirmation is set — and no first-party source
 * currently accepts that confirmation.
 */
export function tapeClaimForMarketSource(input: MarketTapeClaimInput): TapeClaim {
  const { source, keyConfigured, realtimeDisplayConfirmed } = input;

  if (source === 'yahoo') {
    return 'delayed_unverified';
  }

  if (!keyConfigured) {
    return 'unconfigured';
  }

  if (realtimeDisplayConfirmed === true) {
    return 'licensed_live';
  }

  if (source === 'seed') {
    return 'historical';
  }

  return 'delayed_unverified';
}

export function isLicensedLiveTape(claim: TapeClaim): boolean {
  return claim === 'licensed_live';
}
