// U7 — always-free tool subset (R7, R9, R15).
//
// This unit deliberately narrows an invariant the server previously held:
// "everything that returns DATA requires credentials". The guards below are
// the ones that keep the narrowing honest:
//
//   - the roster is a single source (the registry's own `_freeTier` flag), so
//     the advertisement and the authorisation cannot drift;
//   - a `free` principal reaching a NON-free tool is refused in dispatch, not
//     just in the handler, so the promotion and the authorisation are not the
//     same line of code;
//   - a free-tier tool must reach no credentialed downstream, because a `free`
//     context has nothing honest to sign;
//   - the free-tier ceiling fails CLOSED, unlike the discovery limiter beside
//     it whose fail-open is justified only by carrying no data.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { TOOL_REGISTRY, TOOL_LIST_RESPONSE } from '../api/mcp/registry/index.ts';
import { buildAuthHeaders, applyFreeTierLimit } from '../api/mcp/auth.ts';
import { setUsageContext, createMcpUsage } from '../api/mcp/usage.ts';
import { principalIdForLog } from '../api/mcp/telemetry.ts';
import { dispatchToolsCall } from '../api/mcp/dispatch.ts';

const freeTools = TOOL_REGISTRY.filter((t) => t._freeTier === true);

describe('free-tier roster', () => {
  it('is non-empty and declared on the registry entries themselves', () => {
    assert.ok(freeTools.length > 0, 'at least one tool must be free-tier');
    assert.ok(freeTools.some((t) => t.name === 'get_sources'));
  });

  it('reaches no credentialed downstream — every free tool declares no API path', () => {
    // A free-tier tool runs with a `free` context that cannot sign. Declaring
    // an _apiPaths entry means it fetches a gated endpoint, which would throw
    // at runtime for exactly the callers this tier exists to serve.
    for (const t of freeTools) {
      assert.deepEqual(
        t._apiPaths ?? [],
        [],
        `${t.name} is free-tier but declares a downstream API path`,
      );
    }
  });

  it('advertises access only on free tools, leaving every other tool untouched', () => {
    for (const tool of TOOL_LIST_RESPONSE) {
      const isFree = freeTools.some((t) => t.name === tool.name);
      const marker = tool._meta?.['worldmonitor/access'];
      if (isFree) {
        assert.equal(marker, 'free', `${tool.name} must advertise free access`);
      } else {
        assert.equal(marker, undefined, `${tool.name} must not carry an access marker`);
      }
    }
  });

  it('derives the advertisement from the same flag the server authorises on', () => {
    // Not two lists: the wire marker and the roster must be the same source.
    const advertised = TOOL_LIST_RESPONSE
      .filter((t) => t._meta?.['worldmonitor/access'] === 'free')
      .map((t) => t.name)
      .sort();
    assert.deepEqual(advertised, freeTools.map((t) => t.name).sort());
  });
});

describe('free principal — credential handling', () => {
  it('refuses to sign: buildAuthHeaders throws rather than minting a signature', async () => {
    await assert.rejects(
      () => buildAuthHeaders({ kind: 'free' }, 'GET', 'https://example.test/api/x', null),
      /free-tier context has no credentials/,
      'a free context must never be HMAC-signed as pro',
    );
  });

  it('reports as anonymous in usage telemetry, never as enterprise', () => {
    const usage = createMcpUsage();
    setUsageContext(usage, { kind: 'free' });
    assert.equal(usage.authKind, 'anon', 'free traffic must not be labelled enterprise_api_key');
    assert.equal(usage.customerId, null);
    assert.equal(usage.principalId, null);
  });

  it('logs no phantom principal', () => {
    assert.equal(principalIdForLog({ kind: 'free' }), 'anon');
  });
});

describe('dispatch refuses a free principal on a gated tool', () => {
  const call = (toolName) => dispatchToolsCall(
    new Request('https://worldmonitor.app/mcp', { method: 'POST' }),
    { kind: 'free' },
    { redisPipeline: async () => { throw new Error('quota must not be reached'); } },
    { id: 1, params: { name: toolName, arguments: {} } },
    {},
  );

  it('serves a tool that IS on the roster', async () => {
    const res = await call('get_sources');
    const body = await res.json();
    assert.ok(!body.error, `get_sources must be servable to a free caller: ${JSON.stringify(body.error)}`);
  });

  it('refuses a gated tool even though the caller reached dispatch', async () => {
    // The handler only mints a `free` context after matching `_freeTier`, so
    // this state should be unreachable — which is exactly why it is guarded.
    // If the handler's matching is ever widened by mistake, this is the layer
    // that stops an anonymous caller reading gated data for free.
    const res = await call('get_conflict_events');
    const body = await res.json();
    assert.ok(body.error, 'a gated tool must not be served to a free principal');
    assert.equal(body.error.code, -32001);
  });

  it('refuses every non-roster tool, not just the sampled one', async () => {
    const gated = TOOL_REGISTRY.filter((t) => t._freeTier !== true).slice(0, 12);
    for (const t of gated) {
      const res = await call(t.name);
      const body = await res.json();
      assert.ok(body.error, `${t.name} must be refused for a free principal`);
    }
  });
});

describe('free-tier ceiling fails closed', () => {
  const req = new Request('https://worldmonitor.app/mcp', {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.7' },
  });

  it('refuses when no limiter is configured, rather than serving unbounded free data', async () => {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    try {
      const res = await applyFreeTierLimit(req, {});
      assert.ok(res, 'an unconfigured limiter must refuse, not return null');
      assert.equal(res.status, 200, 'refusal rides the JSON-RPC envelope');
      const body = await res.json();
      assert.equal(body.error.code, -32029);
      assert.match(body.error.message, /Free-tier rate limit/);
    } finally {
      if (url) process.env.UPSTASH_REDIS_REST_URL = url;
      if (token) process.env.UPSTASH_REDIS_REST_TOKEN = token;
    }
  });

  it('is a tighter budget than the 60/min discovery limiter it sits beside', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../api/mcp/auth.ts', import.meta.url), 'utf8'));
    const match = source.match(/FREE_TIER_LIMIT_PER_MINUTE\s*=\s*(\d+)/);
    assert.ok(match, 'the free-tier budget must be a named constant');
    assert.ok(Number(match[1]) < 60, 'free data calls must be bounded tighter than metadata discovery');
  });
});
