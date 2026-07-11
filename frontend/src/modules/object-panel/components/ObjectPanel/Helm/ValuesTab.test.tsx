/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Helm/ValuesTab.test.tsx
 *
 * Covers mode switching (defaults, overrides, merged), loading/error/empty
 * states, and correct recursive value computation with typed helpers.
 */

import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as YAML from 'yaml';
import { requireValue } from '@/test-utils/requireValue';

interface CapturedCodeMirrorProps {
  value: string;
  onCreateEditor?: (view: unknown) => void;
  ref?: React.Ref<unknown>;
}

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const searchShortcutMocks = vi.hoisted(() => ({
  useSearchShortcutTarget: vi.fn(),
  useKeyboardSurface: vi.fn(),
}));

const refreshMocks = vi.hoisted(() => ({
  setScopedDomainEnabled: vi.fn(),
  acquireScopedDomainLease: vi.fn(),
  releaseScopedDomainLease: vi.fn(),
  fetchScopedDomain: vi.fn(() => Promise.resolve()),
}));

const refreshStoreMocks = vi.hoisted(() => ({
  useRefreshScopedDomain: vi.fn(),
  getScopedDomainState: vi.fn(),
}));

const autoRefreshLoadingState = vi.hoisted(() => ({
  isPaused: false,
  isManualRefreshActive: false,
  suppressPassiveLoading: false,
}));

const codeMirrorState = {
  latestProps: { current: { value: '' } as CapturedCodeMirrorProps },
  editorView: {
    state: {
      selection: { main: { from: 0, to: 0 } },
      sliceDoc: vi.fn(() => ''),
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
  },
  value: '',
};

const CodeMirrorMock = ({ ref, ...props }: CapturedCodeMirrorProps) => {
  const { onCreateEditor } = props;
  codeMirrorState.value = props.value;
  codeMirrorState.latestProps.current = props;
  if (ref && typeof ref === 'object') {
    (ref as React.RefObject<{ view: typeof codeMirrorState.editorView } | null>).current = {
      view: codeMirrorState.editorView,
    };
  }
  React.useEffect(() => {
    onCreateEditor?.(codeMirrorState.editorView);
  }, [onCreateEditor]);
  return (
    <div data-testid="code-mirror" data-value={props.value}>
      {props.value}
    </div>
  );
};
CodeMirrorMock.displayName = 'CodeMirrorMock';

const themeMocks = vi.hoisted(() => ({
  buildCodeTheme: vi.fn(() => ({ theme: 'dark', highlight: 'highlight-ext' })),
}));

const searchModuleMocks = vi.hoisted(() => ({
  createSearchExtensions: vi.fn(() => ['search-ext']),
  closeSearchPanel: vi.fn(),
}));

const codemirrorSearchMocks = vi.hoisted(() => {
  class SearchQuery {
    search!: string;
    constructor(options: Record<string, unknown>) {
      Object.assign(this, options);
    }
  }
  return {
    SearchQuery,
    findNext: vi.fn(),
    findPrevious: vi.fn(),
    getSearchQuery: vi.fn(() => ({
      search: '',
      caseSensitive: false,
      literal: false,
      regexp: false,
      wholeWord: false,
      replace: '',
    })),
    setSearchQuery: { of: vi.fn((q: unknown) => q) },
  };
});

// ---------------------------------------------------------------------------
// vi.mock calls
// ---------------------------------------------------------------------------

vi.mock('@ui/shortcuts', () => ({
  useKeyboardSurface: (config: unknown) => searchShortcutMocks.useKeyboardSurface(config),
  useSearchShortcutTarget: (config: unknown) => searchShortcutMocks.useSearchShortcutTarget(config),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: refreshMocks,
  useRefreshScopedDomain: refreshStoreMocks.useRefreshScopedDomain,
}));

vi.mock('@/core/refresh/store', () => ({
  useRefreshScopedDomain: refreshStoreMocks.useRefreshScopedDomain,
  getScopedDomainState: refreshStoreMocks.getScopedDomainState,
}));

vi.mock('@/core/refresh/hooks/useAutoRefreshLoadingState', () => ({
  useAutoRefreshLoadingState: () => autoRefreshLoadingState,
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => !autoRefreshLoadingState.isPaused,
}));

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: CodeMirrorMock,
}));

vi.mock('@codemirror/lang-yaml', () => ({
  yaml: () => 'yaml-extension',
}));

vi.mock('@codemirror/view', () => ({
  EditorView: Object.assign(class EditorViewMock {}, {
    contentAttributes: {
      of: (attrs: unknown) => ({ type: 'contentAttributes', attrs }),
    },
    domEventHandlers(handlers: unknown) {
      return handlers;
    },
    lineWrapping: 'lineWrapping',
  }),
  keymap: {
    of: (bindings: unknown) => bindings,
  },
}));

