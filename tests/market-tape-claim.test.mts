import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { RUNTIME_FEATURES } from '../src/services/runtime-config.ts';
import {
  isLicensedLiveTape,
  tapeClaimForMarketSource,
  tapeClaimLabel,
} from '../src/services/market-tape-claim.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('tapeClaimForMarketSource', () => {
  it('treats Yahoo as delayed even when a key exists', () => {
    assert.equal(
      tapeClaimForMarketSource({ source: 'yahoo', keyConfigured: true }),
      'delayed_unverified',
    );
    assert.equal(
      isLicensedLiveTape(tapeClaimForMarketSource({ source: 'yahoo', keyConfigured: true })),
      false,
    );
  });

  it('treats a missing Finnhub key as unconfigured, not a live outage', () => {
    assert.equal(
      tapeClaimForMarketSource({ source: 'finnhub', keyConfigured: false }),
      'unconfigured',
    );
    assert.equal(
      tapeClaimLabel(tapeClaimForMarketSource({ source: 'finnhub', keyConfigured: false })),
      'Data source not configured',
    );
  });

  it('does not promote a configured Finnhub key to licensed-live', () => {
    assert.equal(
      tapeClaimForMarketSource({ source: 'finnhub', keyConfigured: true }),
      'delayed_unverified',
    );
  });

  it('labels seeded quotes historical when the seed path is configured', () => {
    assert.equal(
      tapeClaimForMarketSource({ source: 'seed', keyConfigured: true }),
      'historical',
    );
  });

  it('requires an explicit rebroadcast confirmation for licensed-live', () => {
    assert.equal(
      tapeClaimForMarketSource({
        source: 'finnhub',
        keyConfigured: true,
        realtimeDisplayConfirmed: true,
      }),
      'licensed_live',
    );
    assert.equal(
      tapeClaimForMarketSource({
        source: 'yahoo',
        keyConfigured: true,
        realtimeDisplayConfirmed: true,
      }),
      'delayed_unverified',
    );
  });
});

describe('Tape Claim copy', () => {
  it('does not describe Finnhub as a live tape in runtime-config', () => {
    const feature = RUNTIME_FEATURES.find((item) => item.id === 'finnhubMarkets');
    assert.ok(feature);
    assert.match(feature.description, /delayed|seeded/i);
    assert.doesNotMatch(feature.description, /real-?time/i);
  });

  it('does not claim a live tape in English market settings copy', () => {
    const en = readFileSync(join(root, 'src/locales/en.json'), 'utf8');
    assert.match(en, /Delayed or seeded stock quotes/);
    assert.doesNotMatch(en, /"FINNHUB_API_KEY": "Real-time stock quotes/);
    assert.doesNotMatch(en, /Markets<\/strong> Real-time stock indices/);
  });
});
