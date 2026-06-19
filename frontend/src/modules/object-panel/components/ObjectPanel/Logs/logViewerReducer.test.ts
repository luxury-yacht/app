/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerReducer.test.ts
 *
 * Locks the LogViewer view-mode contract after F3: the live / fallback / previous
 * modes are a discriminated union, so the previously-representable contradictions
 * (fallback while showing previous logs; "loading previous" while previous is
 * hidden) are unrepresentable. Also covers the prefs round-trip.
 */

import { describe, it, expect } from 'vitest';
import {
  logViewerReducer,
  initialLogViewerState,
  LIVE_MODE,
  extractLogViewerPrefs,
  applyLogViewerPrefs,
  type LogViewerState,
} from './logViewerReducer';

const base = (overrides: Partial<LogViewerState> = {}): LogViewerState => ({
  ...initialLogViewerState,
  ...overrides,
});

describe('logViewerReducer view mode', () => {
  it('starts in the live mode', () => {
    expect(initialLogViewerState.mode).toEqual({ kind: 'live' });
  });

  it('activates and deactivates the fallback mode', () => {
    const active = logViewerReducer(base(), { type: 'SET_FALLBACK_ACTIVE', payload: true });
    expect(active.mode).toEqual({ kind: 'fallback' });

    const inactive = logViewerReducer(active, { type: 'SET_FALLBACK_ACTIVE', payload: false });
    expect(inactive.mode).toEqual(LIVE_MODE);
  });

  it('does not let fallback interrupt the previous-logs view', () => {
    const previous = logViewerReducer(base(), { type: 'START_PREVIOUS_LOGS' });
    expect(previous.mode).toEqual({ kind: 'previous', loading: true });

    const stillPrevious = logViewerReducer(previous, {
      type: 'SET_FALLBACK_ACTIVE',
      payload: true,
    });
    expect(stillPrevious.mode).toEqual({ kind: 'previous', loading: true });
  });

  it('enters previous-logs loading on start and returns to live on stop', () => {
    const previous = logViewerReducer(base(), { type: 'START_PREVIOUS_LOGS' });
    expect(previous.mode).toEqual({ kind: 'previous', loading: true });

    const loaded = logViewerReducer(previous, {
      type: 'SET_IS_LOADING_PREVIOUS_LOGS',
      payload: false,
    });
    expect(loaded.mode).toEqual({ kind: 'previous', loading: false });

    const stopped = logViewerReducer(loaded, { type: 'STOP_PREVIOUS_LOGS' });
    expect(stopped.mode).toEqual(LIVE_MODE);
  });

  it('ignores a previous-logs loading toggle outside the previous mode', () => {
    const next = logViewerReducer(base(), { type: 'SET_IS_LOADING_PREVIOUS_LOGS', payload: true });
    expect(next.mode).toEqual(LIVE_MODE);
  });

  it('toggles the previous view via SET_SHOW_PREVIOUS_LOGS without leaking loading state', () => {
    const shown = logViewerReducer(base(), { type: 'SET_SHOW_PREVIOUS_LOGS', payload: true });
    expect(shown.mode).toEqual({ kind: 'previous', loading: false });

    const hidden = logViewerReducer(shown, { type: 'SET_SHOW_PREVIOUS_LOGS', payload: false });
    expect(hidden.mode).toEqual(LIVE_MODE);
  });

  it('resets to the live mode for a new scope', () => {
    const previous = logViewerReducer(base({ textFilter: 'boom' }), {
      type: 'START_PREVIOUS_LOGS',
    });
    const reset = logViewerReducer(previous, { type: 'RESET_FOR_NEW_SCOPE', isWorkload: false });
    expect(reset.mode).toEqual(LIVE_MODE);
    expect(reset.textFilter).toBe('');
  });

  it('persists and rehydrates the previous-logs mode through prefs (loading drops)', () => {
    const previous = logViewerReducer(base(), { type: 'START_PREVIOUS_LOGS' });
    const prefs = extractLogViewerPrefs(previous);
    expect(prefs.showPreviousContainerLogs).toBe(true);

    const rehydrated = applyLogViewerPrefs(initialLogViewerState, prefs);
    expect(rehydrated.mode).toEqual({ kind: 'previous', loading: false });
  });

  it('persists the live mode as showPreviousContainerLogs=false', () => {
    const prefs = extractLogViewerPrefs(base());
    expect(prefs.showPreviousContainerLogs).toBe(false);
    expect(applyLogViewerPrefs(initialLogViewerState, prefs).mode).toEqual(LIVE_MODE);
  });
});
