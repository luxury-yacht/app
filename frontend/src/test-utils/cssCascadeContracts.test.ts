import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const readProjectFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const installStyles = (...sources: string[]) => {
  const style = document.createElement('style');
  style.textContent = sources.join('\n');
  document.head.appendChild(style);
  return style;
};

afterEach(() => {
  document.head.querySelectorAll('style[data-css-contract]').forEach((style) => {
    style.remove();
  });
  document.body.innerHTML = '';
});

describe('strict CSS cascade contracts', () => {
  it('keeps the shared hidden utility authoritative without important', () => {
    const style = installStyles(readProjectFile('styles/utilities/display.css'));
    style.dataset.cssContract = 'hidden';
    const hidden = document.createElement('div');
    hidden.className = 'hidden';
    hidden.style.display = '';
    document.body.appendChild(hidden);

    expect(window.getComputedStyle(hidden).display).toBe('none');
  });

  it('keeps the favorite kubeconfig option surface transparent through scoped specificity', () => {
    const style = installStyles(
      '.dropdown-option.selected { background-color: rgb(255, 0, 0); }',
      readProjectFile('src/shared/components/KubeconfigSelector.css')
    );
    style.dataset.cssContract = 'kubeconfig';
    document.body.innerHTML = `
      <div class="fav-save-modal"></div>
      <div class="dropdown-menu fav-save-dropdown-menu">
        <div class="dropdown-option selected"><span class="kubeconfig-option"></span></div>
      </div>
    `;

    const option = document.querySelector<HTMLElement>('.dropdown-option');
    expect(window.getComputedStyle(option as HTMLElement).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  });

  it('disables resource-bar transitions through the component state class', () => {
    const style = installStyles(readProjectFile('src/shared/components/ResourceBar.css'));
    style.dataset.cssContract = 'resource-bar';
    document.body.innerHTML = `
      <div class="resource-bar-no-animation">
        <div class="resource-bar-usage"></div>
      </div>
    `;

    const usage = document.querySelector<HTMLElement>('.resource-bar-usage');
    expect(window.getComputedStyle(usage as HTMLElement).transition).toBe('none');
  });

  it('keeps interactive tooltips pointer-accessible when component CSS loads before global CSS', () => {
    const style = installStyles(
      readProjectFile('src/shared/components/Tooltip.css'),
      readProjectFile('styles/components/tooltips.css')
    );
    style.dataset.cssContract = 'interactive-tooltip';
    document.body.innerHTML = '<div class="tooltip tooltip--interactive">Sessions</div>';

    const tooltip = document.querySelector<HTMLElement>('.tooltip');
    expect(window.getComputedStyle(tooltip as HTMLElement).pointerEvents).toBe('auto');
  });

  it('keeps the log timestamp format error border above its input base rule', () => {
    const style = installStyles(
      readProjectFile('styles/components/modals.css').replace(
        /var\(--status-error-text\)/g,
        'rgb(200, 10, 20)'
      ),
      readProjectFile(
        'src/modules/object-panel/components/ObjectPanel/Logs/ObjPanelLogsSettings.css'
      )
        .replace(/var\(--color-border\)/g, 'rgb(1, 2, 3)')
        .replace(/var\(--status-error-text\)/g, 'rgb(200, 10, 20)')
    );
    style.dataset.cssContract = 'log-timestamp-error';
    document.body.innerHTML = `
      <div class="obj-panel-logs-settings-timestamp-grid">
        <input type="text" class="modal-input-error" />
      </div>
    `;

    const input = document.querySelector<HTMLInputElement>('input');
    expect(window.getComputedStyle(input as HTMLInputElement).borderTopColor).toBe(
      'rgb(200, 10, 20)'
    );
  });

  it('resets native button chrome on the namespace-scope add affordance', () => {
    const style = installStyles(readProjectFile('src/ui/layout/Sidebar.css'));
    style.dataset.cssContract = 'namespace-scope-add';
    document.body.innerHTML = `
      <button type="button" class="sidebar-item namespace-scope-add">Add namespace</button>
    `;

    const button = document.querySelector<HTMLButtonElement>('.namespace-scope-add');
    const computed = window.getComputedStyle(button as HTMLButtonElement);
    expect(computed.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(computed.borderTopStyle).toBe('none');
    expect(computed.borderRightStyle).toBe('none');
    expect(computed.borderBottomStyle).toBe('none');
    expect(computed.borderLeftStyle).toBe('solid');
    expect(computed.borderLeftWidth).toBe('3px');
  });

  it('resets native rule chrome on the sidebar resize separator', () => {
    const style = installStyles(readProjectFile('src/ui/layout/Sidebar.css'));
    style.dataset.cssContract = 'sidebar-resizer';
    document.body.innerHTML = '<hr class="sidebar-resizer" />';

    const resizer = document.querySelector<HTMLElement>('.sidebar-resizer');
    const computed = window.getComputedStyle(resizer as HTMLElement);
    expect(Number.parseFloat(computed.marginTop || '0')).toBe(0);
    expect(computed.borderTopStyle).toBe('none');
    expect(computed.borderRightStyle).toBe('none');
    expect(computed.borderBottomStyle).toBe('none');
    expect(computed.borderLeftStyle).toBe('none');
  });

  it('keeps namespace row spacing on the wrapper instead of doubling button margins', () => {
    const style = installStyles(readProjectFile('src/ui/layout/Sidebar.css'));
    style.dataset.cssContract = 'namespace-row-spacing';
    document.body.innerHTML = `
      <div class="namespace-items">
        <div><div class="sidebar-item-row"><button class="sidebar-item">default</button></div></div>
        <div><div class="sidebar-item-row"><button class="sidebar-item">kube-system</button></div></div>
      </div>
    `;

    const row = document.querySelector<HTMLElement>('.sidebar-item-row');
    const button = document.querySelector<HTMLButtonElement>('.sidebar-item');
    // Sidebar.css declares 0.2rem; jsdom resolves font-relative lengths against
    // the 16px root font size, so the computed value comes back as 3.2px.
    expect(window.getComputedStyle(row as HTMLElement).marginTop).toBe('3.2px');
    expect(Number.parseFloat(window.getComputedStyle(button as HTMLButtonElement).marginTop)).toBe(
      0
    );
  });

  it('keeps object-panel links authoritative over late-loaded gridtable css copies', () => {
    // gridtables.css is @imported by several lazy view stylesheets, so a copy
    // of `.gridtable-link { color: ... }` can load AFTER the object panel's
    // shared.css. The object-panel-link style must win that tie through
    // scoped specificity, never through load order.
    const style = installStyles(
      readProjectFile('src/modules/object-panel/components/ObjectPanel/shared.css').replace(
        /var\(--color-object-panel-link\)/g,
        'rgb(170, 170, 170)'
      ),
      readProjectFile('styles/components/gridtables.css').replace(
        /var\(--color-text\)/g,
        'rgb(224, 224, 224)'
      )
    );
    style.dataset.cssContract = 'object-panel-link-order';
    document.body.innerHTML = `
      <div class="grid-cell"><span class="grid-cell-content">
        <button class="gridtable-cell-button gridtable-link object-panel-link">api</button>
      </span></div>
    `;

    const button = document.querySelector<HTMLButtonElement>('.object-panel-link');
    expect(window.getComputedStyle(button as HTMLButtonElement).color).toBe('rgb(170, 170, 170)');
  });

  it('keeps detail-segment presentation authoritative inside object-panel links', () => {
    const style = installStyles(
      readProjectFile('styles/components/badges.css').replace(
        /var\(--color-warning\)/g,
        'rgb(255, 165, 0)'
      ),
      readProjectFile('src/modules/object-panel/components/ObjectPanel/shared.css').replace(
        /var\(--color-object-panel-link\)/g,
        'rgb(170, 170, 170)'
      )
    );
    style.dataset.cssContract = 'detail-segment-link-presentation';
    document.body.innerHTML = `
      <button class="gridtable-cell-button gridtable-link object-panel-link detail-segment-value">
        <span class="status-text warning">api</span>
      </button>
    `;

    const button = document.querySelector<HTMLButtonElement>('.detail-segment-value');
    const value = document.querySelector<HTMLElement>('.detail-segment-value .status-text');
    expect(window.getComputedStyle(button as HTMLButtonElement).color).toBe('rgb(170, 170, 170)');
    expect(window.getComputedStyle(value as HTMLElement).color).toBe('rgb(255, 165, 0)');
  });

  it('truncates a detail-segment value within the space left after its label', () => {
    const style = installStyles(
      readProjectFile('src/shared/components/tables/detailSegmentsColumn.css')
    );
    style.dataset.cssContract = 'detail-segment-value-overflow';
    document.body.innerHTML = `
      <span class="detail-segments">
        <span class="detail-segment-text">
          <span class="detail-segment-label">Service:</span>
          <button class="detail-segment-value">argocd-dex-server</button>
        </span>
      </span>
    `;

    const container = document.querySelector<HTMLElement>('.detail-segments');
    const segment = document.querySelector<HTMLElement>('.detail-segment-text');
    const label = document.querySelector<HTMLElement>('.detail-segment-label');
    const value = document.querySelector<HTMLButtonElement>('.detail-segment-value');

    expect(window.getComputedStyle(container as HTMLElement).display).toBe('inline-flex');
    expect(window.getComputedStyle(container as HTMLElement).maxWidth).toBe('100%');
    expect(window.getComputedStyle(segment as HTMLElement).display).toBe('inline-flex');
    expect(window.getComputedStyle(segment as HTMLElement).minWidth).toBe('0px');
    expect(window.getComputedStyle(label as HTMLElement).flexShrink).toBe('0');
    expect(window.getComputedStyle(value as HTMLButtonElement).minWidth).toBe('0px');
    expect(window.getComputedStyle(value as HTMLButtonElement).overflow).toBe('hidden');
    expect(window.getComputedStyle(value as HTMLButtonElement).textOverflow).toBe('ellipsis');
  });

  it('keeps sortable table headers uppercase over native button styling', () => {
    const style = installStyles(
      'button { text-transform: none; }',
      readProjectFile('styles/components/gridtables.css')
    );
    style.dataset.cssContract = 'gridtable-sort-label';
    document.body.innerHTML = `
      <div class="gridtable-header">
        <div class="grid-cell-header" data-sortable="true">
          <span class="header-content"><button class="gridtable-sort-button">Kind</button></span>
        </div>
      </div>
    `;

    const button = document.querySelector<HTMLButtonElement>('.gridtable-sort-button');
    expect(window.getComputedStyle(button as HTMLButtonElement).textTransform).toBe('uppercase');
  });

  it('uses appearance-mode tokens for custom-column action hover states', () => {
    const gridTableCSS = readProjectFile('styles/components/gridtables.css');
    const editHover = gridTableCSS.match(
      /\.gridtable-column-edit-action:hover,[\s\S]*?\{([\s\S]*?)\}/
    )?.[1];
    const deleteHover = gridTableCSS.match(
      /\.gridtable-column-delete-action:hover,[\s\S]*?\{([\s\S]*?)\}/
    )?.[1];

    expect(editHover).toContain('background: var(--color-bg-tertiary)');
    expect(deleteHover).toContain('color: var(--color-error-text)');
    expect(deleteHover).toContain('background: var(--color-error-bg)');
  });

  it('keeps motion and interaction CSS free of important declarations', () => {
    const classifiedBoundaries = [
      ['src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.css', 0],
      ['src/ui/dockable/DockablePanel.css', 0],
      ['src/ui/layout/Sidebar.css', 0],
      ['styles/utilities/motion.css', 0],
    ] as const;

    for (const [path, expectedCount] of classifiedBoundaries) {
      const declarations = readProjectFile(path).match(/!important\b/g) ?? [];
      expect(declarations, path).toHaveLength(expectedCount);
    }
  });

  it('gives the reduced-motion rule app-root specificity', () => {
    const motion = readProjectFile('styles/utilities/motion.css');

    expect(motion).toContain('#app *');
    expect(motion).toContain('#app *::before');
    expect(motion).toContain('#app *::after');
  });

  describe('modal fade compositing contract', () => {
    // The backdrop uses backdrop-filter. An ancestor whose opacity animates
    // below 1 forms a backdrop root (filter-effects-2), and WebKitGTK — the
    // Linux Wails webview — hoists the filtered layer out of the fading
    // group, so the dimmed background and the modal container visibly fade
    // apart. The fade must therefore animate the backdrop's own paint
    // properties, never group opacity on an ancestor of the backdrop.
    const modalsCss = () => readProjectFile('styles/components/modals.css');

    const ruleBlock = (css: string, selector: string) => {
      const marker = `${selector} {`;
      const start = css.indexOf(marker);
      if (start === -1) {
        return null;
      }
      return css.slice(start, css.indexOf('}', start) + 1);
    };

    it('keeps opacity animation off ancestors of the backdrop-filter surface', () => {
      const css = modalsCss();
      const overlay = ruleBlock(css, '.modal-overlay');
      expect(overlay).not.toBeNull();
      expect(overlay).not.toMatch(/animation|opacity/);
      const overlayClosing = ruleBlock(css, '.modal-overlay.closing');
      if (overlayClosing !== null) {
        expect(overlayClosing).not.toMatch(/animation|opacity/);
      }
    });

    it('fades the backdrop through its own paint properties with held end states', () => {
      const css = modalsCss();
      expect(ruleBlock(css, '.modal-backdrop')).toMatch(
        /animation: modal-backdrop-fade-in 200ms ease-out both;/
      );
      expect(ruleBlock(css, '.modal-overlay.closing .modal-backdrop')).toMatch(
        /animation: modal-backdrop-fade-out 200ms ease-out both;/
      );
      for (const keyframes of ['modal-backdrop-fade-in', 'modal-backdrop-fade-out']) {
        const block = css.slice(css.indexOf(`@keyframes ${keyframes}`));
        const body = block.slice(0, block.indexOf('\n}'));
        expect(body).toContain('background-color');
        expect(body).toContain('backdrop-filter');
        expect(body).not.toContain('opacity');
      }
    });

    it('completes closing container motion within the 200ms unmount window and holds its end state', () => {
      // Modal owners unmount the surface 200ms after adding `closing`
      // (e.g. AboutModal); a longer or non-filled animation snaps back to
      // full opacity before removal.
      const containerClosing = ruleBlock(modalsCss(), '.modal-container.closing');
      expect(containerClosing).toMatch(/animation: modal-slide-down 200ms [^;]*both;/);
    });
  });
});
