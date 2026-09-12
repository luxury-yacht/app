import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

const readProjectFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const focusFill = 'rgba(50, 108, 229, 0.1)';
// jsdom can let a background shorthand overwrite a more-specific color, and
// returns different colors on repeated computed-style reads. Expand parseable
// shorthands into equivalent longhands in these focus fixtures.
const expandBackgroundShorthands = (source: string) =>
  source.replace(/\bbackground:\s*([^;{}]+);/g, (declaration, value: string) => {
    const style = document.createElement('div').style;
    style.background = value;
    if (!style.backgroundColor) {
      return declaration;
    }
    return ['color', 'image', 'position', 'size', 'repeat', 'origin', 'clip', 'attachment']
      .map((name) => `background-${name}: ${style.getPropertyValue(`background-${name}`)};`)
      .join('\n');
  });

// Resolve the theme colors explicitly because jsdom does not resolve these
// custom properties when computing the cascade.
const resolveFocusColors = (source: string) =>
  expandBackgroundShorthands(
    source
      .replace(/var\(--focus-background, var\(--color-accent-bg\)\)/g, focusFill)
      .replace(/var\(--color-accent-bg\)/g, focusFill)
      .replace(/var\(--color-accent\)/g, 'rgb(50, 108, 229)')
      .replace(/var\(--color-bg\)/g, 'rgb(255, 255, 255)')
      .replace(/var\(--color-bg-secondary\)/g, 'rgb(240, 240, 240)')
      .replace(/var\(--color-bg-tertiary\)/g, 'rgb(230, 230, 230)')
      .replace(/var\(--color-bg-tertiary, rgba\(255, 255, 255, 0\.05\)\)/g, 'rgb(230, 230, 230)')
      .replace(/var\(--dropdown-menu-bg\)/g, 'rgb(255, 255, 255)')
      .replace(/var\(--color-text\)/g, 'rgb(20, 20, 20)')
  );

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
  document.body.style.cursor = '';
  delete document.body.dataset.windowResizeCursor;
});

