/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useContainerLogsStreamFallback.test.ts
 *
 * Tests for useContainerLogsStreamFallback — verifies stream lifecycle management,
 * error-to-fallback transition, fallback manager registration, exponential
 * backoff recovery, and initial log priming.
 */

import ReactDOM from 'react-dom/client';
import React, { act, useRef } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogViewerAction } from '../logViewerReducer';

// --- Mocks ---

const mockStopStreamingDomain = vi.fn();
const mockSetScopedDomainEnabled = vi.fn();
const mockRestartStreamingDomain = vi.fn((..._args: any[]) => Promise.resolve());

vi.mock('@/core/refresh/orchestrator', () => ({
  refreshOrchestrator: {
    stopStreamingDomain: (...args: any[]) => mockStopStreamingDomain(...args),
    setScopedDomainEnabled: (...args: any[]) => mockSetScopedDomainEnabled(...args),
    restartStreamingDomain: (...args: any[]) => mockRestartStreamingDomain(...args),
  },
}));

const mockRegister = vi.fn();
const mockUnregister = vi.fn();
const mockRefreshNow = vi.fn((..._args: any[]) => Promise.resolve());
const mockUpdate = vi.fn();

vi.mock('@/core/refresh/fallbacks/containerLogsFallbackManager', () => ({
  containerLogsFallbackManager: {
    register: (...args: any[]) => mockRegister(...args),
    unregister: (...args: any[]) => mockUnregister(...args),
    refreshNow: (...args: any[]) => mockRefreshNow(...args),
    update: (...args: any[]) => mockUpdate(...args),
  },
}));

const mockSetScopedDomainState = vi.fn();

vi.mock('@/core/refresh/store', () => ({
  setScopedDomainState: (...args: unknown[]) => mockSetScopedDomainState(...args),
}));

// Import after mocks
import {
  useContainerLogsStreamFallback,
  isLogDataUnavailable,
  getLogDataUnavailableMessage,
} from './useContainerLogsStreamFallback';

// --- Test infrastructure ---

interface HarnessProps {
  containerLogsScope: string | null;
  isActive: boolean;
  autoRefresh: boolean;
  showPreviousContainerLogs: boolean;
  snapshotStatus: string;
  logEntriesLength: number;
  fallbackActive: boolean;
  fetchFallbackContainerLogs: (isManual?: boolean) => Promise<void>;
  dispatch: React.Dispatch<LogViewerAction>;
}

/**
 * Minimal React component that calls useContainerLogsStreamFallback and exposes the refs.
 * The refs are owned by the Harness (like LogViewer would) and passed to the hook.
 */
function createHarness() {
  const refs = {
    fallbackRecovering: { current: false },
    hasPrimedScope: { current: false },
  };

  const Harness: React.FC<HarnessProps> = (props) => {
    const fallbackRecoveringRef = useRef(false);
    const hasPrimedScopeRef = useRef(false);

    // Sync refs so the test can read them
    refs.fallbackRecovering = fallbackRecoveringRef;
    refs.hasPrimedScope = hasPrimedScopeRef;

    useContainerLogsStreamFallback({
      ...props,
      fallbackRecoveringRef,
      hasPrimedScopeRef,
    });

    return null;
  };

  return { Harness, refs };
}

function defaultProps(overrides: Partial<HarnessProps> = {}): HarnessProps {
  return {
    containerLogsScope: 'test-scope',
    isActive: true,
    autoRefresh: true,
    showPreviousContainerLogs: false,
    snapshotStatus: 'ready',
    logEntriesLength: 0,
    fallbackActive: false,
    fetchFallbackContainerLogs: vi.fn(() => Promise.resolve()),
    dispatch: vi.fn(),
    ...overrides,
  };
}

// --- Tests ---

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('isLogDataUnavailable', () => {
  it('returns false for null/empty messages', () => {
    expect(isLogDataUnavailable(null)).toBe(false);
    expect(isLogDataUnavailable('')).toBe(false);
    expect(isLogDataUnavailable(undefined)).toBe(false);
  });

  it('returns true for known unavailable patterns', () => {
    expect(isLogDataUnavailable('waiting to start: ContainerCreating')).toBe(true);
    expect(isLogDataUnavailable('PodInitializing')).toBe(true);
    expect(isLogDataUnavailable('container not found')).toBe(true);
    expect(isLogDataUnavailable('no logs available')).toBe(true);
  });

  it('returns false for transient errors', () => {
    expect(isLogDataUnavailable('connection refused')).toBe(false);
    expect(isLogDataUnavailable('container logs stream disconnected')).toBe(false);
  });

  it('builds the correct unavailable-state message', () => {
    expect(getLogDataUnavailableMessage(false)).toContain('not available yet');
    expect(getLogDataUnavailableMessage(true)).toContain('No previous logs');
  });
});

