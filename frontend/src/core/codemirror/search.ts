/**
 * frontend/src/core/codemirror/search.ts
 *
 * Module source for search.
 * Implements search logic for the core layer.
 */

import { keymap, EditorView } from '@codemirror/view';
import type { KeyBinding } from '@codemirror/view';
import {
  SearchQuery,
  closeSearchPanel as cmCloseSearchPanel,
  getSearchQuery,
  highlightSelectionMatches,
  openSearchPanel as cmOpenSearchPanel,
  search,
  searchKeymap,
  setSearchQuery,
} from '@codemirror/search';
import type { Extension } from '@codemirror/state';

export interface SearchExtensionOptions {
  // When true, show the search panel at the top of the editor.
  // Defaults to true to match our existing layout.
  top?: boolean;
  // When true, include the custom search keymap bindings (Mod+F, Mod+Alt+F).
  // Disable when the host component provides its own shortcuts.
  enableKeymap?: boolean;
}

type PanelMode = 'find' | 'replace';

interface EnhanceOptions {
  mode?: PanelMode;
}

/**
 * Returns a reusable set of CodeMirror search extensions including the
 * search state, panel, keymap, and selection highlighting.
 */
export const createSearchExtensions = (options: SearchExtensionOptions = {}): Extension[] => {
  const { top = true, enableKeymap = true } = options;
  const extensions: Extension[] = [search({ top }), highlightSelectionMatches()];

  if (!enableKeymap) {
    return extensions;
  }

  const customBindings: KeyBinding[] = [
    {
      key: 'Mod-f',
      run: (view) => {
        openSearchPanel(view);
        return true;
      },
      preventDefault: true,
      scope: 'editor search-panel',
    },
    {
      key: 'Mod-Alt-f',
      run: (view) => {
        if (view.state.readOnly) {
          openSearchPanel(view);
        } else {
          openReplacePanel(view);
        }
        return true;
      },
      preventDefault: true,
      scope: 'editor search-panel',
    },
  ];

  const filteredSearchKeymap = searchKeymap.filter(
    (binding) => binding.key !== 'Mod-f' && binding.key !== 'Escape'
  );

  extensions.push(keymap.of([...customBindings, ...filteredSearchKeymap]));

  return extensions;
};

export const openSearchPanel = (view: EditorView | null | undefined): boolean => {
  if (!view) {
    return false;
  }
  const opened = cmOpenSearchPanel(view);
  enhanceSearchPanel(view, { mode: 'find' });
  return opened;
};

export const openReplacePanel = (view: EditorView | null | undefined): boolean => {
  if (!view) {
    return false;
  }

  const opened = cmOpenSearchPanel(view);
  enhanceSearchPanel(view, { mode: 'replace' });

  if (view.state.readOnly) {
    return opened;
  }

  const current = getSearchQuery(view.state);
  const query = new SearchQuery({
    search: current.search,
    caseSensitive: current.caseSensitive,
    literal: current.literal,
    regexp: current.regexp,
    wholeWord: current.wholeWord,
    replace: current.replace,
  });

  view.dispatch({
    effects: setSearchQuery.of(query),
  });

  window.requestAnimationFrame(() => {
    const replaceInput = findSearchElement<HTMLInputElement>(view, 'input[name="replace"]');
    replaceInput?.focus();
    replaceInput?.select();
  });

  return opened;
};

export const closeSearchPanel = (view: EditorView | null | undefined): boolean => {
  if (!view) {
    return false;
  }
  return cmCloseSearchPanel(view);
};

const findSearchElement = <T extends HTMLElement>(view: EditorView, selector: string): T | null => {
  const root = view.dom.parentElement ?? view.dom;
  return (root.querySelector(`.cm-search ${selector}`) as T | null) ?? null;
};

const enhanceSearchPanel = (view: EditorView, options: EnhanceOptions = {}, retries = 3): void => {
  const panel = getSearchPanel(view);
  if (!panel) {
    if (retries > 0) {
      window.requestAnimationFrame(() => enhanceSearchPanel(view, options, retries - 1));
    }
    return;
  }

  const mode = options.mode ?? (panel.dataset.mode as PanelMode | undefined) ?? 'find';
  panel.dataset.mode = mode;

  layoutSearchPanel(panel);
};

const getSearchPanel = (view: EditorView): HTMLElement | null => {
  const root = view.dom.parentElement ?? view.dom;
  return root.querySelector<HTMLElement>('.cm-search');
};

