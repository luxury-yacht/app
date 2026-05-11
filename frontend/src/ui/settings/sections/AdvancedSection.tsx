/**
 * frontend/src/ui/settings/sections/AdvancedSection.tsx
 *
 * Advanced tab content: refresh, table limits, persistence, and reset actions.
 */

import { useState, useEffect } from 'react';
import { errorHandler } from '@utils/errorHandler';
import { useAutoRefresh, useBackgroundRefresh } from '@/core/refresh';
import { clearAllGridTableState } from '@shared/components/tables/persistence/gridTablePersistenceReset';
import {
  hydrateAppPreferences,
  getKubernetesClientBurst,
  getKubernetesClientQPS,
  getMaxTableRows,
  getPermissionSSRRFetchConcurrency,
  KUBERNETES_CLIENT_BURST_DEFAULT,
  KUBERNETES_CLIENT_BURST_MAX,
  KUBERNETES_CLIENT_BURST_MIN,
  KUBERNETES_CLIENT_QPS_DEFAULT,
  KUBERNETES_CLIENT_QPS_MAX,
  KUBERNETES_CLIENT_QPS_MIN,
  MAX_TABLE_ROWS_DEFAULT,
  MAX_TABLE_ROWS_MAX,
  MAX_TABLE_ROWS_MIN,
  PERMISSION_SSRR_FETCH_CONCURRENCY_DEFAULT,
  PERMISSION_SSRR_FETCH_CONCURRENCY_MAX,
  PERMISSION_SSRR_FETCH_CONCURRENCY_MIN,
  setKubernetesClientBurst,
  setKubernetesClientQPS,
  setMaxTableRows,
  setPermissionSSRRFetchConcurrency,
} from '@/core/settings/appPreferences';
import { clearTintedPalette } from '@utils/paletteTint';
import { clearAccentColor } from '@utils/accentColor';
import { clearLinkColor } from '@utils/linkColor';
import {
  getGridTablePersistenceMode,
  setGridTablePersistenceMode,
  type GridTablePersistenceMode,
} from '@shared/components/tables/persistence/gridTablePersistenceSettings';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import ToggleSwitch from '@shared/components/ToggleSwitch';

