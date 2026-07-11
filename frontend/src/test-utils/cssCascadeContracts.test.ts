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
      <div class="fav-save-modal">
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

  it('limits important declarations to documented external and global-state boundaries', () => {
    const classifiedBoundaries = [
      ['src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.css', 3],
      ['src/ui/dockable/DockablePanel.css', 6],
      ['src/ui/layout/Sidebar.css', 2],
      ['styles/utilities/motion.css', 3],
    ] as const;

    for (const [path, expectedCount] of classifiedBoundaries) {
      const declarations = readProjectFile(path).match(/!important\b/g) ?? [];
      expect(declarations, path).toHaveLength(expectedCount);
    }
  });
});