vi.mock('@codemirror/search', () => ({
  SearchQuery: codemirrorSearchMocks.SearchQuery,
  findNext: codemirrorSearchMocks.findNext,
  findPrevious: codemirrorSearchMocks.findPrevious,
  getSearchQuery: codemirrorSearchMocks.getSearchQuery,
  setSearchQuery: codemirrorSearchMocks.setSearchQuery,
}));

vi.mock('@/core/codemirror/theme', () => ({
  buildCodeTheme: themeMocks.buildCodeTheme,
}));

vi.mock('@/core/codemirror/search', () => ({
  createSearchExtensions: searchModuleMocks.createSearchExtensions,
  closeSearchPanel: searchModuleMocks.closeSearchPanel,
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: { handle: vi.fn() },
}));

vi.mock('@shared/components/LoadingSpinner', () => ({
  __esModule: true,
  default: ({ message }: { message: string }) => <div data-testid="spinner">{message}</div>,
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const ALL_VALUES = {
  replicaCount: 1,
  image: { repository: 'nginx', tag: 'latest' },
  service: { type: 'ClusterIP', port: 80 },
};

const USER_VALUES = {
  replicaCount: 3,
  image: { tag: 'v2.0' },
};

type SnapshotStatus = 'idle' | 'loading' | 'ready' | 'updating' | 'initialising' | 'error';

type Snapshot = {
  status: SnapshotStatus;
  data?: {
    values?: { allValues?: Record<string, unknown>; userValues?: Record<string, unknown> } | null;
  } | null;
  error?: string | null;
};

const snapshotState: { current: Snapshot } = {
  current: {
    status: 'ready',
    data: { values: { allValues: ALL_VALUES, userValues: USER_VALUES } },
    error: null,
  },
};

refreshStoreMocks.useRefreshScopedDomain.mockImplementation(() => snapshotState.current);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the YAML string that was passed to CodeMirror's value prop. */
const parsedValue = () => YAML.parse(codeMirrorState.value);

const waitForUpdates = async () => {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
};

const renderValuesTab = async (
  props: Partial<{ scope: string | null; isActive: boolean }> = {}
) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const defaultProps = { scope: 'prod:helmrelease:my-app', isActive: true };

  await act(async () => {
    const { default: ValuesTab } = await import('./ValuesTab');
    root.render(<ValuesTab {...defaultProps} {...props} />);
  });

  return {
    container,
    root,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

/** Click a SegmentedButton option by its label text. */
const clickSegmentedOption = async (container: HTMLElement, label: string) => {
  const btn = Array.from(container.querySelectorAll('.segmented-button__option')).find(
    (el) => el.textContent === label
  );
  await act(async () => {
    requireValue(btn, 'expected test value in ValuesTab.test.tsx').dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
  });
  await waitForUpdates();
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ValuesTab', () => {
  beforeEach(() => {
    snapshotState.current = {
      status: 'ready',
      data: { values: { allValues: ALL_VALUES, userValues: USER_VALUES } },
      error: null,
    };
    codeMirrorState.value = '';
    codeMirrorState.latestProps.current = { value: '' };
    codeMirrorState.editorView.dispatch.mockClear();
    codeMirrorState.editorView.focus.mockClear();
    refreshMocks.setScopedDomainEnabled.mockClear();
    refreshMocks.fetchScopedDomain.mockClear();
    autoRefreshLoadingState.isPaused = false;
    autoRefreshLoadingState.isManualRefreshActive = false;
    autoRefreshLoadingState.suppressPassiveLoading = false;
    searchShortcutMocks.useSearchShortcutTarget.mockClear();
    searchShortcutMocks.useKeyboardSurface.mockClear();
    searchModuleMocks.createSearchExtensions.mockClear();
    searchModuleMocks.closeSearchPanel.mockClear();
  });

  afterEach(() => {
    document.body.textContent = '';
  });

  // -----------------------------------------------------------------------
  // Mode switching & value computation
  // -----------------------------------------------------------------------

  it('renders defaults mode: allValues minus user-overridden keys', async () => {
    const { unmount } = await renderValuesTab();
    await waitForUpdates();

    // Default mode is 'defaults' — should exclude keys present in userValues.
    const parsed = parsedValue();
    expect(parsed.replicaCount).toBeUndefined();
    expect(parsed.image?.tag).toBeUndefined();
    expect(parsed.image?.repository).toBe('nginx');
    expect(parsed.service).toEqual({ type: 'ClusterIP', port: 80 });

    await unmount();
  });

  it('registers the CodeMirror region as an editor surface', async () => {
    const { unmount } = await renderValuesTab();

    expect(searchShortcutMocks.useKeyboardSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'editor',
        active: true,
        onNativeAction: expect.any(Function),
      })
    );

    await unmount();
  });

  it('renders overrides mode: only user-supplied values', async () => {
    const { container, unmount } = await renderValuesTab();
    await waitForUpdates();

    await clickSegmentedOption(container, 'Overrides');

    const parsed = parsedValue();
    expect(parsed.replicaCount).toBe(3);
    expect(parsed.image).toEqual({ tag: 'v2.0' });
    // Keys not in userValues should be absent.
    expect(parsed.service).toBeUndefined();

    await unmount();
  });

  it('renders merged mode: allValues with user overrides applied', async () => {
    const { container, unmount } = await renderValuesTab();
    await waitForUpdates();

    await clickSegmentedOption(container, 'Merged');

    const parsed = parsedValue();
    expect(parsed.replicaCount).toBe(3);
    expect(parsed.image).toEqual({ repository: 'nginx', tag: 'v2.0' });
    expect(parsed.service).toEqual({ type: 'ClusterIP', port: 80 });

    await unmount();
  });

  it('ignores inherited properties when deriving Helm value modes', async () => {
    const allValues = Object.assign(Object.create({ inheritedDefault: 'not-a-value' }), {
      ownDefault: 'default',
      ownOverride: 'base',
    });
    const userValues = Object.assign(Object.create({ inheritedOverride: 'not-an-override' }), {
      ownOverride: 'override',
    });
    snapshotState.current = {
      status: 'ready',
      data: { values: { allValues, userValues } },
      error: null,
    };

    const { container, unmount } = await renderValuesTab();
    await waitForUpdates();

    expect(parsedValue()).toEqual({ ownDefault: 'default' });

    await clickSegmentedOption(container, 'Overrides');
    expect(parsedValue()).toEqual({ ownOverride: 'override' });

    await clickSegmentedOption(container, 'Merged');
    expect(parsedValue()).toEqual({ ownDefault: 'default', ownOverride: 'override' });

    await unmount();
  });

  // -----------------------------------------------------------------------
  // Loading / error / empty states
  // -----------------------------------------------------------------------

  it('shows loading spinner while data is loading', async () => {
    snapshotState.current = { status: 'loading', data: null, error: null };
    const { container, unmount } = await renderValuesTab();

    expect(container.textContent).toContain('Loading values...');

    await unmount();
  });

  it('suppresses passive loading while auto-refresh is paused', async () => {
    autoRefreshLoadingState.isPaused = true;
    autoRefreshLoadingState.suppressPassiveLoading = true;
    snapshotState.current = { status: 'loading', data: null, error: null };
    const { container, unmount } = await renderValuesTab();

    expect(container.textContent).not.toContain('Loading values...');
    expect(container.textContent).toContain('Auto-refresh is disabled');
    expect(refreshMocks.fetchScopedDomain).not.toHaveBeenCalled();

    await unmount();
  });

  it('shows error message when snapshot has an error', async () => {
    snapshotState.current = {
      status: 'error',
      data: { values: { allValues: ALL_VALUES, userValues: USER_VALUES } },
      error: 'connection refused',
    };
    const { container, unmount } = await renderValuesTab();

    expect(container.textContent).toContain('Error loading values: connection refused');

    await unmount();
  });

  it('shows empty state when no values data is available', async () => {
    snapshotState.current = { status: 'ready', data: { values: null }, error: null };
    const { container, unmount } = await renderValuesTab();

    expect(container.textContent).toContain('No values available');

    await unmount();
  });

  // -----------------------------------------------------------------------
  // Scoped domain lifecycle
  // -----------------------------------------------------------------------

  it('enables scoped domain on mount when active, disables on unmount', async () => {
    const { unmount } = await renderValuesTab({ scope: 'ns:helmrelease:chart', isActive: true });

    expect(refreshMocks.acquireScopedDomainLease).toHaveBeenCalledWith(
      'object-helm-values',
      'ns:helmrelease:chart',
      { preserveState: true }
    );
    expect(refreshMocks.fetchScopedDomain).toHaveBeenCalledWith(
      'object-helm-values',
      'ns:helmrelease:chart',
      { isManual: false, streamSignal: false }
    );

    await unmount();

    expect(refreshMocks.releaseScopedDomainLease).toHaveBeenCalledWith(
      'object-helm-values',
      'ns:helmrelease:chart',
      { preserveState: true }
    );
  });
});
