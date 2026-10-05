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
  it('turns case-sensitive matching off in regex mode, and keeps it off', () => {
    const regex = apply(
      { type: 'TOGGLE_CASE_SENSITIVE_MATCHES' },
      { type: 'TOGGLE_REGEX_MATCHES' }
    );
    expect(regex).toMatchObject({ regexMatches: true, caseSensitiveMatches: false });
    expect(logOptionsReducer(regex, { type: 'TOGGLE_CASE_SENSITIVE_MATCHES' })).toBe(regex);
  });

  it('collapses expanded table rows when the display mode changes', () => {
    const expanded = apply(
      { type: 'SET_DISPLAY_MODE', payload: 'parsed' },
      { type: 'TOGGLE_ROW_EXPANSION', payload: 'row-1' }
    );
    expect(expanded.expandedRows.has('row-1')).toBe(true);
    const raw = logOptionsReducer(expanded, { type: 'SET_DISPLAY_MODE', payload: 'raw' });
    expect(raw.displayMode).toBe('raw');
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
    expect(isLogOptionsAction({ type: 'SET_SHOW_TIMESTAMPS' })).toBe(false);
  });
});
