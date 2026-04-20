import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchShortcutMocks = vi.hoisted(() => ({
  useSearchShortcutTarget: vi.fn(),
  useKeyboardSurface: vi.fn(),
}));

const refreshMocks = vi.hoisted(() => ({
  setScopedDomainEnabled: vi.fn(),
  fetchScopedDomain: vi.fn(() => Promise.resolve()),
}));

const refreshStoreMocks = vi.hoisted(() => ({
  useRefreshScopedDomain: vi.fn(),
}));

const autoRefreshLoadingState = vi.hoisted(() => ({
  isPaused: false,
  isManualRefreshActive: false,
  suppressPassiveLoading: false,
}));

const codeMirrorState = {
  editorView: {
    state: {
      selection: { main: { from: 0, to: 0 } },
      sliceDoc: vi.fn(() => ''),
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
  },
};

const CodeMirrorMock = React.forwardRef((_props: any, ref) => {
  const props = _props;
  if (ref && typeof ref === 'object' && ref !== null) {
    (ref as React.RefObject<{ view: typeof codeMirrorState.editorView } | null>).current = {
      view: codeMirrorState.editorView as any,
    };
  }
  React.useEffect(() => {
    props.onCreateEditor?.(codeMirrorState.editorView as any);
  }, [props]);
  return <div data-testid="code-mirror">{props.value}</div>;
});
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

vi.mock('@ui/shortcuts', () => ({
  useKeyboardSurface: (config: unknown) => searchShortcutMocks.useKeyboardSurface(config),
  useSearchShortcutTarget: (config: unknown) => searchShortcutMocks.useSearchShortcutTarget(config),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: refreshMocks,
}));

vi.mock('@/core/refresh/store', () => ({
  useRefreshScopedDomain: refreshStoreMocks.useRefreshScopedDomain,
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
  EditorView: class {},
  lineWrapping: 'lineWrapping',
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

vi.mock('@shared/components/LoadingSpinner', () => ({
  __esModule: true,
  default: ({ message }: { message: string }) => <div data-testid="spinner">{message}</div>,
}));

type SnapshotStatus = 'idle' | 'loading' | 'ready' | 'updating' | 'initialising' | 'error';
type Snapshot = {
  status: SnapshotStatus;
  data?: { manifest?: string | null } | null;
  error?: string | null;
};

const snapshotState: { current: Snapshot } = {
  current: {
    status: 'ready',
    data: { manifest: 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: demo\n' },
    error: null,
  },
};

refreshStoreMocks.useRefreshScopedDomain.mockImplementation(() => snapshotState.current);

const renderManifestTab = async (
  props: Partial<{ scope: string | null; isActive: boolean }> = {}
) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const defaultProps = { scope: 'ns:helmrelease:demo', isActive: true };

  await act(async () => {
    const { default: ManifestTab } = await import('./ManifestTab');
    root.render(<ManifestTab {...defaultProps} {...props} />);
  });

  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('ManifestTab', () => {
  beforeEach(() => {
    snapshotState.current = {
      status: 'ready',
      data: { manifest: 'kind: ConfigMap\nmetadata:\n  name: demo\n' },
      error: null,
    };
    refreshMocks.setScopedDomainEnabled.mockClear();
    refreshMocks.fetchScopedDomain.mockClear();
    autoRefreshLoadingState.isPaused = false;
    autoRefreshLoadingState.isManualRefreshActive = false;
    autoRefreshLoadingState.suppressPassiveLoading = false;
  });

  afterEach(() => {
    document.body.textContent = '';
  });

  it('enables the scoped domain and uses startup fetch intent on mount', async () => {
    const { unmount } = await renderManifestTab();

    expect(refreshMocks.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-helm-manifest',
      'ns:helmrelease:demo',
      true
    );
    expect(refreshMocks.fetchScopedDomain).toHaveBeenCalledWith(
      'object-helm-manifest',
      'ns:helmrelease:demo',
      { isManual: false }
    );

    await unmount();
  });

  it('suppresses passive loading while paused and blocks startup fetches', async () => {
    autoRefreshLoadingState.isPaused = true;
    autoRefreshLoadingState.suppressPassiveLoading = true;
    snapshotState.current = { status: 'loading', data: null, error: null };

    const { container, unmount } = await renderManifestTab();

    expect(container.textContent).not.toContain('Loading manifest...');
    expect(container.textContent).toContain('Auto-refresh is disabled');
    expect(refreshMocks.fetchScopedDomain).not.toHaveBeenCalled();

    await unmount();
  });
});
