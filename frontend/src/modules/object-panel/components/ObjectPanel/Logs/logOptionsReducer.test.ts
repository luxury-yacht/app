/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logOptionsReducer.test.ts
 *
 * The search and display options shared by Container Logs and Node Logs.
 */

import { describe, expect, it } from 'vitest';
import {
  initialLogOptionsState,
  isLogOptionsAction,
  type LogOptionsAction,
  logOptionsReducer,
} from './logOptionsReducer';

const apply = (...actions: LogOptionsAction[]) =>
  actions.reduce(logOptionsReducer, initialLogOptionsState);

describe('logOptionsReducer', () => {
  it('turns highlighting off when the filter is inverted, and keeps it off', () => {
    const inverted = apply(
      { type: 'TOGGLE_HIGHLIGHT_MATCHES' },
      { type: 'TOGGLE_INVERSE_MATCHES' }
    );
    expect(inverted).toMatchObject({ inverseMatches: true, highlightMatches: false });
    expect(logOptionsReducer(inverted, { type: 'TOGGLE_HIGHLIGHT_MATCHES' }).highlightMatches).toBe(
      false
    );
  });

  it('turns case-sensitive matching off in regex mode, and keeps it off', () => {
    const regex = apply(
      { type: 'TOGGLE_CASE_SENSITIVE_MATCHES' },
      { type: 'TOGGLE_REGEX_MATCHES' }
    );
    expect(regex).toMatchObject({ regexMatches: true, caseSensitiveMatches: false });
    expect(logOptionsReducer(regex, { type: 'TOGGLE_CASE_SENSITIVE_MATCHES' })).toBe(regex);
  });

  it('clears parsed rows and expansion when the display mode changes', () => {
    const parsed = apply(
      { type: 'SET_DISPLAY_MODE', payload: 'parsed' },
      { type: 'SET_PARSED_LOGS', payload: [{ data: { a: 1 }, rawLine: '{"a":1}', lineNumber: 1 }] },
      { type: 'TOGGLE_ROW_EXPANSION', payload: 'row-1' }
    );
    const raw = logOptionsReducer(parsed, { type: 'SET_DISPLAY_MODE', payload: 'raw' });
    expect(raw).toMatchObject({ displayMode: 'raw', parsedLogs: [] });
    expect(raw.expandedRows.size).toBe(0);
  });

  it('keeps the rest of a composed state', () => {
    const composed = { ...initialLogOptionsState, sourcePath: 'journal/kubelet' };
    expect(logOptionsReducer(composed, { type: 'TOGGLE_WRAP_TEXT' }).sourcePath).toBe(
      'journal/kubelet'
    );
  });

  it('recognizes its own actions only', () => {
    expect(isLogOptionsAction({ type: 'TOGGLE_WRAP_TEXT' })).toBe(true);
    expect(isLogOptionsAction({ type: 'SET_TIMESTAMP_MODE' })).toBe(false);
  });
});
