/**
 * Persistence proof for the WebMCP `set_map_mode` cancellation gate (#7321).
 *
 * The policy classifies `set_map_mode` as cancellation-required because it
 * writes STORAGE_KEYS.mapMode, and a globe switch can also persist a
 * resilienceScore compatibility change. WebMCP unit tests stub the final
 * action, so they never reach those writes.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { applyVisibleMapDimension } from '@/app/map-dimension-control';
import { STORAGE_KEYS } from '@/config';
import type { AppContext } from '@/app/app-context';
import type { MapLayers } from '@/types';

function makeCtx(options: {
  globe?: boolean;
  deck?: boolean;
  resilienceScore?: boolean;
} = {}): AppContext {
  let globeMode = options.globe === true;
  let deckActive = options.deck === true;
  return {
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
    },
  } as unknown as AppContext;
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
  });
});
