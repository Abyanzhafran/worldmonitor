/**
 * Behavioral coverage for the layer-panel collapse control (#5160).
 *
 * The field defect this locks down: `deckgl-layer-toggles > .toggle-header` was
 * the worst desktop INP target while carrying no click listener at all. Only the
 * ~10px chevron was wired, so clicks on the header — the panel's largest
 * affordance — did nothing, users re-clicked, and web-vitals attributed each of
 * those dead interactions to the element the pointer hit.
 *
 * These tests assert the header is the click target, that the chevron still
 * toggles exactly once (it bubbles into the same handler rather than running a
 * second one), and that the help button keeps its own action.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { bindLayerPanelCollapse } from '@/config/map-layer-definitions';

const COLLAPSED_GLYPH = '▶';
const EXPANDED_GLYPH = '▼';

/**
 * Mirrors the DeckGLMap header (title + help button + chevron). GlobeMap renders
 * the same structure minus `.layer-help-btn`; `withHelp: false` covers it.
 */
function mountPanel({ withHelp = true }: { withHelp?: boolean } = {}): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'layer-toggles deckgl-layer-toggles';
  panel.innerHTML = `
    <div class="toggle-header">
      <span>LAYERS</span>
      ${withHelp ? '<button type="button" class="layer-help-btn" aria-label="Layer guide">?</button>' : ''}
      <button type="button" class="toggle-collapse" aria-label="Layers" aria-expanded="true">${EXPANDED_GLYPH}</button>
    </div>
    <input type="text" class="layer-search" />
    <div class="toggle-list">
      <div class="layer-toggle-row" data-layer="flights"></div>
    </div>
  `;
  document.body.appendChild(panel);
  return panel;
}

const header = (panel: HTMLElement): HTMLElement => panel.querySelector('.toggle-header') as HTMLElement;
const list = (panel: HTMLElement): HTMLElement => panel.querySelector('.toggle-list') as HTMLElement;
const chevron = (panel: HTMLElement): HTMLElement => panel.querySelector('.toggle-collapse') as HTMLElement;
const search = (panel: HTMLElement): HTMLElement => panel.querySelector('.layer-search') as HTMLElement;

const isCollapsed = (panel: HTMLElement): boolean => list(panel).classList.contains('collapsed');

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('bindLayerPanelCollapse', () => {
  it('collapses when the header itself is clicked, not only the chevron', () => {
    const panel = mountPanel();
    bindLayerPanelCollapse(panel);

    expect(isCollapsed(panel)).toBe(false);

    header(panel).click();

    expect(isCollapsed(panel)).toBe(true);
    expect(search(panel).style.display).toBe('none');
    expect(chevron(panel).textContent).toBe(COLLAPSED_GLYPH);
    expect(chevron(panel).getAttribute('aria-expanded')).toBe('false');
  });

  it('collapses when the click lands on the title span inside the header', () => {
    const panel = mountPanel();
    bindLayerPanelCollapse(panel);

    (header(panel).querySelector('span') as HTMLElement).click();

    expect(isCollapsed(panel)).toBe(true);
  });

  it('expands again on a second header click', () => {
    const panel = mountPanel();
    bindLayerPanelCollapse(panel);

    header(panel).click();
    header(panel).click();

    expect(isCollapsed(panel)).toBe(false);
    expect(search(panel).style.display).toBe('');
    expect(chevron(panel).textContent).toBe(EXPANDED_GLYPH);
    expect(chevron(panel).getAttribute('aria-expanded')).toBe('true');
  });

  it('toggles exactly once when the chevron is clicked', () => {
    // The chevron sits inside the header, so its click bubbles into the header
    // handler. A second listener on the button would net out to no visible
    // change — this is the regression that would silently break the control.
    const panel = mountPanel();
    bindLayerPanelCollapse(panel);

    chevron(panel).click();

    expect(isCollapsed(panel)).toBe(true);
  });

  it('leaves the panel expanded when the help button is clicked', () => {
    const panel = mountPanel();
    bindLayerPanelCollapse(panel);

    (panel.querySelector('.layer-help-btn') as HTMLElement).click();

    expect(isCollapsed(panel)).toBe(false);
  });

  it('works on the GlobeMap header, which has no help button', () => {
    const panel = mountPanel({ withHelp: false });
    bindLayerPanelCollapse(panel);

    header(panel).click();

    expect(isCollapsed(panel)).toBe(true);
  });

  it('publishes the initial expanded state on the chevron', () => {
    const panel = mountPanel();
    chevron(panel).removeAttribute('aria-expanded');

    bindLayerPanelCollapse(panel);

    expect(chevron(panel).getAttribute('aria-expanded')).toBe('true');
  });

  it('is a no-op when the panel has no header or no list', () => {
    const headerless = document.createElement('div');
    headerless.innerHTML = '<div class="toggle-list"></div>';
    expect(() => bindLayerPanelCollapse(headerless)).not.toThrow();

    const listless = document.createElement('div');
    listless.innerHTML = '<div class="toggle-header"></div>';
    expect(() => bindLayerPanelCollapse(listless)).not.toThrow();
  });
});
