/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerReducer.test.ts
 *
 * Locks the LogViewer view-mode contract after F3: the live / fallback / previous
 * modes are a discriminated union, so the previously-representable contradictions
 * (fallback while showing previous logs; "loading previous" while previous is
 * hidden) are unrepresentable. Also covers the prefs round-trip.
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
  it('covers logViewerReducer view mode scenarios', async () => {
    // Scenario: starts in the live mode
    expect(initialLogViewerState.mode).toEqual({ kind: 'live' });

    {
      // Scenario: activates and deactivates the fallback mode
      const active = logViewerReducer(base(), { type: 'SET_FALLBACK_ACTIVE', payload: true });
      expect(active.mode).toEqual({ kind: 'fallback' });

      const inactive = logViewerReducer(active, { type: 'SET_FALLBACK_ACTIVE', payload: false });
      expect(inactive.mode).toEqual(LIVE_MODE);
    }

    {
      // Scenario: does not let fallback interrupt the previous-logs view
      const previous = logViewerReducer(base(), { type: 'START_PREVIOUS_LOGS' });
      expect(previous.mode).toEqual({ kind: 'previous', loading: true });

      const stillPrevious = logViewerReducer(previous, {
        type: 'SET_FALLBACK_ACTIVE',
        payload: true,
      });
      expect(stillPrevious.mode).toEqual({ kind: 'previous', loading: true });
    }

    {
      // Scenario: enters previous-logs loading on start and returns to live on stop
      const previous = logViewerReducer(base(), { type: 'START_PREVIOUS_LOGS' });
      expect(previous.mode).toEqual({ kind: 'previous', loading: true });

      const loaded = logViewerReducer(previous, {
        type: 'SET_IS_LOADING_PREVIOUS_LOGS',
        payload: false,
      });
      expect(loaded.mode).toEqual({ kind: 'previous', loading: false });

      const stopped = logViewerReducer(loaded, { type: 'STOP_PREVIOUS_LOGS' });
      expect(stopped.mode).toEqual(LIVE_MODE);
    }

    {
      // Scenario: ignores a previous-logs loading toggle outside the previous mode
      const next = logViewerReducer(base(), {
        type: 'SET_IS_LOADING_PREVIOUS_LOGS',
        payload: true,
      });
      expect(next.mode).toEqual(LIVE_MODE);
    }

    {
      // Scenario: toggles the previous view via SET_SHOW_PREVIOUS_LOGS without leaking loading state
      const shown = logViewerReducer(base(), { type: 'SET_SHOW_PREVIOUS_LOGS', payload: true });
      expect(shown.mode).toEqual({ kind: 'previous', loading: false });

      const hidden = logViewerReducer(shown, { type: 'SET_SHOW_PREVIOUS_LOGS', payload: false });
      expect(hidden.mode).toEqual(LIVE_MODE);
    }

    {
      // Scenario: resets to the live mode for a new scope
      const previous = logViewerReducer(base({ textFilter: 'boom' }), {
        type: 'START_PREVIOUS_LOGS',
      });
      const reset = logViewerReducer(previous, { type: 'RESET_FOR_NEW_SCOPE', isWorkload: false });
      expect(reset.mode).toEqual(LIVE_MODE);
      expect(reset.textFilter).toBe('');
    }

    {
      // Scenario: persists and rehydrates the previous-logs mode through prefs (loading drops)
      const previous = logViewerReducer(base(), { type: 'START_PREVIOUS_LOGS' });
      const prefs = extractLogViewerPrefs(previous);
      expect(prefs.showPreviousContainerLogs).toBe(true);

      const rehydrated = applyLogViewerPrefs(initialLogViewerState, prefs);
      expect(rehydrated.mode).toEqual({ kind: 'previous', loading: false });
    }

    {
      // Scenario: persists the live mode as showPreviousContainerLogs=false
      const prefs = extractLogViewerPrefs(base());
      expect(prefs.showPreviousContainerLogs).toBe(false);
      expect(applyLogViewerPrefs(initialLogViewerState, prefs).mode).toEqual(LIVE_MODE);
    }
  });
});

describe('logViewerReducer state transitions', () => {
  it('covers logViewerReducer state transitions scenarios', async () => {
    {
      // Scenario: updates container and workload filter inventory
      const selectedFilters = { mode: 'some' as const, values: ['pod:api'] };
      const actions = [
        { type: 'SET_CONTAINERS' as const, payload: ['api', 'sidecar'] },
        { type: 'SET_SELECTED_CONTAINER' as const, payload: 'api' },
        { type: 'SET_AVAILABLE_PODS' as const, payload: ['api-1'] },
        { type: 'SET_AVAILABLE_CONTAINERS' as const, payload: ['api'] },
        { type: 'SET_SELECTED_FILTERS' as const, payload: selectedFilters },
      ];
      const result = actions.reduce(logViewerReducer, base());

      expect(result).toMatchObject({
        containers: ['api', 'sidecar'],
        selectedContainer: 'api',
        availablePods: ['api-1'],
        availableContainers: ['api'],
        selectedFilters,
      });
    }

    {
      // Scenario: applies every display preference transition
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
    }

    {
      // Scenario: toggles parsed rows and clears parsed state when returning to raw mode
      const parsedEntry = { data: { level: 'info' }, rawLine: '{}', lineNumber: 1 };
      const parsed = logViewerReducer(base(), { type: 'SET_PARSED_LOGS', payload: [parsedEntry] });
      const shown = logViewerReducer(parsed, { type: 'TOGGLE_PARSED_VIEW' });
      const expanded = logViewerReducer(shown, { type: 'TOGGLE_ROW_EXPANSION', payload: 'row-1' });
      const collapsed = logViewerReducer(expanded, {
        type: 'TOGGLE_ROW_EXPANSION',
        payload: 'row-1',
      });
      const raw = logViewerReducer(collapsed, { type: 'SET_DISPLAY_MODE', payload: 'raw' });

      expect(shown.displayMode).toBe('parsed');
      expect(expanded.expandedRows.has('row-1')).toBe(true);
      expect(collapsed.expandedRows.has('row-1')).toBe(false);
      expect(raw.displayMode).toBe('raw');
      expect(raw.parsedContainerLogs).toEqual([]);
      expect(logViewerReducer(shown, { type: 'TOGGLE_PARSED_VIEW' }).parsedContainerLogs).toEqual(
        []
      );
    }

    {
      // Scenario: updates copy feedback and preserves the selected container on workload resets
      const copied = logViewerReducer(base(), { type: 'SET_COPY_FEEDBACK', payload: 'copied' });
      const reset = logViewerReducer(
        { ...copied, selectedContainer: 'api', textFilter: 'error', displayMode: 'parsed' },
        { type: 'RESET_FOR_NEW_SCOPE', isWorkload: true }
      );

      expect(copied.copyFeedback).toBe('copied');
      expect(reset).toMatchObject({
        selectedContainer: 'api',
        textFilter: '',
        displayMode: 'raw',
        mode: LIVE_MODE,
      });
    }

    {
      // Scenario: keeps state unchanged for redundant mode changes and unknown actions
      const live = base();
      expect(logViewerReducer(live, { type: 'SET_FALLBACK_ACTIVE', payload: false })).toBe(live);
      expect(logViewerReducer(live, { type: 'SET_SHOW_PREVIOUS_LOGS', payload: false })).toBe(live);
      expect(logViewerReducer(live, { type: 'UNKNOWN' } as never)).toBe(live);
    }
  });
});
