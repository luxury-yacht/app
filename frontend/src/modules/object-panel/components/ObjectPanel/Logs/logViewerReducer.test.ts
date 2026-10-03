/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerReducer.test.ts
 *
 * Locks the LogViewer view-mode contract (live or previous logs), the
 * auto-refresh setter used when a stream fails, and the prefs round-trip.
 */

import { describe, expect, it } from 'vitest';
import {
  applyLogViewerPrefs,
  extractLogViewerPrefs,
  initialLogViewerState,
  LIVE_MODE,
  type LogViewerState,
  logViewerReducer,
} from './logViewerReducer';

const base = (overrides: Partial<LogViewerState> = {}): LogViewerState => ({
  ...initialLogViewerState,
  ...overrides,
});

describe('logViewerReducer view mode', () => {
  it('starts in the live mode', () => {
    expect(initialLogViewerState.mode).toEqual({ kind: 'live' });
  });

  it('enters previous logs on start and returns to live on stop', () => {
    const previous = logViewerReducer(base(), { type: 'START_PREVIOUS_LOGS' });
    expect(previous.mode).toEqual({ kind: 'previous' });

    const stopped = logViewerReducer(previous, { type: 'STOP_PREVIOUS_LOGS' });
    expect(stopped.mode).toEqual(LIVE_MODE);
  });

  it('toggles the previous view via SET_SHOW_PREVIOUS_LOGS', () => {
    const shown = logViewerReducer(base(), { type: 'SET_SHOW_PREVIOUS_LOGS', payload: true });
    expect(shown.mode).toEqual({ kind: 'previous' });

    const hidden = logViewerReducer(shown, { type: 'SET_SHOW_PREVIOUS_LOGS', payload: false });
    expect(hidden.mode).toEqual(LIVE_MODE);
  });

  it('sets auto-refresh explicitly, so a failed stream can turn it off', () => {
    const off = logViewerReducer(base(), { type: 'SET_AUTO_REFRESH', payload: false });
    expect(off.autoRefresh).toBe(false);
    expect(logViewerReducer(off, { type: 'SET_AUTO_REFRESH', payload: false })).toBe(off);
    expect(logViewerReducer(off, { type: 'SET_AUTO_REFRESH', payload: true }).autoRefresh).toBe(
      true
    );
  });

  it('resets to the live mode for a new scope', () => {
    const previous = logViewerReducer(base({ textFilter: 'boom' }), {
      type: 'START_PREVIOUS_LOGS',
    });
    const reset = logViewerReducer(previous, { type: 'RESET_FOR_NEW_SCOPE' });
    expect(reset.mode).toEqual(LIVE_MODE);
    expect(reset.textFilter).toBe('');
  });

  it('persists and rehydrates the previous-logs mode through prefs', () => {
    const previous = logViewerReducer(base(), { type: 'START_PREVIOUS_LOGS' });
    const prefs = extractLogViewerPrefs(previous);
    expect(prefs.showPreviousContainerLogs).toBe(true);

    const rehydrated = applyLogViewerPrefs(initialLogViewerState, prefs);
    expect(rehydrated.mode).toEqual({ kind: 'previous' });
  });

  it('persists the live mode as showPreviousContainerLogs=false', () => {
    const prefs = extractLogViewerPrefs(base());
    expect(prefs.showPreviousContainerLogs).toBe(false);
    expect(applyLogViewerPrefs(initialLogViewerState, prefs).mode).toEqual(LIVE_MODE);
  });
});

describe('logViewerReducer state transitions', () => {
  it('updates container and workload filter inventory', () => {
    const api = { name: 'api', isInit: false, isEphemeral: false };
    const initSidecar = { name: 'sidecar', isInit: true, isEphemeral: false };
    const selectedFilters = { mode: 'some' as const, values: ['pod:api'] };
    const actions = [
      { type: 'SET_CONTAINERS' as const, payload: [api, initSidecar] },
      { type: 'SET_AVAILABLE_PODS' as const, payload: ['api-1'] },
      { type: 'SET_SELECTED_FILTERS' as const, payload: selectedFilters },
    ];
    const result = actions.reduce(logViewerReducer, base());

    expect(result).toMatchObject({
      containers: [api, initSidecar],
      availablePods: ['api-1'],
      selectedFilters,
    });
  });

  it('applies every display preference transition', () => {
    const actions = [
      { type: 'TOGGLE_AUTO_REFRESH' as const },
      { type: 'CYCLE_TIMESTAMP_MODE' as const },
      { type: 'SET_TIMESTAMP_MODE' as const, payload: 'hidden' as const },
      { type: 'TOGGLE_WRAP_TEXT' as const },
      { type: 'TOGGLE_SHOW_ANSI_COLORS' as const },
      { type: 'SET_TEXT_FILTER' as const, payload: 'error' },
      { type: 'TOGGLE_HIGHLIGHT_MATCHES' as const },
      { type: 'TOGGLE_INVERSE_MATCHES' as const },
      { type: 'TOGGLE_CASE_SENSITIVE_MATCHES' as const },
      { type: 'TOGGLE_REGEX_MATCHES' as const },
    ];
    const result = actions.reduce(logViewerReducer, base());

    expect(result).toMatchObject({
      autoRefresh: false,
      timestampMode: 'hidden',
      wrapText: false,
      showAnsiColors: false,
      textFilter: 'error',
      highlightMatches: false,
      inverseMatches: true,
      caseSensitiveMatches: false,
      regexMatches: true,
    });
    expect(logViewerReducer(result, { type: 'TOGGLE_CASE_SENSITIVE_MATCHES' })).toBe(result);
  });

  it('toggles the table view and its row expansion', () => {
    const shown = logViewerReducer(base(), { type: 'TOGGLE_PARSED_VIEW' });
    const expanded = logViewerReducer(shown, { type: 'TOGGLE_ROW_EXPANSION', payload: 'row-1' });
    const collapsed = logViewerReducer(expanded, {
      type: 'TOGGLE_ROW_EXPANSION',
      payload: 'row-1',
    });
    const raw = logViewerReducer(expanded, { type: 'SET_DISPLAY_MODE', payload: 'raw' });

    expect(shown.displayMode).toBe('parsed');
    expect(expanded.expandedRows.has('row-1')).toBe(true);
    expect(collapsed.expandedRows.has('row-1')).toBe(false);
    expect(raw.displayMode).toBe('raw');
    expect(raw.expandedRows.size).toBe(0);
    expect(logViewerReducer(shown, { type: 'TOGGLE_PARSED_VIEW' }).displayMode).toBe('raw');
  });

  it('updates copy feedback and clears filtering and display mode on scope resets', () => {
    const copied = logViewerReducer(base(), { type: 'SET_COPY_FEEDBACK', payload: 'copied' });
    const reset = logViewerReducer(
      { ...copied, textFilter: 'error', displayMode: 'parsed' },
      { type: 'RESET_FOR_NEW_SCOPE' }
    );

    expect(copied.copyFeedback).toBe('copied');
    expect(reset).toMatchObject({
      textFilter: '',
      displayMode: 'raw',
      mode: LIVE_MODE,
    });
  });

  it('keeps state unchanged for redundant mode changes and unknown actions', () => {
    const live = base();
    expect(logViewerReducer(live, { type: 'SET_SHOW_PREVIOUS_LOGS', payload: false })).toBe(live);
    expect(logViewerReducer(live, { type: 'UNKNOWN' } as never)).toBe(live);
  });
});