describe('strict CSS cascade contracts', () => {
  it.each([false, true])('preserves the YAML editor background when editable=%s', (editable) => {
    const style = installStyles(
      ...[
        'src/shared/components/yaml/YamlEditor.css',
        'styles/overrides/codemirror.css',
        'styles/utilities/focus.css',
      ].map((path) =>
        resolveFocusColors(readProjectFile(path)).replace(/:hover/g, '.css-contract-hover')
      )
    );
    style.dataset.cssContract = 'yaml-editor-focus';
    document.body.innerHTML = `
      <div class="yaml-editor">
        <div class="yaml-editor-header">
          <input class="find-input" aria-label="Find in YAML" />
          <button class="button">Copy YAML</button>
        </div>
        <div class="codemirror-shell yaml-editor-shell" tabindex="-1">
          <div class="cm-editor" tabindex="-1">
            <div class="cm-scroller">
              <div class="cm-content" contenteditable="${editable}" tabindex="0">
                <div class="cm-line">kind: Pod</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    for (const element of document.querySelectorAll<HTMLElement>(
      '.yaml-editor-shell [tabindex], .yaml-editor-shell'
    )) {
      const idleFill = getComputedStyle(element).backgroundColor;
      element.focus();
      expect(getComputedStyle(element).backgroundColor, element.className).toBe(idleFill);
      element.classList.add('keyboard-programmatic-focus');
      expect(getComputedStyle(element).backgroundColor, element.className).toBe(idleFill);
      element.classList.add('css-contract-hover');
      expect(getComputedStyle(element).backgroundColor, element.className).toBe(idleFill);
      element.blur();
    }
    for (const control of document.querySelectorAll<HTMLElement>(
      '.yaml-editor-header input, .yaml-editor-header button'
    )) {
      control.classList.add('keyboard-programmatic-focus');
      control.focus();
      expect(getComputedStyle(control).backgroundColor, control.outerHTML).toBe(focusFill);
    }
  });

  it.each([false, true])(
    'preserves menu colors with shared focus styles loaded last=%s',
    (focusLast) => {
      const sources = [
        'styles/utilities/focus.css',
        'styles/components/dropdowns.css',
        'src/shared/components/ContextMenu.css',
      ];
      if (focusLast) {
        sources.reverse();
      }
      const style = installStyles(
        ...sources.map((path) =>
          resolveFocusColors(readProjectFile(path)).replace(/:hover/g, '.css-contract-hover')
        )
      );
      style.dataset.cssContract = 'menu-focus-colors';
      document.body.innerHTML = `
      <button id="trigger" class="dropdown-trigger">Open</button>
      <div id="dropdown" class="dropdown-menu" role="listbox" tabindex="-1">
        <button id="highlighted" class="dropdown-option highlighted" role="option">Highlighted</button>
        <button id="selected" class="dropdown-option selected" role="option">Selected</button>
        <button id="selected-highlighted" class="dropdown-option selected highlighted" role="option">Both</button>
        <input id="search" class="search-input" />
        <button id="only" class="dropdown-only-action">only</button>
      </div>
      <dialog open class="dropdown-menu dropdown-filter-menu">
        <div class="dropdown-option-row highlighted">
          <button id="filter-selected" class="dropdown-option selected highlighted">Selected filter</button>
        </div>
      </dialog>
      <div id="context" class="context-menu" role="menu" tabindex="-1">
        <button id="context-item" class="context-menu-item is-focused" role="menuitem">Open</button>
        <button id="danger-item" class="context-menu-item danger is-focused" role="menuitem">Delete</button>
      </div>
    `;
      const cases = [
        ['trigger', focusFill],
        ['dropdown', 'rgb(255, 255, 255)'],
        ['highlighted', 'rgb(230, 230, 230)'],
        ['selected', 'rgb(230, 230, 230)'],
        ['selected-highlighted', 'rgb(230, 230, 230)'],
        ['search', focusFill],
        ['only', focusFill],
        ['context', 'rgb(255, 255, 255)'],
        ['context-item', 'rgb(240, 240, 240)'],
        ['danger-item', 'rgba(239, 68, 68, 0.1)'],
      ];
      for (const [id, color] of cases) {
        const element = requireValue(document.getElementById(id), id);
        element.classList.add('keyboard-programmatic-focus');
        element.focus();
        expect(getComputedStyle(element).backgroundColor, id).toBe(color);
        element.classList.add('css-contract-hover');
        expect(getComputedStyle(element).backgroundColor, `${id} hovered`).toBe(color);
        element.blur();
      }
      const filter = requireValue(document.getElementById('filter-selected'), 'filter option');
      filter.classList.add('keyboard-programmatic-focus');
      filter.focus();
      expect(getComputedStyle(filter).backgroundColor).toBe('rgba(0, 0, 0, 0)');
      filter.classList.add('css-contract-hover');
      expect(getComputedStyle(filter).backgroundColor).toBe('rgb(230, 230, 230)');
    }
  );

  it('uses the shared background cue after component styles load without changing control layout', () => {
    const sources = [
      'styles/utilities/focus.css',
      'styles/components/buttons.css',
      'styles/components/tabs.css',
      'src/ui/layout/Sidebar.css',
      'src/ui/layout/AppHeader.css',
      'src/ui/dockable/DockablePanel.css',
      'src/shared/components/ToggleSwitch.css',
      'src/shared/components/modals/ScaleModal.css',
      'src/shared/components/tables/TablePaginationControls.css',
      'styles/components/search-input.css',
      'styles/components/inputs.css',
      'src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.css',
      'src/ui/status/SessionsStatus.css',
    ];
    const style = installStyles(
      ...sources.map((path) => resolveFocusColors(readProjectFile(path)))
    );
    style.dataset.cssContract = 'focus-background';
    document.body.innerHTML = `
      <button class="button">Button</button>
      <div class="app-header"><button class="settings-button">Settings</button></div>
      <button class="sidebar-item">Browse</button>
      <button role="tab" class="tab-item">YAML</button>
      <button class="tab-item__close">Close tab</button>
      <button class="dockable-panel__control-btn">Dock</button>
      <button class="toggle-switch">Toggle</button>
      <div class="scale-modal-footer"><button class="button">Scale</button></div>
      <button class="table-pagination-button">Next</button>
      <div class="search-input-wrapper"><input class="search-input-field" /></div>
      <div class="yaml-search-controls"><div class="find-controls"><input class="find-input" /></div></div>
      <div class="sessions-status-message"><button class="as-shell-session-jump">Session</button></div>
    `;
    for (const control of document.querySelectorAll<HTMLElement>('button, input')) {
      const width = getComputedStyle(control).width;
      const idleFill = getComputedStyle(control).backgroundColor;
      control.classList.add('keyboard-programmatic-focus');
      control.focus();
      const computed = getComputedStyle(control);
      expect(computed.outlineStyle, control.outerHTML).toMatch(/^(none|)$/);
      expect(computed.boxShadow, control.outerHTML).toBe('none');
      expect(computed.backgroundColor, control.outerHTML).toBe(focusFill);
      expect(computed.width, control.outerHTML).toBe(width);
      control.blur();
      control.classList.remove('keyboard-programmatic-focus');
      expect(getComputedStyle(control).backgroundColor, control.outerHTML).toBe(idleFill);
    }
  });

  it('uses the shared background cue for sidebar arrow preview without a halo', () => {
    const style = installStyles(resolveFocusColors(readProjectFile('src/ui/layout/Sidebar.css')));
    style.dataset.cssContract = 'sidebar-focus-background';
    document.body.innerHTML = '<button class="sidebar-item keyboard-preview">Browse</button>';
    const button = requireValue(document.querySelector('button'), 'sidebar preview');
    expect(getComputedStyle(button).boxShadow).toMatch(/^(none|)$/);
    expect(getComputedStyle(button).backgroundColor).toBe(focusFill);
    button.classList.remove('keyboard-preview');
    expect(getComputedStyle(button).backgroundColor).not.toBe(focusFill);
  });

  it('retains a visible focus indicator when forced colors suppress box shadows', () => {
    const source = installStyles(readProjectFile('styles/utilities/focus.css'));
    source.dataset.cssContract = 'forced-color-source';
    // jsdom does not select forced-color media rules. Apply that media block
    // explicitly; rendered browser checks verify the OS-mode behavior separately.
    const sheet = requireValue(source.sheet, 'focus stylesheet');
    const forcedRules = Array.from(sheet.cssRules).flatMap((rule) => {
      if (rule instanceof CSSMediaRule && rule.conditionText === '(forced-colors: active)') {
        return Array.from(rule.cssRules).map((child) => child.cssText);
      }
      return [];
    });
    const forced = installStyles(
      ...forcedRules.map((rule) => rule.replace(/var\(--focus-system-outline-width\)/g, '2px'))
    );
    forced.dataset.cssContract = 'forced-color-focus';
    document.body.innerHTML = '<button class="keyboard-programmatic-focus">Apply</button>';
    const button = requireValue(document.querySelector('button'), 'focused button');
    button.focus();
    expect(getComputedStyle(button).outline).toContain('solid');
  });

  it('highlights the focused port input without adding a halo to its group', () => {
    const style = installStyles(
      resolveFocusColors(readProjectFile('styles/utilities/focus.css')),
      resolveFocusColors(readProjectFile('src/modules/port-forward/PortForwardModal.css'))
    );
    style.dataset.cssContract = 'port-input-focus';
    document.body.innerHTML =
      '<div class="port-forward-input-group"><input class="port-forward-input keyboard-programmatic-focus" /></div>';
    const input = requireValue(document.querySelector('input'), 'port input');
    input.focus();
    const group = requireValue(document.querySelector('.port-forward-input-group'), 'port group');
    expect(getComputedStyle(input).backgroundColor).toBe(focusFill);
    expect(getComputedStyle(group).boxShadow).toMatch(/^(none|)$/);
    expect(getComputedStyle(group).borderTopColor).toBe('rgb(50, 108, 229)');
  });

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

  it('keeps GridTable filters outside the right-docked panel paint area', () => {
    const gridTableCSS = readProjectFile('styles/components/gridtables.css');
    const filterContainer = gridTableCSS.match(
      /\.content-body \.gridtable-filter-container \{([\s\S]*?)\}/
    )?.[1];

    expect(filterContainer).toContain('margin-right: var(--dock-right-offset, 0px)');
  });

  it.each([false, true])(
    'applies the dock offset once to split filters (global styles last=%s)',
    (globalLast) => {
      const grid = readProjectFile('styles/components/gridtables.css').replace(
        /var\(--dock-right-offset, 0px\)/g,
        '320px'
      );
      const split = readProjectFile(
        'src/modules/namespace/components/WorkloadsPodsSplit.css'
      ).replace(/var\(--dock-right-offset, 0px\)/g, '320px');
      const style = installStyles(...(globalLast ? [split, grid] : [grid, split]));
      style.dataset.cssContract = 'split-filter-offset';
      document.body.innerHTML = `
      <div class="content-body">
        <div class="gridtable-filter-container" id="ordinary"></div>
        <div class="workloads-pods-split"><div class="gridtable-filter-container" id="split"></div></div>
      </div>`;
      expect(
        window.getComputedStyle(document.querySelector('#ordinary') as HTMLElement).marginRight
      ).toBe('320px');
      expect(
        window.getComputedStyle(document.querySelector('#split') as HTMLElement).marginRight
      ).toBe('0px');
    }
  );

  it('keeps dark dropdown surfaces raised while the application menu matches its page', () => {
    const darkCSS = readProjectFile('styles/appearance-modes/dark.css');
    const token = (name: string) => darkCSS.match(new RegExp(`${name}:\\s*([^;]+)`))?.[1];
    expect(token('--dropdown-menu-bg')).toBe('var(--color-base-800)');
    expect(token('--dropdown-menu-border')).toBe('var(--color-base-700)');
    const menuStyle = installStyles(
      readProjectFile('src/ui/layout/AppMenuBar.css')
        .replace(/var\(--color-bg\)/g, 'rgb(10, 10, 10)')
        .replace(/var\(--color-bg-tertiary\)/g, 'rgb(30, 30, 30)')
    );
    menuStyle.dataset.cssContract = 'dropdown-surfaces';
    document.body.innerHTML = '<div class="app-menu-dropdown"></div>';
    expect(
      window.getComputedStyle(document.querySelector('.app-menu-dropdown') as HTMLElement)
        .backgroundColor
    ).toBe('rgb(10, 10, 10)');
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
      ['src/ui/layout/windowResizeCursor.css', 1],
      ['styles/utilities/motion.css', 0],
    ] as const;

    for (const [path, expectedCount] of classifiedBoundaries) {
      const declarations = readProjectFile(path).match(/!important\b/g) ?? [];
      expect(declarations, path).toHaveLength(expectedCount);
    }
  });

  it('keeps frameless window drag regions out of every header control surface', () => {
    const appHeaderCSS = readProjectFile('src/ui/layout/AppHeader.css');
    const appMenuCSS = readProjectFile('src/ui/layout/AppMenuBar.css');
    const customFrame = appHeaderCSS.match(/\.app-header--custom-frame \{([\s\S]*?)\}/)?.[1];
    const headerControls = appHeaderCSS.match(/\.app-header-controls \{([\s\S]*?)\}/)?.[1];
    const windowControls = appHeaderCSS.match(/\.app-header-window-controls \{([\s\S]*?)\}/)?.[1];
    const windowControl = appHeaderCSS.match(/\.app-header-window-control \{([\s\S]*?)\}/)?.[1];
    const menuBar = appMenuCSS.match(/\.app-menu-bar \{([\s\S]*?)\}/)?.[1];

    expect(customFrame).toContain('app-region: drag');
    expect(headerControls).toContain('--wails-draggable: no-drag');
    expect(headerControls).toContain('app-region: no-drag');
    expect(windowControls).toContain('--wails-draggable: no-drag');
    expect(windowControls).toContain('app-region: no-drag');
    expect(windowControl).toContain('--wails-draggable: no-drag');
    expect(windowControl).toContain('app-region: no-drag');
    expect(menuBar).toContain('--wails-draggable: no-drag');
    expect(menuBar).toContain('app-region: no-drag');
  });

  it('keeps the Linux window outline fixed above app content without intercepting input', () => {
    const appHeaderCSS = readProjectFile('src/ui/layout/AppHeader.css');
    const linuxOutline = appHeaderCSS.match(/\.app-header--linux::after \{([\s\S]*?)\}/)?.[1];

    expect(linuxOutline).toContain('content: ""');
    expect(linuxOutline).toContain('position: fixed');
    expect(linuxOutline).toContain('inset: 0');
    expect(linuxOutline).toContain('z-index: var(--z-index-topmost)');
    expect(linuxOutline).toContain('pointer-events: none');
    expect(linuxOutline).toContain(
      'box-shadow: inset 0 0 0 var(--border-width) var(--color-border)'
    );
    expect(appHeaderCSS).not.toContain('.app-header--custom-frame::after');
    expect(appHeaderCSS).not.toContain('.app-header--mac::after');
  });

  it('keeps the native directional resize cursor above descendant cursor rules', () => {
    const windowResizeCursorCSS = readProjectFile('src/ui/layout/windowResizeCursor.css');
    const directionalCursors = [
      'n-resize',
      'ne-resize',
      'e-resize',
      'se-resize',
      's-resize',
      'sw-resize',
      'w-resize',
      'nw-resize',
    ] as const;

    for (const cursor of directionalCursors) {
      expect(windowResizeCursorCSS).toContain(
        `body[data-window-resize-cursor="${cursor}"] {\n  --window-resize-cursor: ${cursor};\n}`
      );
    }
    expect(windowResizeCursorCSS).toContain('body[data-window-resize-cursor] * {');
    expect(windowResizeCursorCSS).toContain('cursor: var(--window-resize-cursor) !important;');
  });

  it('presents frameless window actions as compact app toolbar controls', () => {
    const appHeaderCSS = readProjectFile('src/ui/layout/AppHeader.css');
    const windowControls = appHeaderCSS.match(/\.app-header-window-controls \{([\s\S]*?)\}/)?.[1];
    const windowControl = appHeaderCSS.match(/\.app-header-window-control \{([\s\S]*?)\}/)?.[1];
    const glyph = appHeaderCSS.match(/\.app-header-window-control-glyph \{([\s\S]*?)\}/)?.[1];

    expect(windowControls).toContain('align-items: center');
    expect(windowControls).toContain('gap: var(--border-radius-xs)');
    expect(windowControls).toContain('padding-left: var(--spacing-sm)');
    expect(windowControl).toContain('width: var(--app-header-window-control-size)');
    expect(windowControl).toContain('height: var(--app-header-window-control-size)');
    expect(windowControl).toContain('border-radius: var(--border-radius-sm)');
    expect(glyph).toContain('width: var(--app-header-window-control-icon-size)');
    expect(glyph).toContain('height: var(--app-header-window-control-icon-size)');
    expect(appHeaderCSS).not.toContain('.app-header-window-control--close:hover');
  });

  it('highlights only the active menu title and uses the menu item text size', () => {
    const appMenuCSS = readProjectFile('src/ui/layout/AppMenuBar.css');
    const trigger = appMenuCSS.match(/\.app-menu-trigger \{([\s\S]*?)\}/)?.[1];
    const openTrigger = appMenuCSS.match(/\.app-menu-trigger--open \{([\s\S]*?)\}/)?.[1];

    expect(trigger).toContain('font-size: var(--font-size-normal)');
    expect(openTrigger).toContain('background: var(--color-bg)');
    expect(appMenuCSS).not.toContain('var(--hover-bg)');
  });

  it('keeps the workspace menu above main chrome and below blocking modals', () => {
    const appMenuCSS = readProjectFile('src/ui/layout/AppMenuBar.css');
    const elevationCSS = readProjectFile('styles/tokens/elevation.css');
    const menuBar = appMenuCSS.match(/\.app-menu-bar \{([\s\S]*?)\}/)?.[1];
    const tokenValue = (name: string) =>
      Number(elevationCSS.match(new RegExp(`--${name}:\\s*(\\d+)`))?.[1]);

    expect(menuBar).toContain('z-index: var(--z-index-app-menu)');
    expect(tokenValue('z-index-panel')).toBeLessThan(tokenValue('z-index-app-menu'));
    expect(tokenValue('z-index-app-menu')).toBeLessThan(tokenValue('z-index-modal-backdrop'));
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
