/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerPrefsCache.test.ts
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  clearLogViewerPrefs,
  getLogViewerPrefs,
  resetLogViewerPrefsCacheForTesting,
  setLogViewerPrefs,
} from './logViewerPrefsCache';
import type { LogViewerPrefs } from '../types';

const samplePrefs = (overrides: Partial<LogViewerPrefs> = {}): LogViewerPrefs => ({
  selectedContainer: 'app',
  selectedFilter: '',
  autoScroll: true,
  autoRefresh: true,
  showTimestamps: true,
  wrapText: false,
  textFilter: 'error',
  isParsedView: false,
  expandedRows: [],
  showPreviousLogs: false,
  ...overrides,
});

describe('logViewerPrefsCache', () => {
  afterEach(() => {
    resetLogViewerPrefsCacheForTesting();
  });

  it('returns undefined for an unknown panelId', () => {
    expect(getLogViewerPrefs('obj:cluster-a:pod:default:api')).toBeUndefined();
  });

  it('round-trips prefs by panelId', () => {
    const id = 'obj:cluster-a:pod:default:api';
    const prefs = samplePrefs({ wrapText: true, textFilter: 'oops' });
    setLogViewerPrefs(id, prefs);
    expect(getLogViewerPrefs(id)).toEqual(prefs);
  });

  it('keeps entries for different panels independent', () => {
    const a = 'obj:cluster-a:pod:default:api';
    const b = 'obj:cluster-b:pod:default:api';
    setLogViewerPrefs(a, samplePrefs({ textFilter: 'a-only' }));
    setLogViewerPrefs(b, samplePrefs({ textFilter: 'b-only' }));
    expect(getLogViewerPrefs(a)?.textFilter).toBe('a-only');
    expect(getLogViewerPrefs(b)?.textFilter).toBe('b-only');
  });

  it('clearLogViewerPrefs evicts a single panel without touching others', () => {
    const a = 'obj:cluster-a:pod:default:api';
    const b = 'obj:cluster-a:pod:default:web';
    setLogViewerPrefs(a, samplePrefs({ textFilter: 'first' }));
    setLogViewerPrefs(b, samplePrefs({ textFilter: 'second' }));

    clearLogViewerPrefs(a);

    expect(getLogViewerPrefs(a)).toBeUndefined();
    expect(getLogViewerPrefs(b)?.textFilter).toBe('second');
  });
});
