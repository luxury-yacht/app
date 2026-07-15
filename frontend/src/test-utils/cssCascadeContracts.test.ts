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
    expect(window.getComputedStyle(row as HTMLElement).marginTop).toBe('0.2rem');
    expect(Number.parseFloat(window.getComputedStyle(button as HTMLButtonElement).marginTop)).toBe(
      0
    );
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
});