describe('useContainerLogsStreamFallback', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Stream lifecycle
  // -----------------------------------------------------------------------

  it('enables streaming domain when active and not in fallback', () => {
    const { Harness } = createHarness();
    const props = defaultProps();

    act(() => {
      root.render(React.createElement(Harness, props));
    });

    // preserveState: true on enable so the cached log buffer survives a
    // remount (e.g. cluster-switch round-trip). Without it the
    // orchestrator's streaming branch wipes the snapshot before
    // scheduling the new stream.
    expect(mockSetScopedDomainEnabled).toHaveBeenCalledWith('container-logs', 'test-scope', true, {
      preserveState: true,
    });
  });

  it('stops streaming and disables domain when inactive', () => {
    const { Harness } = createHarness();
    const dispatch = vi.fn();
    const props = defaultProps({ isActive: false, dispatch });

    act(() => {
      root.render(React.createElement(Harness, props));
    });

    expect(mockStopStreamingDomain).toHaveBeenCalledWith('container-logs', 'test-scope', {
      reset: false,
    });
    expect(mockSetScopedDomainEnabled).toHaveBeenCalledWith('container-logs', 'test-scope', false, {
      preserveState: true,
    });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FALLBACK_ACTIVE', payload: false });
  });

  it('stops streaming when showing previous logs', () => {
    const { Harness } = createHarness();
    const props = defaultProps({ showPreviousContainerLogs: true });

    act(() => {
      root.render(React.createElement(Harness, props));
    });

    expect(mockStopStreamingDomain).toHaveBeenCalledWith('container-logs', 'test-scope', {
      reset: false,
    });
  });

  it('does nothing when containerLogsScope is null', () => {
    const { Harness } = createHarness();
    const props = defaultProps({ containerLogsScope: null });

    act(() => {
      root.render(React.createElement(Harness, props));
    });

    expect(mockSetScopedDomainEnabled).not.toHaveBeenCalled();
    expect(mockStopStreamingDomain).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Error-to-fallback transition
  // -----------------------------------------------------------------------

  it('activates fallback when snapshot status is error and autoRefresh is on', () => {
    const { Harness } = createHarness();
    const dispatch = vi.fn();
    const props = defaultProps({ snapshotStatus: 'error', dispatch });

    act(() => {
      root.render(React.createElement(Harness, props));
    });

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FALLBACK_ACTIVE', payload: true });
  });

  it('does not activate fallback when autoRefresh is off', () => {
    const { Harness } = createHarness();
    const dispatch = vi.fn();
    const props = defaultProps({ snapshotStatus: 'error', autoRefresh: false, dispatch });

    act(() => {
      root.render(React.createElement(Harness, props));
    });

    const fallbackCalls = dispatch.mock.calls.filter(
      (c: any[]) => c[0]?.type === 'SET_FALLBACK_ACTIVE' && c[0]?.payload === true
    );
    expect(fallbackCalls.length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Fallback manager registration
  // -----------------------------------------------------------------------

  it('registers with fallback manager when fallback is active', () => {
    const { Harness } = createHarness();
    const fetchFallbackContainerLogs = vi.fn(() => Promise.resolve());
    const props = defaultProps({ fallbackActive: true, fetchFallbackContainerLogs });

    act(() => {
      root.render(React.createElement(Harness, props));
    });

    expect(mockRegister).toHaveBeenCalledWith('test-scope', fetchFallbackContainerLogs, true);
    expect(mockRefreshNow).toHaveBeenCalledWith('test-scope');
  });

  it('unregisters from fallback manager when fallback deactivates', () => {
    const { Harness } = createHarness();
    const props = defaultProps({ fallbackActive: true });

    act(() => {
      root.render(React.createElement(Harness, props));
    });

    mockUnregister.mockClear();

    act(() => {
      root.render(React.createElement(Harness, { ...props, fallbackActive: false }));
    });

    // Cleanup from the previous effect + the new effect's early-return path
    expect(mockUnregister).toHaveBeenCalledWith('test-scope');
  });

  // -----------------------------------------------------------------------
  // Exponential backoff recovery
  // -----------------------------------------------------------------------

  it('schedules recovery with exponential backoff when fallback is active', async () => {
    const { Harness } = createHarness();
    const dispatch = vi.fn();
    const props = defaultProps({ fallbackActive: true, dispatch });

    act(() => {
      root.render(React.createElement(Harness, props));
    });

    // First recovery attempt after 3s
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(mockRestartStreamingDomain).toHaveBeenCalledTimes(1);
    expect(mockRestartStreamingDomain).toHaveBeenCalledWith('container-logs', 'test-scope');
  });

  it('stops recovery after successful restart', async () => {
    const { Harness } = createHarness();
    const dispatch = vi.fn();
    mockRestartStreamingDomain.mockResolvedValueOnce(undefined);
    const props = defaultProps({ fallbackActive: true, dispatch });

    act(() => {
      root.render(React.createElement(Harness, props));
    });

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    // On success, dispatch SET_FALLBACK_ACTIVE false
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FALLBACK_ACTIVE', payload: false });
  });

  it('retries with increasing delay on failure', async () => {
    const { Harness } = createHarness();
    const dispatch = vi.fn();
    mockRestartStreamingDomain.mockRejectedValue(new Error('connection failed'));
    const props = defaultProps({ fallbackActive: true, dispatch });

    act(() => {
      root.render(React.createElement(Harness, props));
    });

    // First attempt at 3s
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(mockRestartStreamingDomain).toHaveBeenCalledTimes(1);

    // Second attempt at 3s + 6s = 9s
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(mockRestartStreamingDomain).toHaveBeenCalledTimes(2);

    // Third attempt at 9s + 12s = 21s
    await act(async () => {
      vi.advanceTimersByTime(12000);
    });
    expect(mockRestartStreamingDomain).toHaveBeenCalledTimes(3);
  });

  it('records an unavailable warning instead of an error when recovery sees a startup-state log error', async () => {
    const { Harness } = createHarness();
    mockRestartStreamingDomain.mockRejectedValueOnce(
      new Error('waiting to start: ContainerCreating')
    );

    act(() => {
      root.render(
        React.createElement(
          Harness,
          defaultProps({
            fallbackActive: true,
          })
        )
      );
    });

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    const latestCall =
      mockSetScopedDomainState.mock.calls[mockSetScopedDomainState.mock.calls.length - 1];
    const updater = latestCall?.[2] as
      | ((previous: Record<string, any>) => Record<string, any>)
      | undefined;
    expect(typeof updater).toBe('function');

    const next = updater?.({
      status: 'loading',
      error: null,
      stats: undefined,
      scope: 'test-scope',
    });
    expect(next?.status).toBe('ready');
    expect(next?.error).toBeNull();
    expect(next?.stats?.warnings).toEqual([getLogDataUnavailableMessage(false)]);
  });

  it('does not schedule recovery when autoRefresh is off', () => {
    const { Harness } = createHarness();
    const props = defaultProps({ fallbackActive: true, autoRefresh: false });

    act(() => {
      root.render(React.createElement(Harness, props));
    });

    act(() => {
      vi.advanceTimersByTime(60000);
    });

    expect(mockRestartStreamingDomain).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Initial log priming
  // -----------------------------------------------------------------------

  it('calls fetchFallbackContainerLogs on initial mount when no entries exist', () => {
    const { Harness } = createHarness();
    const fetchFallbackContainerLogs = vi.fn(() => Promise.resolve());
    const props = defaultProps({ logEntriesLength: 0, fetchFallbackContainerLogs });

    act(() => {
      root.render(React.createElement(Harness, props));
    });

    expect(fetchFallbackContainerLogs).toHaveBeenCalled();
  });

  it('does not call fetchFallbackContainerLogs when entries already exist', () => {
    const { Harness } = createHarness();
    const fetchFallbackContainerLogs = vi.fn(() => Promise.resolve());
    const props = defaultProps({ logEntriesLength: 10, fetchFallbackContainerLogs });

    act(() => {
      root.render(React.createElement(Harness, props));
    });

    expect(fetchFallbackContainerLogs).not.toHaveBeenCalled();
  });

  it('sets hasPrimedScopeRef when entries arrive', () => {
    const { Harness, refs } = createHarness();
    const props = defaultProps({ logEntriesLength: 5 });

    act(() => {
      root.render(React.createElement(Harness, props));
    });

    expect(refs.hasPrimedScope.current).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Primed scope reset
  // -----------------------------------------------------------------------

  it('resets hasPrimedScopeRef when fallback activates', () => {
    const { Harness, refs } = createHarness();
    const props = defaultProps({ logEntriesLength: 5 });

    act(() => {
      root.render(React.createElement(Harness, props));
    });
    expect(refs.hasPrimedScope.current).toBe(true);

    act(() => {
      root.render(React.createElement(Harness, { ...props, fallbackActive: true }));
    });
    expect(refs.hasPrimedScope.current).toBe(false);
  });
});