const layoutSearchPanel = (panel: HTMLElement): void => {
  panel.querySelectorAll('br').forEach((br) => br.remove());

  const mode = (panel.dataset.mode as PanelMode | undefined) ?? 'find';
  panel.querySelector<HTMLButtonElement>('button[name="close"]')?.remove();

  const searchInput = panel.querySelector<HTMLInputElement>('input[name="search"]');
  const nextButton = panel.querySelector<HTMLButtonElement>('button[name="next"]');
  const previousButton = panel.querySelector<HTMLButtonElement>('button[name="prev"]');
  panel.querySelector<HTMLButtonElement>('button[name="select"]')?.remove();

  const updateNavButton = (button: HTMLButtonElement | null, label: '<' | '>') => {
    if (!button) {
      return;
    }
    button.textContent = label;
    button.setAttribute('aria-label', label === '>' ? 'Next match' : 'Previous match');
    button.title = label === '>' ? 'Next match' : 'Previous match';
  };

  let primaryRow = panel.querySelector<HTMLDivElement>('.cm-search-primary');
  if (!primaryRow) {
    primaryRow = document.createElement('div');
    primaryRow.className = 'cm-search-primary';
  }

  if (searchInput && searchInput.parentElement !== primaryRow) {
    primaryRow.insertBefore(searchInput, primaryRow.firstChild ?? null);
  }

  let navRow = panel.querySelector<HTMLDivElement>('.cm-search-nav');
  if (!navRow) {
    navRow = document.createElement('div');
    navRow.className = 'cm-search-nav';
  }
  while (navRow.firstChild) {
    navRow.removeChild(navRow.firstChild);
  }
  updateNavButton(previousButton, '<');
  updateNavButton(nextButton, '>');
  if (previousButton) navRow.appendChild(previousButton);
  if (nextButton) navRow.appendChild(nextButton);
  if (navRow.parentElement !== primaryRow) {
    primaryRow.appendChild(navRow);
  }

  const replaceInput = panel.querySelector<HTMLInputElement>('input[name="replace"]');
  const replaceButtons = panel.querySelectorAll<HTMLButtonElement>(
    'button[name="replace"], button[name="replaceAll"]'
  );
  let replaceContainer = panel.querySelector<HTMLDivElement>('.cm-search-replace');
  if (replaceInput || replaceButtons.length > 0) {
    if (!replaceContainer) {
      replaceContainer = document.createElement('div');
      replaceContainer.className = 'cm-search-replace';
    }
    const container = replaceContainer as HTMLDivElement;
    if (replaceInput && replaceInput.parentElement !== container) {
      container.appendChild(replaceInput);
    }
    replaceButtons.forEach((button) => {
      if (button.parentElement !== container) {
        container.appendChild(button);
      }
    });
    const showReplace = mode === 'replace';
    container.toggleAttribute('hidden', !showReplace);
    container.setAttribute('aria-hidden', showReplace ? 'false' : 'true');
  } else if (replaceContainer) {
    replaceContainer.remove();
    replaceContainer = null;
  }

  const labels = Array.from(panel.querySelectorAll<HTMLLabelElement>('label'));
  let advancedContainer = panel.querySelector<HTMLDivElement>('.cm-search-advanced');
  if (labels.length > 0) {
    if (!advancedContainer) {
      advancedContainer = document.createElement('div');
      advancedContainer.className = 'cm-search-advanced';
    }
    const advanced = advancedContainer as HTMLDivElement;
    while (advanced.firstChild) {
      advanced.removeChild(advanced.firstChild);
    }
    labels.forEach((label) => {
      if (label.parentElement !== advanced) {
        advanced.appendChild(label);
      }
    });
    advanced.hidden = true;
    advanced.setAttribute('aria-hidden', 'true');
    advancedContainer = advanced;
  } else if (advancedContainer) {
    advancedContainer.remove();
    advancedContainer = null;
  }

  if (primaryRow.parentElement !== panel) {
    panel.appendChild(primaryRow);
  }
  panel.insertBefore(primaryRow, panel.firstChild);
  let insertAfter: Node = primaryRow;
  if (replaceContainer) {
    if (replaceContainer.parentElement !== panel) {
      panel.appendChild(replaceContainer);
    }
    panel.insertBefore(replaceContainer, insertAfter.nextSibling);
    insertAfter = replaceContainer;
  }
  if (advancedContainer) {
    if (advancedContainer.parentElement !== panel) {
      panel.appendChild(advancedContainer);
    }
    panel.insertBefore(advancedContainer, insertAfter.nextSibling);
  }
};

interface EnsureSearchPanelOptions {
  preserveFocus?: boolean;
}

export const ensureSearchPanelVisible = (
  view: EditorView | null | undefined,
  mode: PanelMode = 'find',
  options: EnsureSearchPanelOptions = {}
): boolean => {
  if (!view) {
    return false;
  }

  const { preserveFocus = false } = options;

  const opened = mode === 'replace' ? openReplacePanel(view) : openSearchPanel(view);

  if (opened && preserveFocus) {
    window.requestAnimationFrame(() => {
      if (!view.hasFocus) {
        view.focus();
      }
    });
  }

  return opened;
};
