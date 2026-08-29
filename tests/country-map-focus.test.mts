import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { focusFromCountryBbox, getCountryMapFocus } from '../src/app/country-map-focus.ts';

describe('country map focus zoom buckets', () => {
  it('centers the bbox and uses the dashboard country-map zoom buckets', () => {
    assert.deepEqual(focusFromCountryBbox([-10, 0, 40, 50]), {
      lat: 25,
      lon: 15,
      zoom: 3,
    });
    assert.deepEqual(focusFromCountryBbox([0, 0, 20, 16]), {
      lat: 8,
      lon: 10,
      zoom: 4,
    });
    assert.deepEqual(focusFromCountryBbox([0, 0, 8, 6]), {
      lat: 3,
      lon: 4,
      zoom: 5,
    });
    assert.deepEqual(focusFromCountryBbox([8, 50, 10, 52]), {
      lat: 51,
      lon: 9,
      zoom: 6,
    });
  });

  it('returns null for an unknown ISO2 while geometry is unloaded', () => {
    assert.equal(getCountryMapFocus('XX'), null);
    assert.equal(getCountryMapFocus('de'), null);
  });
});
