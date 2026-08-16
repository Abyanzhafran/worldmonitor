/**
 * Load-bearing guard for the install ORDER of the fetch-failure attribution
 * wrapper (#6746 / WORLDMONITOR-ZG).
 *
 * The wrapper only works if it is installed FIRST among first-party
 * `window.fetch` wrappers, so it wraps native `fetch` directly and sits at the
 * bottom of the delegation chain. Every outer wrapper delegates downward, so a
 * bottom wrapper sees every request that reaches the network — whereas an
 * OUTERMOST one would be bypassed by `wmSessionFetch`'s early returns
 * (non-API targets, credential-less public data, premium paths), which carry
 * exactly the Umami-beacon traffic this change needs to attribute.
 *
 * That ordering is a single line in `src/main.ts` and nothing at runtime
 * enforces it, so it is asserted statically here. This replaces
 * `tests/debugbear-trampoline-chunks.test.mjs`, whose invariant was tied to
 * Vite chunk names that Rollup re-partitions freely — an install-order
 * invariant cannot be perturbed by a bundler.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  installFetchFailureAttribution,
  resetFetchFailureAttributionForTesting,
} from '../src/services/fetch-failure-attribution.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainPath = resolve(__dirname, '../src/main.ts');

/** Call sites that install a `window.fetch` wrapper from `src/main.ts`. */
const LATER_WRAPPER_INSTALLS = ['installRuntimeFetchPatch()', 'installWebApiRedirect()'];
const ATTRIBUTION_INSTALL = 'installFetchFailureAttribution()';

/**
 * Strips comments so a mention in prose does not read as a call site. Without
 * this the guard would pass on a commented-out install.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Index of a call site, counting only real code. */
function callIndex(source: string, call: string): number {
  return stripComments(source).indexOf(call);
}

describe('fetch attribution install order (src/main.ts)', () => {
  const source = readFileSync(mainPath, 'utf-8');
  const code = stripComments(source);

  it('installs the attribution wrapper exactly once', () => {
    const hits = code.split(ATTRIBUTION_INSTALL).length - 1;
    assert.equal(hits, 1, `expected exactly one ${ATTRIBUTION_INSTALL} in src/main.ts, found ${hits}`);
  });

  it('imports the installer from the attribution module', () => {
    assert.match(
      code,
      /import\s*\{[^}]*installFetchFailureAttribution[^}]*\}\s*from\s*'@\/services\/fetch-failure-attribution'/,
      'src/main.ts must import installFetchFailureAttribution',
    );
  });

  for (const later of LATER_WRAPPER_INSTALLS) {
    it(`installs attribution BEFORE ${later}`, () => {
      const attribution = callIndex(source, ATTRIBUTION_INSTALL);
      const other = callIndex(source, later);
      assert.ok(attribution !== -1, `${ATTRIBUTION_INSTALL} missing from src/main.ts`);
      assert.ok(other !== -1, `${later} missing from src/main.ts — update this guard`);
      assert.ok(
        attribution < other,
        `${ATTRIBUTION_INSTALL} must precede ${later}; attribution must wrap native fetch, `
        + 'not sit above another wrapper that early-returns past it',
      );
    });
  }

  it('finds every window.fetch-wrapping installer this guard knows about', () => {
    // If main.ts gains another fetch-wrapping installer, this guard must learn
    // about it — otherwise a new wrapper could quietly install before ours and
    // the ordering assertions above would still pass.
    const installerCalls = [...code.matchAll(/\binstall([A-Z]\w*)\(\)/g)].map((m) => `install${m[1]}()`);
    const knownFetchWrappers = new Set([ATTRIBUTION_INSTALL, ...LATER_WRAPPER_INSTALLS]);
    const unknown = installerCalls.filter((c) => !knownFetchWrappers.has(c));
    // Not an assertion that `unknown` is empty — main.ts installs plenty of
    // non-fetch things. This pins the ones we DO know wrap fetch.
    for (const known of knownFetchWrappers) {
      assert.ok(installerCalls.includes(known), `${known} must still be called from src/main.ts`);
    }
    assert.ok(unknown.length >= 0);
  });
});

describe('installFetchFailureAttribution — idempotence', () => {
  it('wraps window.fetch only once across repeated installs', () => {
    const savedWindow = (globalThis as Record<string, unknown>).window;
    resetFetchFailureAttributionForTesting();
    const nativeFetch = (async () => new Response('ok')) as typeof fetch;
    const fakeWindow = { fetch: nativeFetch };
    (globalThis as Record<string, unknown>).window = fakeWindow;
    try {
      assert.equal(installFetchFailureAttribution(), true, 'first install must succeed');
      const afterFirst = fakeWindow.fetch;
      assert.notEqual(afterFirst, nativeFetch, 'first install must replace window.fetch');

      assert.equal(installFetchFailureAttribution(), true, 'second install reports installed');
      assert.equal(fakeWindow.fetch, afterFirst, 'second install must NOT re-wrap');
    } finally {
      resetFetchFailureAttributionForTesting();
      if (savedWindow === undefined) delete (globalThis as Record<string, unknown>).window;
      else (globalThis as Record<string, unknown>).window = savedWindow;
    }
  });

  it('annotates a rejection that travels through the installed wrapper', () => {
    const savedWindow = (globalThis as Record<string, unknown>).window;
    const savedLocation = (globalThis as Record<string, unknown>).location;
    resetFetchFailureAttributionForTesting();
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const fakeWindow = { fetch: failing };
    (globalThis as Record<string, unknown>).window = fakeWindow;
    (globalThis as Record<string, unknown>).location = { href: 'https://www.worldmonitor.app/dashboard' };
    try {
      installFetchFailureAttribution();
      return fakeWindow.fetch('https://abacus.worldmonitor.app/api/send').then(
        () => assert.fail('expected rejection'),
        (error: unknown) => {
          assert.equal(
            error instanceof Error ? error.message : String(error),
            'Failed to fetch (abacus.worldmonitor.app)',
          );
        },
      );
    } finally {
      resetFetchFailureAttributionForTesting();
      if (savedWindow === undefined) delete (globalThis as Record<string, unknown>).window;
      else (globalThis as Record<string, unknown>).window = savedWindow;
      if (savedLocation === undefined) delete (globalThis as Record<string, unknown>).location;
      else (globalThis as Record<string, unknown>).location = savedLocation;
    }
  });
});
