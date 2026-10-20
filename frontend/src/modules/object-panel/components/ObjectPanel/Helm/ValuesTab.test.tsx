/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Helm/ValuesTab.test.tsx
 *
 * Covers the Defaults/Overrides/Merged views of the backend payload, YAML that
 * Helm reads back unchanged, per-panel view memory, and loading/error/empty
 * states.
 */

import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as YAML from 'yaml';
import { localFailure, type RefreshFailure } from '@/core/refresh/refreshFailure';
import { setAppPreferencesForTesting } from '@/core/settings/appPreferences';
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

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: CodeMirrorMock,
}));

vi.mock('@codemirror/lang-yaml', () => ({
  yaml: () => 'yaml-extension',
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

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

type ValuesMap = Record<string, unknown> | null;
type ValuesPayload = {
  defaults: ValuesMap;
  merged: ValuesMap;
  overrides: ValuesMap;
  subchartPaths: string[][] | null;
};

const VALUES: ValuesPayload = {
  defaults: { replicaCount: 1, image: { repository: 'nginx', tag: '' }, podAnnotations: {} },
  overrides: { replicaCount: 3, image: { tag: 'v2.0' } },
  merged: { replicaCount: 3, image: { repository: 'nginx', tag: 'v2.0' }, podAnnotations: {} },
  subchartPaths: null,
};

type SnapshotStatus = 'idle' | 'loading' | 'ready' | 'updating' | 'initialising' | 'error';

type Snapshot = {
  status: SnapshotStatus;
  data?: ValuesPayload | null;
  error?: RefreshFailure | null;
};

const snapshotState: { current: Snapshot } = {
  current: { status: 'ready', data: VALUES, error: null },
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

let panelSequence = 0;

const renderValuesTab = async (
  props: Partial<{ scope: string | null; isActive: boolean; panelId: string }> = {}
) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  // Each render gets its own panel unless a test is checking panel memory.
  panelSequence += 1;
  const defaultProps = {
    scope: 'prod:helmrelease:my-app',
    isActive: true,
    panelId: `panel-${panelSequence}`,
  };

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
    snapshotState.current = { status: 'ready', data: VALUES, error: null };
    codeMirrorState.value = '';
    codeMirrorState.latestProps.current = { value: '' };
    codeMirrorState.editorView.dispatch.mockClear();
    codeMirrorState.editorView.focus.mockClear();
    refreshMocks.fetchScopedDomain.mockClear();
    autoRefreshLoadingState.isPaused = false;
    setAppPreferencesForTesting({ autoRefreshEnabled: true });
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

  it('shows the chart defaults, user overrides, and merged values for the selected view', async () => {
    const { container, unmount } = await renderValuesTab();

    expect(parsedValue()).toEqual(VALUES.defaults);

    await clickSegmentedOption(container, 'Overrides');
    expect(parsedValue()).toEqual(VALUES.overrides);

    await clickSegmentedOption(container, 'Merged');
    expect(parsedValue()).toEqual(VALUES.merged);

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

  it('shows an empty map when the release has no user-supplied values', async () => {
    snapshotState.current = { status: 'ready', data: { ...VALUES, overrides: null }, error: null };
    const { container, unmount } = await renderValuesTab();

    await clickSegmentedOption(container, 'Overrides');
    expect(parsedValue()).toEqual({});

    await unmount();
  });

  it('summarizes the overrides it marks in the Merged and Overrides views', async () => {
    snapshotState.current = {
      status: 'ready',
      data: {
        ...VALUES,
        defaults: { ...VALUES.defaults, testFramework: { enabled: true } },
        overrides: { ...VALUES.overrides, testFramework: null },
      },
      error: null,
    };
    const { container, unmount } = await renderValuesTab();
    const summary = () => container.querySelector('.helm-values-override-summary');

    expect(summary()).toBeNull();

    // replicaCount and image.tag are overridden; testFramework was removed.
    for (const view of ['Merged', 'Overrides']) {
      await clickSegmentedOption(container, view);
      expect(summary()?.textContent, view).toContain('2 overridden');
      expect(summary()?.textContent, view).toContain('1 removed');
    }

    await clickSegmentedOption(container, 'Defaults');
    expect(summary()).toBeNull();

    await unmount();
  });

  it('quotes strings that Helm would otherwise read back as booleans', async () => {
    const strings = { tls: 'on', enabled: 'yes', legacy: 'off', confirm: 'n' };
    snapshotState.current = {
      status: 'ready',
      data: { ...VALUES, defaults: strings },
      error: null,
    };
    const { unmount } = await renderValuesTab();

    // Helm parses values files as YAML 1.1, where bare yes/on/off/n are booleans.
    expect(YAML.parse(codeMirrorState.value, { version: '1.1' })).toEqual(strings);

    await unmount();
  });

  it('keeps the selected view for its panel when the tab remounts', async () => {
    const first = await renderValuesTab({ panelId: 'panel-remount' });
    await clickSegmentedOption(first.container, 'Merged');
    await first.unmount();

    const remounted = await renderValuesTab({ panelId: 'panel-remount' });
    expect(parsedValue()).toEqual(VALUES.merged);
    await remounted.unmount();

    const otherPanel = await renderValuesTab({ panelId: 'panel-other' });
    expect(parsedValue()).toEqual(VALUES.defaults);
    await otherPanel.unmount();
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
    setAppPreferencesForTesting({ autoRefreshEnabled: false });
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
      data: VALUES,
      error: localFailure('connection refused'),
    };
    const { container, unmount } = await renderValuesTab();

    expect(container.textContent).toContain('Error loading values: connection refused');

    await unmount();
  });

  it('shows empty state when no values data is available', async () => {
    snapshotState.current = { status: 'ready', data: null, error: null };
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
      expect.objectContaining({
        intent: 'startup',
        correlationId: expect.any(String),
      })
    );

    await unmount();

    expect(refreshMocks.releaseScopedDomainLease).toHaveBeenCalledWith(
      'object-helm-values',
      'ns:helmrelease:chart',
      { preserveState: true }
    );
  });
});
