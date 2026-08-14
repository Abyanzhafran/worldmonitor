/**
 * Full-page stock research overlay. Composes the existing Yahoo/sparkline
 * chart, AnalyzeStock, and backtest entry. Does not add a market vendor.
 */

import type { MarketData } from '@/types';
import { formatChange, formatPrice, getChangeClass } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';
import { terminalChart } from '@/utils/terminal-chart';
import { hasPremiumAccess } from '@/services/panel-gating';
import { tapeClaimForMarketSource, tapeClaimLabel } from '@/services/market-tape-claim';
import { getRpcBaseUrl } from '@/services/rpc-client';
import { premiumFetch } from '@/services/premium-fetch';
import { MarketServiceClient } from '@/services/generated-rpc-clients';
import {
  createMarketChartFocusController,
  hasPlottableMarketSeries,
  type MarketChartFocusController,
} from '@/components/market-chart-interactions';
import {
  normalizeStockResearchSymbol,
  stockResearchUrl,
} from './stock-research-route';

let overlayEl: HTMLElement | null = null;
let focusController: MarketChartFocusController | null = null;

function tapeNote(): string {
  const claim = tapeClaimForMarketSource({ source: 'yahoo', keyConfigured: true });
  return tapeClaimLabel(claim);
}

function removeOverlay(restoreFocus: boolean): void {
  overlayEl?.remove();
  overlayEl = null;
  focusController?.deactivate({ restoreFocus });
  focusController = null;
}

export function closeStockResearchOverlay(): void {
  removeOverlay(true);
  if (isStockResearchLocation()) {
    const next = `${window.location.pathname.replace(/^\/stocks(?:\/[^/]+)?\/?$/, '/') || '/'}${window.location.search}`;
    window.history.replaceState({}, '', next === '//' ? '/' : next);
  }
}

function isStockResearchLocation(): boolean {
  return /^\/stocks(?:\/|$)/.test(window.location.pathname);
}

export function navigateToStockResearch(symbol: string, stock?: MarketData): void {
  const normalized = normalizeStockResearchSymbol(symbol);
  if (!normalized) return;
  const url = stockResearchUrl(normalized);
  if (window.location.pathname !== url) {
    window.history.pushState({ stockResearch: normalized }, '', url);
  }
  void openStockResearchOverlay(normalized, stock);
}

export async function openStockResearchOverlay(rawSymbol: string, stock?: MarketData): Promise<void> {
  const symbol = normalizeStockResearchSymbol(rawSymbol);
  if (!symbol) return;

  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const returnFocus = focusController?.returnFocus?.isConnected
    ? focusController.returnFocus
    : activeElement?.isConnected
      ? activeElement
      : null;
  removeOverlay(false);

  overlayEl = document.createElement('div');
  overlayEl.className = 'stock-research-overlay';
  overlayEl.setAttribute('role', 'dialog');
  overlayEl.setAttribute('aria-modal', 'true');
  overlayEl.setAttribute('aria-label', `${symbol} research`);

  const entitled = hasPremiumAccess();
  const chart = stock && hasPlottableMarketSeries(stock)
    ? terminalChart(stock.sparkline, {
      change: stock.change,
      width: 640,
      height: 240,
      formatValue: (value) => formatPrice(value),
      ariaLabel: `${stock.display} price chart`,
    })
    : '';

  setTrustedHtml(
    overlayEl,
    trustedHtml(`
      <div class="stock-research-room">
        <button type="button" class="stock-research-close" aria-label="Close research">Close</button>
        <header class="stock-research-head">
          <div>
            <div class="stock-research-symbol">${escapeHtml(symbol)}</div>
            <div class="stock-research-name">${escapeHtml(stock?.name || symbol)}</div>
          </div>
          <div class="stock-research-quote">
            <span>${stock ? formatPrice(stock.price) : '—'}</span>
            <span class="${stock ? getChangeClass(stock.change) : ''}">${stock ? formatChange(stock.change) : ''}</span>
            <div class="stock-research-tape" data-tape-claim="yahoo">${escapeHtml(tapeNote())}</div>
          </div>
        </header>
        <div class="stock-research-chart">${chart || '<p>No plottable Yahoo series for this symbol yet.</p>'}</div>
        <section class="stock-research-analyze" data-analyze-state="${entitled ? 'loading' : 'locked'}">
          ${entitled ? '<p>Loading analysis…</p>' : '<p>Premium stock analysis and backtest stay locked.</p>'}
        </section>
      </div>
    `, 'Stock research overlay values are escaped before rendering'),
  );

  document.body.append(overlayEl);
  overlayEl.querySelector('.stock-research-close')?.addEventListener('click', () => closeStockResearchOverlay());
  overlayEl.addEventListener('click', (event) => {
    if (event.target === overlayEl) closeStockResearchOverlay();
  });
  focusController = createMarketChartFocusController(overlayEl, () => closeStockResearchOverlay(), returnFocus);
  const closeButton = overlayEl.querySelector('.stock-research-close');
  focusController.activate(closeButton instanceof HTMLElement ? closeButton : null);

  if (!entitled) return;
  const analyzeHost = overlayEl.querySelector('.stock-research-analyze');
  if (!(analyzeHost instanceof HTMLElement)) return;
  try {
    const client = new MarketServiceClient(getRpcBaseUrl(), { fetch: premiumFetch });
    const analysis = await client.analyzeStock({ symbol, name: stock?.name || symbol, includeNews: true });
    const headlines = (analysis.headlines ?? []).slice(0, 3).map((headline) => {
      const aligned = headline.alignedTradingDate
        ? ` aligned ${escapeHtml(headline.alignedTradingDate)}`
        : '';
      return `<li><a href="${escapeHtml(headline.link)}" target="_blank" rel="noreferrer">${escapeHtml(headline.title)}</a><span>${escapeHtml(headline.source || '')}${aligned}</span></li>`;
    }).join('');
    const sentiment = analysis.newsSentiment == null
      ? ''
      : `<p data-news-overlay="model">News overlay (model): ${analysis.newsSentiment.toFixed(2)}</p>`;
    analyzeHost.dataset.analyzeState = 'ready';
    setTrustedHtml(
      analyzeHost,
      trustedHtml(`
        <h2>Analysis</h2>
        <p>${escapeHtml(analysis.ratingSummary || analysis.summary || 'No analysis summary.')}</p>
        ${sentiment}
        ${headlines ? `<ul class="stock-research-news">${headlines}</ul>` : '<p>No headlines.</p>'}
        <p class="stock-research-backtest">Backtest remains in the Premium Stock Backtest panel.</p>
      `, 'Stock research analysis values are escaped before rendering'),
    );
  } catch {
    analyzeHost.dataset.analyzeState = 'error';
    analyzeHost.replaceChildren();
    analyzeHost.append(Object.assign(document.createElement('p'), {
      textContent: 'Premium analysis is unavailable right now.',
    }));
  }
}
