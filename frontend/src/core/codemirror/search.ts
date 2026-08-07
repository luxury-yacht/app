/**
 * frontend/src/core/codemirror/search.ts
 *
 * Module source for search.
 * Implements search logic for the core layer.
 */

import {
  closeSearchPanel as cmCloseSearchPanel,
  openSearchPanel as cmOpenSearchPanel,
  getSearchQuery,
  highlightSelectionMatches,
  SearchQuery,
  search,
  searchKeymap,
  setSearchQuery,
} from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import type { KeyBinding } from '@codemirror/view';
import { type EditorView, keymap } from '@codemirror/view';

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

const removeNativeSearchLayout = (panel: HTMLElement): void => {
  panel.querySelectorAll('br').forEach((br) => {
    br.remove();
  });
  panel.querySelector<HTMLButtonElement>('button[name="close"]')?.remove();
  panel.querySelector<HTMLButtonElement>('button[name="select"]')?.remove();
};

const getOrCreateSearchRow = (panel: HTMLElement, className: string): HTMLDivElement => {
  const existing = panel.querySelector<HTMLDivElement>(`.${className}`);
  if (existing) {
    return existing;
  }
  const row = document.createElement('div');
  row.className = className;
  return row;
};

const updateNavButton = (button: HTMLButtonElement | null, label: '<' | '>'): void => {
  if (!button) {
    return;
  }
  const accessibleLabel = label === '>' ? 'Next match' : 'Previous match';
  button.textContent = label;
  button.setAttribute('aria-label', accessibleLabel);
  button.title = accessibleLabel;
};

const preparePrimarySearchRow = (panel: HTMLElement): HTMLDivElement => {
  const primaryRow = getOrCreateSearchRow(panel, 'cm-search-primary');
  const searchInput = panel.querySelector<HTMLInputElement>('input[name="search"]');

  if (searchInput && searchInput.parentElement !== primaryRow) {
    primaryRow.insertBefore(searchInput, primaryRow.firstChild ?? null);
  }
  return primaryRow;
};

const prepareSearchNavigation = (panel: HTMLElement, primaryRow: HTMLDivElement): void => {
  const navRow = getOrCreateSearchRow(panel, 'cm-search-nav');
  const previousButton = panel.querySelector<HTMLButtonElement>('button[name="prev"]');
  const nextButton = panel.querySelector<HTMLButtonElement>('button[name="next"]');
  while (navRow.firstChild) {
    navRow.removeChild(navRow.firstChild);
  }

  updateNavButton(previousButton, '<');
  updateNavButton(nextButton, '>');
  if (previousButton) {
    navRow.appendChild(previousButton);
  }
  if (nextButton) {
    navRow.appendChild(nextButton);
  }
  if (navRow.parentElement !== primaryRow) {
    primaryRow.appendChild(navRow);
  }
};

const prepareReplaceSearchRow = (panel: HTMLElement, mode: PanelMode): HTMLDivElement | null => {
  const replaceInput = panel.querySelector<HTMLInputElement>('input[name="replace"]');
  const replaceButtons = panel.querySelectorAll<HTMLButtonElement>(
    'button[name="replace"], button[name="replaceAll"]'
  );
  const existing = panel.querySelector<HTMLDivElement>('.cm-search-replace');
  if (!replaceInput && replaceButtons.length === 0) {
    existing?.remove();
    return null;
  }

  const container = existing ?? getOrCreateSearchRow(panel, 'cm-search-replace');
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
  return container;
};

const prepareAdvancedSearchRow = (panel: HTMLElement): HTMLDivElement | null => {
  const labels = Array.from(panel.querySelectorAll<HTMLLabelElement>('label'));
  const existing = panel.querySelector<HTMLDivElement>('.cm-search-advanced');
  if (labels.length === 0) {
    existing?.remove();
    return null;
  }

  const advanced = existing ?? getOrCreateSearchRow(panel, 'cm-search-advanced');
  while (advanced.firstChild) {
    advanced.removeChild(advanced.firstChild);
  }
  labels.forEach((label) => {
    advanced.appendChild(label);
  });
  advanced.hidden = true;
  advanced.setAttribute('aria-hidden', 'true');
  return advanced;
};

const orderSearchRows = (
  panel: HTMLElement,
  primaryRow: HTMLDivElement,
  replaceRow: HTMLDivElement | null,
  advancedRow: HTMLDivElement | null
): void => {
  const rows = [advancedRow, replaceRow, primaryRow];
  for (const row of rows) {
    if (row) {
      panel.insertBefore(row, panel.firstChild);
    }
  }
};

const layoutSearchPanel = (panel: HTMLElement): void => {
  removeNativeSearchLayout(panel);
  const mode = (panel.dataset.mode as PanelMode | undefined) ?? 'find';
  const primaryRow = preparePrimarySearchRow(panel);
  prepareSearchNavigation(panel, primaryRow);
  const replaceRow = prepareReplaceSearchRow(panel, mode);
  const advancedRow = prepareAdvancedSearchRow(panel);
  orderSearchRows(panel, primaryRow, replaceRow, advancedRow);
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