function AdvancedSection() {
  const { enabled: refreshEnabled, setAutoRefresh } = useAutoRefresh();
  const { enabled: backgroundRefreshEnabled, setBackgroundRefresh } = useBackgroundRefresh();
  const [maxTableRowsInput, setMaxTableRowsInput] = useState<string>(() =>
    String(getMaxTableRows())
  );
  const [kubernetesClientQPSInput, setKubernetesClientQPSInput] = useState<string>(() =>
    String(getKubernetesClientQPS())
  );
  const [kubernetesClientBurstInput, setKubernetesClientBurstInput] = useState<string>(() =>
    String(getKubernetesClientBurst())
  );
  const [permissionSSRRFetchConcurrencyInput, setPermissionSSRRFetchConcurrencyInput] =
    useState<string>(() => String(getPermissionSSRRFetchConcurrency()));
  const [persistenceMode, setPersistenceMode] = useState<GridTablePersistenceMode>(() =>
    getGridTablePersistenceMode()
  );
  const [isClearStateConfirmOpen, setIsClearStateConfirmOpen] = useState(false);
  const [isResetViewsConfirmOpen, setIsResetViewsConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await hydrateAppPreferences({ force: true });
        if (!cancelled) {
          setMaxTableRowsInput(String(prefs.maxTableRows ?? MAX_TABLE_ROWS_DEFAULT));
          setKubernetesClientQPSInput(
            String(prefs.kubernetesClientQPS ?? KUBERNETES_CLIENT_QPS_DEFAULT)
          );
          setKubernetesClientBurstInput(
            String(prefs.kubernetesClientBurst ?? KUBERNETES_CLIENT_BURST_DEFAULT)
          );
          setPermissionSSRRFetchConcurrencyInput(
            String(
              prefs.permissionSSRRFetchConcurrency ?? PERMISSION_SSRR_FETCH_CONCURRENCY_DEFAULT
            )
          );
          setPersistenceMode(getGridTablePersistenceMode());
        }
      } catch (error) {
        errorHandler.handle(error, { action: 'loadAdvancedSettings' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefreshToggle = (enabled: boolean) => setAutoRefresh(enabled);

  const handlePersistenceModeToggle = (checked: boolean) => {
    const mode: GridTablePersistenceMode = checked ? 'namespaced' : 'shared';
    setPersistenceMode(mode);
    setGridTablePersistenceMode(mode);
  };

  const commitMaxTableRows = (raw: string) => {
    const parsed = parseInt(raw, 10);
    const normalized =
      Number.isNaN(parsed) || parsed <= 0
        ? MAX_TABLE_ROWS_DEFAULT
        : Math.max(MAX_TABLE_ROWS_MIN, Math.min(MAX_TABLE_ROWS_MAX, parsed));
    setMaxTableRowsInput(String(normalized));
    setMaxTableRows(normalized);
  };

  const commitKubernetesClientQPS = (raw: string) => {
    const parsed = parseInt(raw, 10);
    const normalized =
      Number.isNaN(parsed) || parsed <= 0
        ? KUBERNETES_CLIENT_QPS_DEFAULT
        : Math.max(KUBERNETES_CLIENT_QPS_MIN, Math.min(KUBERNETES_CLIENT_QPS_MAX, parsed));
    setKubernetesClientQPSInput(String(normalized));
    setKubernetesClientQPS(normalized);
  };

  const commitKubernetesClientBurst = (raw: string) => {
    const parsed = parseInt(raw, 10);
    const normalized =
      Number.isNaN(parsed) || parsed <= 0
        ? KUBERNETES_CLIENT_BURST_DEFAULT
        : Math.max(KUBERNETES_CLIENT_BURST_MIN, Math.min(KUBERNETES_CLIENT_BURST_MAX, parsed));
    setKubernetesClientBurstInput(String(normalized));
    setKubernetesClientBurst(normalized);
  };

  const commitPermissionSSRRFetchConcurrency = (raw: string) => {
    const parsed = parseInt(raw, 10);
    const normalized =
      Number.isNaN(parsed) || parsed <= 0
        ? PERMISSION_SSRR_FETCH_CONCURRENCY_DEFAULT
        : Math.max(
            PERMISSION_SSRR_FETCH_CONCURRENCY_MIN,
            Math.min(PERMISSION_SSRR_FETCH_CONCURRENCY_MAX, parsed)
          );
    setPermissionSSRRFetchConcurrencyInput(String(normalized));
    setPermissionSSRRFetchConcurrency(normalized);
  };

  const handleResetViews = async () => {
    setIsResetViewsConfirmOpen(false);
    await clearAllGridTableState();
  };

  const handleClearAllState = async () => {
    setIsClearStateConfirmOpen(false);
    try {
      // Clear palette tint, accent color, and link color before reload so UI reverts immediately.
      clearTintedPalette();
      clearAccentColor();
      clearLinkColor();

      const clearAppState = (window as any)?.go?.backend?.App?.ClearAppState;
      if (typeof clearAppState !== 'function') {
        throw new Error('ClearAppState is not available');
      }
      await clearAppState();

      await clearAllGridTableState();
      try {
        localStorage.clear();
      } catch {
        /* ignore */
      }
      try {
        sessionStorage.clear();
      } catch {
        /* ignore */
      }

      window.location.reload();
    } catch (error) {
      errorHandler.handle(error, { action: 'clearAllState' });
    }
  };

  return (
    <div className="settings-panel">
      <h2 className="settings-panel-title">Advanced</h2>

      <div className="settings-advanced-warning">
        ⚠️ Modifying these settings could negatively impact app behavior or performance.
      </div>

      <div className="settings-subgroup-label">Refresh</div>
      <hr className="settings-subgroup-divider" />

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Auto-refresh</div>
          <div className="settings-row-label-help">
            Automatically refresh data at regular intervals. If disabled, you will have to manually
            refresh for updated data.
          </div>
        </div>
        <div className="settings-row-control">
          <ToggleSwitch
            id="refresh-enabled"
            checked={refreshEnabled}
            onChange={handleRefreshToggle}
            ariaLabel="Auto-refresh"
          />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Refresh background clusters</div>
          <div className="settings-row-label-help">
            When enabled, open cluster tabs that are not active will be refreshed in the background.
          </div>
        </div>
        <div className="settings-row-control">
          <ToggleSwitch
            id="refresh-background"
            checked={backgroundRefreshEnabled}
            onChange={setBackgroundRefresh}
            ariaLabel="Background clusters refresh"
          />
        </div>
      </div>

      <div className="settings-subgroup-label">Tables</div>
      <hr className="settings-subgroup-divider" />

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Max rows</div>
          <div className="settings-row-label-help">
            Max number of rows in a data table. Larger values will show more data, but could impact
            app rendering performance.
          </div>
        </div>
        <div className="settings-row-control">
          <div className="setting-item setting-item-inline">
            <input
              type="number"
              id="settings-max-table-rows"
              min={MAX_TABLE_ROWS_MIN}
              max={MAX_TABLE_ROWS_MAX}
              step={100}
              value={maxTableRowsInput}
              onChange={(e) => setMaxTableRowsInput(e.target.value)}
              onBlur={(e) => commitMaxTableRows(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />{' '}
            rows
          </div>
        </div>
      </div>

      <div className="settings-subgroup-label">Kubernetes API</div>
      <hr className="settings-subgroup-divider" />

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Client QPS</div>
          <div className="settings-row-label-help">
            Sustained per-second rate for K8s API requests. This value is per-cluster.
          </div>
        </div>
        <div className="settings-row-control">
          <div className="setting-item setting-item-inline">
            <input
              type="number"
              id="settings-kubernetes-client-qps"
              min={KUBERNETES_CLIENT_QPS_MIN}
              max={KUBERNETES_CLIENT_QPS_MAX}
              step={10}
              value={kubernetesClientQPSInput}
              onChange={(e) => setKubernetesClientQPSInput(e.target.value)}
              onBlur={(e) => commitKubernetesClientQPS(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />{' '}
            queries per second
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Client burst allowance</div>
          <div className="settings-row-label-help">
            Short-term burst allowance for K8s API requests. This value is per-cluster.
          </div>
        </div>
        <div className="settings-row-control">
          <div className="setting-item setting-item-inline">
            <input
              type="number"
              id="settings-kubernetes-client-burst"
              min={KUBERNETES_CLIENT_BURST_MIN}
              max={KUBERNETES_CLIENT_BURST_MAX}
              step={10}
              value={kubernetesClientBurstInput}
              onChange={(e) => setKubernetesClientBurstInput(e.target.value)}
              onBlur={(e) => commitKubernetesClientBurst(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />{' '}
            queries per second
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">SSRR concurrency</div>
          <div className="settings-row-label-help">
            Concurrent <code>SelfSubjectRulesReview</code> requests during permission checks.
          </div>
        </div>
        <div className="settings-row-control">
          <div className="setting-item setting-item-inline">
            <input
              type="number"
              id="settings-permission-ssrr-concurrency"
              min={PERMISSION_SSRR_FETCH_CONCURRENCY_MIN}
              max={PERMISSION_SSRR_FETCH_CONCURRENCY_MAX}
              step={1}
              value={permissionSSRRFetchConcurrencyInput}
              onChange={(e) => setPermissionSSRRFetchConcurrencyInput(e.target.value)}
              onBlur={(e) => commitPermissionSSRRFetchConcurrency(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />{' '}
            concurrent requests
          </div>
        </div>
      </div>

      <div className="settings-subgroup-label">Persistence</div>
      <hr className="settings-subgroup-divider" />

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Per-namespace views</div>
          <div className="settings-row-label-help">
            Save separate column, sorting, and filter settings for each namespace instead of sharing
            a single view across all namespaces.
          </div>
        </div>
        <div className="settings-row-control">
          <ToggleSwitch
            id="persist-namespaced"
            checked={persistenceMode === 'namespaced'}
            onChange={handlePersistenceModeToggle}
            ariaLabel="Per-namespace views"
          />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Reset Views</div>
          <div className="settings-row-label-help">
            Clears column/sort/filter settings in all views.
          </div>
        </div>
        <div className="settings-row-control">
          <div className="setting-item setting-actions">
            <button
              type="button"
              className="button generic"
              onClick={() => setIsResetViewsConfirmOpen(true)}
            >
              Reset Views
            </button>
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Factory Reset</div>
          <div className="settings-row-label-help">
            Deletes all preferences and saved state, then restarts the app.
          </div>
        </div>
        <div className="settings-row-control">
          <div className="setting-item setting-actions">
            <button
              type="button"
              className="button generic"
              onClick={() => setIsClearStateConfirmOpen(true)}
            >
              Factory Reset
            </button>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={isResetViewsConfirmOpen}
        title="Reset Views"
        message="This will clear your view settings (columns/sorting/filters). Are you sure?"
        confirmText="Confirm"
        confirmButtonClass="warning"
        onConfirm={handleResetViews}
        onCancel={() => setIsResetViewsConfirmOpen(false)}
      />
      <ConfirmationModal
        isOpen={isClearStateConfirmOpen}
        title="Factory Reset"
        message="⚠️ This will clear ALL saved state (preferences, favorites, view settings, etc.) and restart the app. Are you sure?"
        confirmText="Confirm"
        confirmButtonClass="danger"
        onConfirm={handleClearAllState}
        onCancel={() => setIsClearStateConfirmOpen(false)}
      />
    </div>
  );
}

export default AdvancedSection;
