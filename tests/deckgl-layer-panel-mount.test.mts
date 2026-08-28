import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { scheduleIdle } from '@/utils/after-paint';

/**
 * #5160 — the layer panel must not paint into the map's init burst.
 *
 * `createLayerToggles()` used to run synchronously one line after
 * `initMapLibre()` was kicked off, so ~30 rows of interactive chrome painted and
 * started taking clicks while MapLibre was still parsing its style and compiling
 * shaders. Because the DeckGL renderer itself mounts on demand, that burst lands
 * exactly when the user reaches for the map: those clicks carried multi-second
 * input delay and made this panel the worst desktop INP target in the field.
 *
 * Source-text assertions here, because the DeckGLMap constructor needs WebGL and
 * cannot be instantiated under any node test runner. `scheduleIdle` — the
 * primitive the deferral rides on — is covered behaviorally.
 */

const root = resolve(import.meta.dirname, '..');
// Normalized: the working tree is CRLF on Windows, and every block matcher below
// anchors on '\n'.
const deckGLMapSrc = readFileSync(resolve(root, 'src/components/DeckGLMap.ts'), 'utf8')
  .replace(/\r\n/g, '\n');

describe('DeckGLMap layer panel mount (#5160)', () => {
  it('does not build the layer panel synchronously in the constructor', () => {
    const constructorChrome = deckGLMapSrc.match(/if \(this\.chrome\) \{[\s\S]*?\n {4}\}/);
    assert.ok(constructorChrome, 'constructor must still gate its chrome on this.chrome');
    assert.doesNotMatch(
      constructorChrome[0],
      /this\.createLayerToggles\(\)/,
      'the constructor must schedule the layer panel, not build it inside the map init burst',
    );
    assert.match(
      constructorChrome[0],
      /this\.scheduleLayerTogglesMount\(\)/,
      'the constructor must call scheduleLayerTogglesMount()',
    );
  });

  it('waits for the basemap load event before mounting the panel', () => {
    const scheduler = deckGLMapSrc.match(
      /private scheduleLayerTogglesMount\(\): void \{[\s\S]*?\n {2}\}/,
    );
    assert.ok(scheduler, 'scheduleLayerTogglesMount() must exist');
    assert.match(scheduler[0], /map\.once\('load', mountWhenIdle\)/, 'must wait for basemap load');
    assert.match(scheduler[0], /scheduleIdle\(mount\)/, 'must mount in an idle slot, not inline');
  });

  it('keeps a hard deadline so the panel appears even if the basemap never loads', () => {
    const scheduler = deckGLMapSrc.match(
      /private scheduleLayerTogglesMount\(\): void \{[\s\S]*?\n {2}\}/,
    );
    assert.ok(scheduler);
    const deadline = scheduler[0].match(/const MOUNT_DEADLINE_MS = (\d+);/);
    assert.ok(deadline, 'the scheduler must define MOUNT_DEADLINE_MS');
    // Upper bound: must stay under the 10s style watchdog, so the panel appears
    // before the fallback-style path recreates the map underneath it.
    assert.ok(
      Number(deadline[1]) > 0 && Number(deadline[1]) < 10000,
      `MOUNT_DEADLINE_MS must be a real ceiling below the style watchdog, got ${deadline[1]}`,
    );
    assert.match(scheduler[0], /setTimeout\(mount, MOUNT_DEADLINE_MS\)/);
  });

  it('cancels the pending mount on destroy so it cannot build into a torn-down container', () => {
    const destroy = deckGLMapSrc.match(/public destroy\(\): void \{[\s\S]*?\n {2}\}\n\}/);
    assert.ok(destroy, 'destroy() must exist');
    assert.match(destroy[0], /clearTimeout\(this\.layerTogglesMountTimeoutId\)/);
    assert.match(destroy[0], /this\.cancelLayerTogglesIdleMount\?\.\(\)/);
    assert.match(
      deckGLMapSrc,
      /private createLayerToggles\(\): void \{\s*\n\s*if \(this\.destroyed \|\| this\.layerTogglesMounted\) return;/,
      'createLayerToggles() must refuse to run after destroy or twice',
    );
  });

  it('replays the per-layer panel state that arrived before the panel existed', () => {
    // MapContainer.rehydrateActiveMap() and the data loaders push hidden/loading/
    // ready state synchronously right after construction. With the panel deferred,
    // those pushes land on an empty container and must be replayed at mount.
    for (const line of [
      'for (const layer of this.hiddenLayerToggles) this.hideLayerToggle(layer);',
      'for (const [layer, loading] of this.layerToggleLoading) this.setLayerLoading(layer, loading);',
      'for (const [layer, hasData] of this.layerToggleReady) this.setLayerReady(layer, hasData);',
    ]) {
      assert.ok(deckGLMapSrc.includes(line), `createLayerToggles() must replay: ${line}`);
    }
    assert.match(deckGLMapSrc, /this\.hiddenLayerToggles\.add\(layer\);/, 'hideLayerToggle must record');
    assert.match(deckGLMapSrc, /this\.layerToggleLoading\.set\(layer, loading\);/, 'setLayerLoading must record');
    assert.match(deckGLMapSrc, /this\.layerToggleReady\.set\(layer, hasData\);/, 'setLayerReady must record');
  });
});

type IdleGlobal = { requestIdleCallback?: unknown };

function withRequestIdleCallback<T>(value: unknown, run: () => T): T {
  const had = Object.hasOwn(globalThis, 'requestIdleCallback');
  const previous = (globalThis as IdleGlobal).requestIdleCallback;
  if (value === undefined) delete (globalThis as IdleGlobal).requestIdleCallback;
  else (globalThis as IdleGlobal).requestIdleCallback = value;
  try {
    return run();
  } finally {
    if (had) (globalThis as IdleGlobal).requestIdleCallback = previous;
    else delete (globalThis as IdleGlobal).requestIdleCallback;
  }
}

describe('scheduleIdle (#5160)', () => {
  it('runs the task through requestIdleCallback with a deadline', () => {
    let queued: (() => void) | null = null;
    let seenTimeout: number | undefined;
    let ran = 0;

    withRequestIdleCallback(
      (cb: () => void, opts?: { timeout: number }) => { queued = cb; seenTimeout = opts?.timeout; },
      () => { scheduleIdle(() => { ran++; }, 750); },
    );

    assert.equal(seenTimeout, 750, 'the idle callback must carry a deadline');
    assert.equal(ran, 0, 'the task must not run synchronously');
    (queued as unknown as () => void)();
    assert.equal(ran, 1);
  });

  it('runs at most once even if the callback fires twice', () => {
    let queued: (() => void) | null = null;
    let ran = 0;

    withRequestIdleCallback(
      (cb: () => void) => { queued = cb; },
      () => { scheduleIdle(() => { ran++; }); },
    );

    const fire = queued as unknown as () => void;
    fire();
    fire();
    assert.equal(ran, 1);
  });

  it('does not run the task after cancel', () => {
    let queued: (() => void) | null = null;
    let ran = 0;

    withRequestIdleCallback(
      (cb: () => void) => { queued = cb; },
      () => {
        const cancel = scheduleIdle(() => { ran++; });
        cancel();
      },
    );

    (queued as unknown as () => void)();
    assert.equal(ran, 0);
  });

  it('falls back to setTimeout where requestIdleCallback is absent (Safari, node)', async () => {
    let ran = 0;
    withRequestIdleCallback(undefined, () => { scheduleIdle(() => { ran++; }, 1); });
    assert.equal(ran, 0);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(ran, 1);
  });
});
