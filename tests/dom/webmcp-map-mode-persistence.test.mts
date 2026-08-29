/**
 * Persistence proof for the WebMCP `set_map_mode` cancellation gate (#7321).
 *
 * The policy classifies `set_map_mode` as cancellation-required because it
 * writes STORAGE_KEYS.mapMode, and a globe switch can also persist a
 * resilienceScore compatibility change. WebMCP unit tests stub the final
 * action, so they never reach those writes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyVisibleMapDimension } from '@/app/map-dimension-control';
import { STORAGE_KEYS } from '@/config';
import { isStorageQuotaExceeded } from '@/utils/storage-quota';
import type { AppContext } from '@/app/app-context';
import type { MapLayers } from '@/types';

function makeCtx(options: {
  globe?: boolean;
  deck?: boolean;
  resilienceScore?: boolean;
} = {}): AppContext & { setLayersCalls: MapLayers[] } {
  let globeMode = options.globe === true;
  let deckActive = options.deck === true;
  const setLayersCalls: MapLayers[] = [];
  return {
    setLayersCalls,
    mapLayers: {
      resilienceScore: options.resilienceScore === true,
    } as unknown as MapLayers,
    map: {
      isGlobeMode: () => globeMode,
      isDeckGLActive: () => deckActive,
      switchToGlobe: () => {
        globeMode = true;
        deckActive = false;
      },
      switchToFlat: () => {
        globeMode = false;
        deckActive = true;
      },
      setLayers: (layers: MapLayers) => {
        setLayersCalls.push(layers);
      },
    },
  } as unknown as AppContext & { setLayersCalls: MapLayers[] };
}

describe('set_map_mode persists map mode', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    const toggle = document.createElement('div');
    toggle.id = 'mapDimensionToggle';
    toggle.innerHTML = `
      <button class="map-dim-btn active" data-mode="flat">2D</button>
      <button class="map-dim-btn" data-mode="globe">3D</button>
    `;
    document.body.append(toggle);
  });

  it('writes STORAGE_KEYS.mapMode when switching to 3d', () => {
    const ctx = makeCtx({ deck: true });
    expect(localStorage.getItem(STORAGE_KEYS.mapMode)).toBeNull();

    const result = applyVisibleMapDimension(ctx, '3d');
    expect(result.alreadyActive).toBe(false);
    expect(result.effective).toBe('3d');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.mapMode)!)).toBe('globe');
    expect(document.querySelector('[data-mode="globe"]')?.classList.contains('active')).toBe(true);
    expect(document.querySelector('[data-mode="flat"]')?.classList.contains('active')).toBe(false);
  });

  it('does not rewrite storage when the requested mode is already active', () => {
    const ctx = makeCtx({ deck: true });
    applyVisibleMapDimension(ctx, '2d');
    expect(localStorage.getItem(STORAGE_KEYS.mapMode)).toBeNull();
  });

  it('persists a resilienceScore compatibility write when leaving DeckGL', () => {
    const ctx = makeCtx({ deck: true, resilienceScore: true });
    const result = applyVisibleMapDimension(ctx, '3d');

    expect(ctx.mapLayers.resilienceScore).toBe(false);
    expect(result.adjustedLayers).toEqual([{
      layer: 'resilienceScore',
      from: true,
      to: false,
      reason: 'layer_not_executable',
    }]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.mapLayers)!))
      .toStrictEqual({ resilienceScore: false });
    expect(ctx.setLayersCalls).toStrictEqual([{ resilienceScore: false }]);
  });

  it('marks the storage quota flag when map-mode persistence overflows', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });

    applyVisibleMapDimension(makeCtx({ deck: true }), '3d');
    expect(isStorageQuotaExceeded()).toBe(true);
  });
});
