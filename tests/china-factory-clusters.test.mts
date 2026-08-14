import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CHINA_COMTRADE_NATIONAL_CAPTION,
  CHINA_FACTORY_CLUSTERS,
  chinaFactoryClusterById,
  selectObservedChinaFactoryTrade,
} from '../shared/china-factory-clusters.ts';

describe('china factory cluster registry', () => {
  it('keeps national Comtrade caption from claiming town-level exports', () => {
    assert.match(CHINA_COMTRADE_NATIONAL_CAPTION, /reporter 156/);
    assert.match(CHINA_COMTRADE_NATIONAL_CAPTION, /not a town/);
  });

  it('joins eligible clusters only on reporter 156 and reviewed HS', () => {
    const huidong = chinaFactoryClusterById('gd-huidong-footwear');
    assert.ok(huidong?.statisticsEligible);
    const rows = selectObservedChinaFactoryTrade([
      { reporterCode: '156', cmdCode: '64', year: 2024, tradeValueUsd: 1_000 },
      { reporterCode: '842', cmdCode: '64', year: 2024, tradeValueUsd: 9_000 },
      { reporterCode: '156', cmdCode: '27', year: 2024, tradeValueUsd: 2_000 },
    ], huidong);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.tradeValueUsd, 1_000);
  });

  it('refuses a numeric join when HS is unreviewed, even if names look unique', () => {
    const yiwu = chinaFactoryClusterById('zj-yiwu-small-commodities');
    assert.ok(yiwu);
    assert.equal(yiwu.statisticsEligible, false);
    const rows = selectObservedChinaFactoryTrade([
      { reporterCode: '156', cmdCode: '64', year: 2024, tradeValueUsd: 1_000 },
    ], yiwu);
    assert.deepEqual(rows, []);
  });

  it('does not merge two clusters that share a product word', () => {
    const names = CHINA_FACTORY_CLUSTERS.filter((cluster) => /commodit|footwear/i.test(cluster.productDescription));
    assert.ok(names.length >= 1);
    const eligible = names.filter((cluster) => cluster.statisticsEligible);
    for (const cluster of names) {
      if (!cluster.statisticsEligible) {
        assert.equal(cluster.hsMappings.length, 0);
        assert.ok(!eligible.some((item) => item.id === cluster.id));
      }
    }
  });
});
