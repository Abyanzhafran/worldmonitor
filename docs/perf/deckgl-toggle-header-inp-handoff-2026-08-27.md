# Handoff: #5160 desktop INP — deckgl-layer-toggles header (2026-08-27)

Context dump for starting a fresh conversation on issue
[#5160](https://github.com/koala73/worldmonitor/issues/5160). Branch `fix-5160` already
exists locally. Nothing has been changed in the repo yet — this is pre-work only.

## How we got here

Started from the umbrella issue [#4487](https://github.com/koala73/worldmonitor/issues/4487)
("Core Web Vitals FAILED in field"). Findings on that one, for reference:

- #4487 is a meta/tracking issue, not something a single PR closes. It closes when its
  sub-issues close.
- No API keys or `.env` config are needed to work on the CWV campaign in general. The
  measurement stack is already wired: Sentry RUM (`VITE_SENTRY_DSN`, already set — see
  [src/bootstrap/lcp-report.ts](../../src/bootstrap/lcp-report.ts),
  [inp-report.ts](../../src/bootstrap/inp-report.ts),
  [cls-report.ts](../../src/bootstrap/cls-report.ts)), Vercel Analytics/Umami as the
  pageview denominator, CrUX/PageSpeed and DebugBear used manually (not called from repo
  code).
- LCP is essentially resolved (multiple closed sub-issues: #4488, #4489, #4890, #7118,
  #7113). CLS mostly resolved except #4580 (open, desktop regressing). **INP is the live
  front**, tracked under #4537, priority per the 2026-07-09 comment on #4487.
- Other open INP sub-issues under #4537, in case #5160 stalls and a switch makes sense:
  #5080 (mobile map-tap presentation delay, flagged as top priority), #5043 (panel-tab
  switch regression), #5049 (residual Map forced reads), #5165 (mobile post-hydration
  long-task wave).

Picked **#5160** to work on: desktop `deckgl-layer-toggles > .toggle-header` is the worst
single desktop INP target by two orders of magnitude — p75 11,744ms (n=7) in the
2026-07-09 Sentry device split.

## #5160 — what the issue says

- **Where:** [src/components/DeckGLMap.ts](../../src/components/DeckGLMap.ts) (layer
  toggles built around line 5432) and the `GlobeMap.ts` mirror.
- **Original hypothesis (already falsified — see the 2026-07-10 issue comment):** that
  the expand/collapse handler triggers a synchronous deck.gl `updateLayers()`/`render()`
  commit in the click frame. An investigator checked both handlers on current
  `origin/main`: neither calls `render()` or `updateLayers()`. They only toggle
  `.toggle-list.collapsed`, search visibility, and the chevron. **Do not re-chase this
  hypothesis without new evidence** — it's a dead end per the existing trace.
- **Diagnose command given in the issue:**
  ```
  node scripts/measure-dashboard-render-axis.mjs "https://www.worldmonitor.app/dashboard" \
    --interact "selector:.deckgl-layer-toggles .toggle-header" --cpu-throttle 4 --json \
    --width 1365 --height 768
  ```
- **Acceptance:** Sentry desktop `webvital:inp` bad-event rate for this selector → ~0;
  DebugBear desktop `inpSelector` row p75 < 500ms.

## The blocker that killed the last attempt — READ THIS FIRST

The prior investigator tried the diagnose command and **could not reach the selector at
all**: after the initial map pointer interaction, the page stayed in
`.map-container.svg-mode` instead of mounting DeckGL. `.deckgl-layer-toggles` only exists
in `deckgl-mode`, so the interaction target never existed and the trace was worthless.

Root cause: [src/components/MapContainer.ts:251-264](../../src/components/MapContainer.ts#L251-L264)
(`hasWebGLSupport()`) explicitly probes the WebGL2 renderer string and **rejects software
renderers** — `swiftshader`, `llvmpipe`, `softpipe`, "software rasterizer" — falling back
to SVG mode when it finds one. Two things in this repo default straight into that
software path:

- [playwright.config.ts:49](../../playwright.config.ts#L49) launches Chromium with
  `--use-angle=swiftshader --use-gl=swiftshader` explicitly (that project is for the fast
  GPU-independent CI suite — do not use it for this repro, it will always yield
  `svg-mode`).
- [scripts/measure-dashboard-render-axis.mjs:907](../../scripts/measure-dashboard-render-axis.mjs#L907)
  calls `chromium.launch()` with **no args at all** — on a headless/CI/sandboxed machine
  this commonly lands on software WebGL too, hitting the same gate.

**Before running any diagnostic trace on this issue, confirm real hardware-accelerated
WebGL2:**

1. Run from a machine with an actual GPU.
2. Launch headed, not headless — e.g. edit line 907 to
   `chromium.launch({ headless: false })` for this investigation. Windows headed
   Chromium uses the real GPU via ANGLE/D3D11 by default, no extra flags needed.
3. Before triggering the `.toggle-header` click, verify the container class —
   `page.evaluate(() => document.querySelector('.map-container').className)` — actually
   contains `deckgl-mode`, not `svg-mode`. Don't trust the trace otherwise.

No secrets, accounts, or `.env` entries are involved — this is purely a local
browser-capability gap, and it's the reason the previous attempt produced no PR.

## Suggested next steps for the new conversation

1. Get a GPU-backed headed Chromium session per above; confirm `deckgl-mode` mounts.
2. Run the issue's diagnose command against that session; get the worst-event-scoped
   phases and symbolicated top events (prod keeps function names).
3. Form a new hypothesis from the actual trace — the "synchronous updateLayers() in the
   click handler" theory is closed off, so look for concurrent render/layout work, not
   the handler itself.
4. Cross-reference [docs/perf/reading-field-web-vitals.md](reading-field-web-vitals.md)
   before quoting any Sentry number: never take a p75/mean of captured Sentry web-vital
   events (the good-trim in #4565 inverts the statistic). Use bad-event **rate**, and
   quote CrUX `queryHistoryRecord` for a true p75 in the eventual PR.
5. Fix, then verify against the issue's stated acceptance criteria (Sentry bad-event
   rate → ~0, DebugBear `inpSelector` p75 < 500ms for this selector), not a generic lab
   score.
