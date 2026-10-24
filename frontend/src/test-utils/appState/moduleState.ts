/**
 * frontend/src/test-utils/appState/moduleState.ts
 *
 * Module state survives from test to test inside one Vitest file. This ledger
 * resets every owner a harness mount can reach that keeps state keyed by
 * cluster, object, transfer, or window identity, through the owner's public API
 * or its existing test hook (docs/workflows/testing.md). Left alone on purpose:
 * immutable tables, subscriber registries cleared on unmount, and warn-once
 * log sets. Known gap: the refresh orchestrator's error-notification dedupe
 * (refreshErrorNotifier.ts) survives, so a test that asserts a report uses a
 * message no earlier test in its file used.
 */

import { __clearSearchShortcutTargetsForTest } from '@ui/shortcuts/searchShortcutRegistry';
import { __resetForTests as resetPermissionStoreForTests } from '@/core/capabilities/permissionStore';
import { eventBus } from '@/core/events';
import { resetPanelPublicationQueuesForTesting } from '@/core/panel-windows/publicationQueue';
import { resetClusterTabOrderCacheForTesting } from '@/core/persistence/clusterTabOrder';
import { resetFavoritesCacheForTesting } from '@/core/persistence/favorites';
import { resetBrokerReadDiagnosticsForTesting } from '@/core/read-diagnostics/store';
import { clusterReadiness } from '@/core/refresh/clusterReadiness';
import { refreshOrchestrator } from '@/core/refresh/orchestrator';
import { resetContainerLogsStreamScopeParamsCacheForTesting } from '@/core/refresh/streaming/containerLogsStreamScopeParams';
import { resetAppPreferencesCacheForTesting } from '@/core/settings/appPreferences';
import { resetErrorReportingForTesting } from '@/core/telemetry/sentry';
import { setWindowIdentity } from '@/core/window-identity';
import { resetHelmValuesViewCacheForTesting } from '@/modules/object-panel/components/ObjectPanel/Helm/helmValuesViewCache';
import { resetLogViewerPrefsCacheForTesting } from '@/modules/object-panel/components/ObjectPanel/Logs/logViewerPrefsCache';
import { resetNodeLogDiscoveryCacheForTesting } from '@/modules/object-panel/components/ObjectPanel/NodeLogs/nodeLogsApi';
import { resetObjectPanelTabRequestsForTesting } from '@/modules/object-panel/objectPanelTabRequests';
import { resetAcknowledgedPanelTransfersForTesting } from '@/PanelWindowApp';
import { setPendingFocusRequest } from '@/shared/components/tables/hooks/useGridTableExternalFocus';
import { resetGridTablePersistenceCacheForTesting } from '@/shared/components/tables/persistence/gridTablePersistence';
import {
  listRegisteredGridTableViews,
  resetGridTableViewRegistryForTests,
} from '@/shared/components/tables/persistence/gridTableViewRegistry';
import { __resetScrollbarActivityTrackingForTest } from '@/shared/scrollbars/scrollbarActivity';
import { errorHandler } from '@/utils/errorHandler';

const DEFAULT_WINDOW_IDENTITY = 'browser-workspace';
// The app's table views, captured before any test runs.
const PRODUCTION_GRID_TABLE_VIEWS = listRegisteredGridTableViews();

/** Resets module state after the test's React tree has unmounted. */
export const resetAppModuleState = (): void => {
  // Refresh: stops streams and polls, aborts reads, and clears every domain's
  // scoped state (orchestrator.ts handleKubeconfigChanging).
  eventBus.emit('kubeconfig:changing', '');
  refreshOrchestrator.setConnectedClusters([]);
  // Cluster workspace selection, lifecycle, and readiness.
  clusterReadiness.resetForTests();
  resetPermissionStoreForTests();
  resetAppPreferencesCacheForTesting();
  resetErrorReportingForTesting();
  resetFavoritesCacheForTesting();
  resetClusterTabOrderCacheForTesting();
  resetGridTablePersistenceCacheForTesting();
  resetGridTableViewRegistryForTests(PRODUCTION_GRID_TABLE_VIEWS);
  // A navigation's focus request that no table consumed.
  setPendingFocusRequest(null);
  resetBrokerReadDiagnosticsForTesting();
  resetContainerLogsStreamScopeParamsCacheForTesting();
  resetLogViewerPrefsCacheForTesting();
  resetHelmValuesViewCacheForTesting();
  resetNodeLogDiscoveryCacheForTesting();
  resetObjectPanelTabRequestsForTesting();
  resetAcknowledgedPanelTransfersForTesting();
  resetPanelPublicationQueuesForTesting();
  __clearSearchShortcutTargetsForTest();
  __resetScrollbarActivityTrackingForTest();
  errorHandler.clearHistory();
  setWindowIdentity(DEFAULT_WINDOW_IDENTITY);
  // Preference hydration and several caches mirror into web storage.
  localStorage.clear();
  sessionStorage.clear();
};
