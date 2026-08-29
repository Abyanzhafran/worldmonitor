import { getCountryBbox } from '@/services/country-geometry';

export interface CountryMapFocus {
  iso2: string;
  lat: number;
  lon: number;
  zoom: number;
  bbox: [number, number, number, number];
}

/**
 * The dashboard "country-map" command focuses a country by its GeoJSON bbox,
 * not by opening a brief. Keep the zoom buckets here so WebMCP and search
 * cannot drift.
 */
export function focusFromCountryBbox(
  bbox: [number, number, number, number],
): { lat: number; lon: number; zoom: number } {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const lat = (minLat + maxLat) / 2;
  const lon = (minLon + maxLon) / 2;
  const span = Math.max(maxLat - minLat, maxLon - minLon);
  const zoom = span > 40 ? 3 : span > 15 ? 4 : span > 5 ? 5 : 6;
  return { lat, lon, zoom };
}

export function getCountryMapFocus(code: string): CountryMapFocus | null {
  const iso2 = code.toUpperCase();
  const bbox = getCountryBbox(iso2);
  if (!bbox) return null;
  return { iso2, bbox, ...focusFromCountryBbox(bbox) };
}
