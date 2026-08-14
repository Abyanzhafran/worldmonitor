// #6626 — aviation_closure / notam_closure must carry lat/lon/city so
// proximity alerting can treat an airport as a declared site.
//
// Expected coordinates are literals from src/config/airports.ts (the
// registry the issue names), not recomputed from the helper under test.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  airportNotifyLocation,
  resolveAirportNotifyLocation,
} from '../scripts/seed-aviation.mjs';

const aviationSrc = readFileSync(
  fileURLToPath(new URL('../scripts/seed-aviation.mjs', import.meta.url)),
  'utf8',
);

// Toronto Pearson — aviationstack + notam row; seeder already has coords.
const YYZ = { city: 'Toronto', lat: 43.6777, lon: -79.6248 };
// JFK — FAA seeder row has city but no lat/lon; airports.ts does.
const JFK = { city: 'New York', lat: 40.6413, lon: -73.7781 };

describe('airportNotifyLocation', () => {
  it('copies city/lat/lon from a registry row', () => {
    assert.deepEqual(
      airportNotifyLocation({ city: 'Toronto', lat: 43.6777, lon: -79.6248 }),
      YYZ,
    );
  });

  it('reads alert-envelope location.latitude/longitude', () => {
    assert.deepEqual(
      airportNotifyLocation({
        city: 'Toronto',
        location: { latitude: 43.6777, longitude: -79.6248 },
      }),
      YYZ,
    );
  });

  it('omits 0,0 placeholders so proximity never treats the Gulf of Guinea as JFK', () => {
    assert.deepEqual(
      airportNotifyLocation({
        city: 'New York',
        location: { latitude: 0, longitude: 0 },
      }),
      { city: 'New York' },
    );
  });

  it('returns {} for a missing row', () => {
    assert.deepEqual(airportNotifyLocation(null), {});
    assert.deepEqual(airportNotifyLocation(undefined), {});
  });
});

describe('resolveAirportNotifyLocation — keyed by the existing IATA/ICAO lookup', () => {
  it('YYZ / CYYZ carries Toronto Pearson coordinates from the already-resolved row', () => {
    assert.deepEqual(resolveAirportNotifyLocation({ iata: 'YYZ' }), YYZ);
    assert.deepEqual(resolveAirportNotifyLocation({ icao: 'CYYZ' }), YYZ);
  });

  it('JFK / KJFK fills lat/lon from src/config/airports.ts when the seeder row has none', () => {
    assert.deepEqual(resolveAirportNotifyLocation({ iata: 'JFK' }), JFK);
    assert.deepEqual(resolveAirportNotifyLocation({ icao: 'KJFK' }), JFK);
  });

  it('prefers the already-resolved row and does not require a second find', () => {
    assert.deepEqual(
      resolveAirportNotifyLocation({
        iata: 'YYZ',
        row: { iata: 'YYZ', icao: 'CYYZ', city: 'Toronto', lat: 43.6777, lon: -79.6248 },
      }),
      YYZ,
    );
  });

  it('returns {} for an airport neither registry knows', () => {
    assert.deepEqual(resolveAirportNotifyLocation({ icao: 'XXXX' }), {});
  });
});

describe('#6626 — both closure publishers thread the site fields', () => {
  it('aviation_closure spreads resolveAirportNotifyLocation into the payload', () => {
    assert.match(
      aviationSrc,
      /eventType:\s*'aviation_closure'[\s\S]{0,800}?\.\.\.resolveAirportNotifyLocation\(/,
      'aviation_closure must spread resolveAirportNotifyLocation(...) so lat/lon/city ride the existing airport row',
    );
  });

  it('notam_closure reuses the ICAO registry row and spreads the same helper', () => {
    assert.match(
      aviationSrc,
      /const airport = AIRPORTS\.find\(a => a\.icao === icao\)/,
      'notam_closure must capture the existing ICAO lookup once (no second resolution)',
    );
    assert.match(
      aviationSrc,
      /eventType:\s*'notam_closure'[\s\S]{0,800}?\.\.\.resolveAirportNotifyLocation\(/,
      'notam_closure must spread resolveAirportNotifyLocation(...) keyed by the ICAO already resolved for country',
    );
    assert.match(
      aviationSrc,
      /resolveAirportNotifyLocation\(\{\s*icao,\s*row:\s*airport\s*\}\)/,
      'notam_closure must pass the already-found airport row into the helper',
    );
  });
});
