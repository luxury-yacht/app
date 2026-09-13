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
  it('keeps keyboard focus distinguishable after component styles load', () => {
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
      const idleFill = getComputedStyle(control).backgroundColor;
      control.classList.add('keyboard-programmatic-focus');
      control.focus();
      const computed = getComputedStyle(control);
      expect(computed.backgroundColor, control.outerHTML).not.toBe(idleFill);
      control.blur();
      control.classList.remove('keyboard-programmatic-focus');
      expect(getComputedStyle(control).backgroundColor, control.outerHTML).toBe(idleFill);
    }
  });

  it('distinguishes the sidebar keyboard preview from an inactive item', () => {
    const style = installStyles(resolveFocusColors(readProjectFile('src/ui/layout/Sidebar.css')));
    style.dataset.cssContract = 'sidebar-focus-background';
    document.body.innerHTML = '<button class="sidebar-item keyboard-preview">Browse</button>';
    const button = requireValue(document.querySelector('button'), 'sidebar preview');
    const previewFill = getComputedStyle(button).backgroundColor;
    button.classList.remove('keyboard-preview');
    expect(getComputedStyle(button).backgroundColor).not.toBe(previewFill);
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

  it('keeps the shared hidden utility authoritative without important', () => {
    const style = installStyles(readProjectFile('styles/utilities/display.css'));
    style.dataset.cssContract = 'hidden';
    const hidden = document.createElement('div');
    hidden.className = 'hidden';
    hidden.style.display = '';
    document.body.appendChild(hidden);

    expect(window.getComputedStyle(hidden).display).toBe('none');
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

  it('keeps the Linux window outline from intercepting input', () => {
    const appHeaderCSS = readProjectFile('src/ui/layout/AppHeader.css');
    const linuxOutline = appHeaderCSS.match(/\.app-header--linux::after \{([\s\S]*?)\}/)?.[1];

    expect(linuxOutline).toContain('pointer-events: none');
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

  describe('modal closing lifecycle', () => {
    const modalsCss = () => readProjectFile('styles/components/modals.css');

    const ruleBlock = (css: string, selector: string) => {
      const marker = `${selector} {`;
      const start = css.indexOf(marker);
      if (start === -1) {
        return null;
      }
      return css.slice(start, css.indexOf('}', start) + 1);
    };

    it('completes closing container motion within the 200ms unmount window and holds its end state', () => {
      // Modal owners unmount the surface 200ms after adding `closing`
      // (e.g. AboutModal); a longer or non-filled animation snaps back to
      // full opacity before removal.
      const containerClosing = ruleBlock(modalsCss(), '.modal-container.closing');
      const duration = containerClosing?.match(/animation:\s*\S+\s+(\d+)ms/);
      expect(duration).not.toBeNull();
      expect(Number(duration?.[1])).toBeGreaterThan(0);
      expect(Number(duration?.[1])).toBeLessThanOrEqual(200);
      expect(containerClosing).toMatch(/\b(both|forwards)\b/);
    });
  });
});
