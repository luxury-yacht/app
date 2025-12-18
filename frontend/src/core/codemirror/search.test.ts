import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const viewMocks = vi.hoisted(() => ({
  keymapOf: vi.fn((bindings: unknown) => bindings),
}));

type SearchQueryOptions = {
  search: string;
  caseSensitive: boolean;
  literal: boolean;
  regexp: boolean;
  wholeWord: boolean;
  replace: string;
};

const searchMocks = vi.hoisted(() => {
  const getSearchQuery = vi.fn(
    (): SearchQueryOptions => ({
      search: 'term',
      caseSensitive: false,
      literal: false,
      regexp: false,
      wholeWord: false,
      replace: 'replace-term',
    })
  );

  class SearchQuery {
    search: string;
    caseSensitive: boolean;
    literal: boolean;
    regexp: boolean;
    wholeWord: boolean;
    replace: string;

    constructor(options: SearchQueryOptions) {
      this.search = options.search;
      this.caseSensitive = options.caseSensitive;
      this.literal = options.literal;
      this.regexp = options.regexp;
      this.wholeWord = options.wholeWord;
      this.replace = options.replace;
    }
  }

  return {
    search: vi.fn((opts: unknown) => ({ type: 'search-extension', opts })),
    highlightSelectionMatches: vi.fn(() => 'highlight-extension'),
    searchKeymap: [
      { key: 'Mod-f', run: vi.fn() },
      { key: 'Escape', run: vi.fn() },
      { key: 'Mod-Alt-f', run: vi.fn() },
    ],
    openSearchPanel: vi.fn(() => true),
    closeSearchPanel: vi.fn(() => true),
    getSearchQuery,
    setSearchQuery: {
      of: vi.fn((query: unknown) => ({ effect: query })),
    },
    SearchQuery,
  };
});

vi.mock('@codemirror/view', () => ({
  keymap: {
    of: (...args: any[]) => (viewMocks.keymapOf as any)(...args),
  },
  EditorView: class {},
}));

vi.mock('@codemirror/search', () => ({
  search: (...args: any[]) => (searchMocks.search as any)(...args),
  highlightSelectionMatches: (...args: any[]) =>
    (searchMocks.highlightSelectionMatches as any)(...args),
  searchKeymap: searchMocks.searchKeymap,
  openSearchPanel: (...args: any[]) => (searchMocks.openSearchPanel as any)(...args),
  closeSearchPanel: (...args: any[]) => (searchMocks.closeSearchPanel as any)(...args),
  getSearchQuery: (...args: any[]) => (searchMocks.getSearchQuery as any)(...args),
  setSearchQuery: searchMocks.setSearchQuery,
  SearchQuery: searchMocks.SearchQuery,
}));

import {
  closeSearchPanel,
  createSearchExtensions,
  ensureSearchPanelVisible,
  openReplacePanel,
  openSearchPanel,
} from './search';

const createPanel = () => {
  const panel = document.createElement('div');
  panel.className = 'cm-search';
  panel.appendChild(document.createElement('br'));

  const searchInput = document.createElement('input');
  searchInput.name = 'search';
  panel.appendChild(searchInput);

  const prev = document.createElement('button');
  prev.name = 'prev';
  panel.appendChild(prev);

  const next = document.createElement('button');
  next.name = 'next';
  panel.appendChild(next);

  const closeButton = document.createElement('button');
  closeButton.name = 'close';
  panel.appendChild(closeButton);

  const replaceInput = document.createElement('input');
  replaceInput.name = 'replace';
  panel.appendChild(replaceInput);

  const replaceButton = document.createElement('button');
  replaceButton.name = 'replace';
  panel.appendChild(replaceButton);

  const replaceAllButton = document.createElement('button');
  replaceAllButton.name = 'replaceAll';
  panel.appendChild(replaceAllButton);

  const label = document.createElement('label');
  label.textContent = 'Match case';
  panel.appendChild(label);

  return panel;
};

const createView = (options: { readOnly?: boolean } = {}) => {
  const root = document.createElement('div');
  const panel = createPanel();
  root.appendChild(panel);

  const view = {
    dom: root,
    state: {
      readOnly: options.readOnly ?? false,
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
    hasFocus: false,
  };

  return { view, panel };
};

describe('core/codemirror/search helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('creates search extensions with keymap enabled by default', () => {
    const extensions = createSearchExtensions();
    expect(searchMocks.search).toHaveBeenCalledWith({ top: true });
    expect(searchMocks.highlightSelectionMatches).toHaveBeenCalled();
    expect(Array.isArray(extensions)).toBe(true);
    const bindings = viewMocks.keymapOf.mock.calls[0][0] as any[];
    expect(bindings.some((binding) => binding.key === 'Mod-f')).toBe(true);
    expect(bindings.some((binding) => binding.key === 'Escape')).toBe(false);
  });

  it('skips keymap when disabled', () => {
    viewMocks.keymapOf.mockClear();
    const extensions = createSearchExtensions({ enableKeymap: false, top: false });
    expect(searchMocks.search).toHaveBeenLastCalledWith({ top: false });
    expect(viewMocks.keymapOf).not.toHaveBeenCalled();
    expect(extensions.length).toBe(2);
  });

  it('returns false when opening panels without a view', () => {
    expect(openSearchPanel(undefined)).toBe(false);
    expect(openReplacePanel(null)).toBe(false);
    expect(closeSearchPanel(null)).toBe(false);
  });

  it('opens the search panel and enhances layout', () => {
    const { view, panel } = createView();
    const opened = openSearchPanel(view as any);
    expect(opened).toBe(true);
    expect(searchMocks.openSearchPanel).toHaveBeenCalledWith(view);
    expect(panel.dataset.mode).toBe('find');
    expect(panel.querySelector('.cm-search-primary')).toBeTruthy();
    expect(panel.querySelector('.cm-search-nav')).toBeTruthy();
  });

  it('opens the replace panel, updates query, and focuses replace input', () => {
    const { view, panel } = createView();
    const replaceInput = panel.querySelector<HTMLInputElement>('input[name="replace"]')!;
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });

    const opened = openReplacePanel(view as any);
    expect(opened).toBe(true);
    expect(searchMocks.openSearchPanel).toHaveBeenCalledWith(view);
    expect(searchMocks.setSearchQuery.of).toHaveBeenCalled();
    expect(view.dispatch).toHaveBeenCalledWith({
      effects: expect.objectContaining({ effect: expect.objectContaining({ search: 'term' }) }),
    });
    const replaceContainer = replaceInput.parentElement as HTMLElement;
    expect(replaceContainer.getAttribute('aria-hidden')).toBe('false');
    raf.mockRestore();
  });

  it('respects read-only views when opening replace panel', () => {
    const { view } = createView({ readOnly: true });
    openReplacePanel(view as any);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it('closes the search panel', () => {
    const { view } = createView();
    const closed = closeSearchPanel(view as any);
    expect(closed).toBe(true);
    expect(searchMocks.closeSearchPanel).toHaveBeenCalledWith(view);
  });

  it('ensures the search panel is visible and preserves focus', () => {
    const { view } = createView();
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    const opened = ensureSearchPanelVisible(view as any, 'replace', { preserveFocus: true });
    expect(opened).toBe(true);
    expect(searchMocks.openSearchPanel).toHaveBeenCalled();
    expect(view.focus).toHaveBeenCalled();
    raf.mockRestore();
  });
});
