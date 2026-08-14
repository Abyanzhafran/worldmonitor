/**
 * Reviewed MIIT 2024 cluster → HS mappings.
 * A registry row is not a trade flow. OBSERVED_OFFICIAL only confirms the
 * publisher's cluster/product statement. Numeric trade requires reporter 156
 * plus a reviewed HS mapping.
 */

export const CHINA_COMTRADE_NATIONAL_CAPTION =
  'UN Comtrade reporter 156 is China-level official statistics. It is not a town, corridor, factory, port, or shipment export ledger.';

export const CHINA_FACTORY_EVIDENCE_LEVELS = ['OBSERVED_OFFICIAL', 'UNVERIFIED'] as const;
export type ChinaFactoryEvidenceLevel = (typeof CHINA_FACTORY_EVIDENCE_LEVELS)[number];

export type ChinaFactorySource = Readonly<{
  publisher: string;
  title: string;
  url: string;
  publishedAt: string | null;
}>;

export type ChinaFactoryHsMapping = Readonly<{
  hs2: string;
  label: string;
  evidence: ChinaFactoryEvidenceLevel;
  source: ChinaFactorySource;
}>;

export type ChinaFactoryCluster = Readonly<{
  id: string;
  name: string;
  province: string;
  city: string;
  countyOrDistrict: string;
  productDescription: string;
  clusterEvidence: ChinaFactoryEvidenceLevel;
  source: ChinaFactorySource;
  hsMappings: readonly ChinaFactoryHsMapping[];
  statisticsEligible: boolean;
  statisticsEligibilityReason: string;
}>;

const MIIT_2024: ChinaFactorySource = {
  publisher: 'Ministry of Industry and Information Technology of the PRC',
  title: '2024 characteristic SME industrial cluster list',
  url: 'https://www.miit.gov.cn/',
  publishedAt: '2024-09-20',
};

const HS64: ChinaFactorySource = {
  publisher: 'United Nations Statistics Division',
  title: 'HS 2012 classification detail, code 64: Footwear',
  url: 'https://unstats.un.org/unsd/classifications/Econ/Structure/Detail/EN/32/64',
  publishedAt: null,
};

export const CHINA_FACTORY_CLUSTERS: readonly ChinaFactoryCluster[] = [
  {
    id: 'gd-huidong-footwear',
    name: 'Huidong footwear cluster',
    province: 'Guangdong',
    city: 'Huizhou',
    countyOrDistrict: 'Huidong',
    productDescription: 'Footwear and related parts',
    clusterEvidence: 'OBSERVED_OFFICIAL',
    source: MIIT_2024,
    hsMappings: [{ hs2: '64', label: 'Footwear; gaiters and the like', evidence: 'OBSERVED_OFFICIAL', source: HS64 }],
    statisticsEligible: true,
    statisticsEligibilityReason: 'Reviewed HS 64 mapping exists; Comtrade remains national reporter 156.',
  },
  {
    id: 'zj-yiwu-small-commodities',
    name: 'Yiwu small-commodities reference',
    province: 'Zhejiang',
    city: 'Jinhua',
    countyOrDistrict: 'Yiwu',
    productDescription: 'Mixed small commodities',
    clusterEvidence: 'OBSERVED_OFFICIAL',
    source: MIIT_2024,
    hsMappings: [],
    statisticsEligible: false,
    statisticsEligibilityReason: 'No reviewed HS mapping. Name match must not join national Comtrade.',
  },
];

export function chinaFactoryClusterById(id: string): ChinaFactoryCluster | undefined {
  return CHINA_FACTORY_CLUSTERS.find((cluster) => cluster.id === id);
}

export type ChinaFactoryTradeRecord = {
  reporterCode: string;
  cmdCode: string;
  year: number;
  tradeValueUsd: number;
};

export function selectObservedChinaFactoryTrade(
  records: readonly ChinaFactoryTradeRecord[],
  cluster: ChinaFactoryCluster,
  year?: number,
): ChinaFactoryTradeRecord[] {
  if (!cluster.statisticsEligible) return [];
  const allowed = new Set(cluster.hsMappings.map((item) => item.hs2));
  return records.filter((record) => {
    const reporter = String(record.reporterCode);
    if (reporter !== '156' && reporter !== 'CHN') return false;
    const hs = String(record.cmdCode).replace(/\D/g, '').slice(0, 2);
    if (!allowed.has(hs)) return false;
    if (year != null && record.year !== year) return false;
    return Number.isFinite(record.tradeValueUsd);
  });
}
