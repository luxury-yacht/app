/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerPrefsCache.ts
 *
 * Module-level cache of LogViewer view preferences keyed by panelId.
 *
 * Lives outside React state on purpose:
 *
 *   - Toggling a pref (autoScroll, textFilter keystrokes, expandedRows
 *     toggles) is high-frequency. Routing those through context state
 *     would re-render every consumer of useObjectPanelState on every
 *     keystroke; routing them through useState in a parent would also
 *     bubble unrelated updates through the LogViewer subtree.
 *
 *   - The cache must survive ObjectPanelContent unmount/remount caused
 *     by cluster switches, so a useRef inside ObjectPanelContent isn't
 *     enough — that ref dies with the component.
 *
 * Eviction is driven explicitly from ObjectPanelStateContext: closePanel,
 * onCloseObjectPanel, and the cluster-tab cleanup useEffect call
 * clearLogViewerPrefs for any panel that's actually going away. The
 * panelId itself is cluster-prefixed (see objectPanelId), so two panels
 * for the same object across different clusters get distinct cache
 * entries and don't collide.
 */

import type { LogViewerPrefs } from '../types';

const cache = new Map<string, LogViewerPrefs>();

export const getLogViewerPrefs = (panelId: string): LogViewerPrefs | undefined =>
  cache.get(panelId);

export const setLogViewerPrefs = (panelId: string, prefs: LogViewerPrefs): void => {
  cache.set(panelId, prefs);
};

export const clearLogViewerPrefs = (panelId: string): void => {
  cache.delete(panelId);
  scrollTopCache.delete(panelId);
};

/**
 * Per-panel scroll position for the active log content container.
 *
 * Kept in a separate Map (not merged into LogViewerPrefs) because:
 *
 *   - Scroll is ephemeral DOM state, not a user preference the way
 *     autoScroll/textFilter/etc. are. Bundling them would muddy the
 *     type.
 *   - The existing prefs writeback in LogViewer replaces the entire
 *     entry via setLogViewerPrefs(extractLogViewerPrefs(state)) on
 *     every state change. Keeping scrollTop outside that shape means
 *     the writeback can't accidentally clobber the scroll position.
 *
 * Eviction is tied into clearLogViewerPrefs above so the two entries
 * always come and go together.
 */
const scrollTopCache = new Map<string, number>();

export const getLogViewerScrollTop = (panelId: string): number | undefined =>
  scrollTopCache.get(panelId);

export const setLogViewerScrollTop = (panelId: string, scrollTop: number): void => {
  scrollTopCache.set(panelId, scrollTop);
};

/**
 * Test-only: wipe the entire cache. Production code should never need
 * this — eviction is panel-scoped via clearLogViewerPrefs.
 */
export const resetLogViewerPrefsCacheForTesting = (): void => {
  cache.clear();
  scrollTopCache.clear();
};
