/**
 * frontend/src/ui/settings/sections/AdvancedSection.tsx
 *
 * Advanced tab content: refresh, persistence, Kubernetes API, and reset actions.
 */

import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import ToggleSwitch from '@shared/components/ToggleSwitch';
import { clearAllGridTableState } from '@shared/components/tables/persistence/gridTablePersistenceReset';
import {
  type GridTablePersistenceMode,
  getGridTablePersistenceMode,
  setGridTablePersistenceMode,
} from '@shared/components/tables/persistence/gridTablePersistenceSettings';
import { clearAccentColor } from '@utils/accentColor';
import { errorHandler } from '@utils/errorHandler';
import { clearLinkColor } from '@utils/linkColor';
import { clearTintedPalette } from '@utils/paletteTint';
import { useEffect, useId, useState } from 'react';
import { useAutoRefresh, useBackgroundRefresh } from '@/core/refresh';
import {
  commitIntegerPreferenceInput,
  getIntegerPreferenceMetadata,
  getKubernetesClientBurst,
  getKubernetesClientQPS,
  getPermissionSSRRFetchConcurrency,
  hydrateAppPreferences,
  setKubernetesClientBurst,
  setKubernetesClientQPS,
  setPermissionSSRRFetchConcurrency,
} from '@/core/settings/appPreferences';

function AdvancedSection() {
  const elementIdPrefix = useId();
  const { enabled: refreshEnabled, setAutoRefresh } = useAutoRefresh();
  const { enabled: backgroundRefreshEnabled, setBackgroundRefresh } = useBackgroundRefresh();
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
  const kubernetesClientQPSMetadata = getIntegerPreferenceMetadata('kubernetesClientQPS');
  const kubernetesClientBurstMetadata = getIntegerPreferenceMetadata('kubernetesClientBurst');
  const permissionSSRRFetchConcurrencyMetadata = getIntegerPreferenceMetadata(
    'permissionSSRRFetchConcurrency'
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await hydrateAppPreferences({ force: true });
        if (!cancelled) {
          setKubernetesClientQPSInput(String(prefs.kubernetesClientQPS));
          setKubernetesClientBurstInput(String(prefs.kubernetesClientBurst));
          setPermissionSSRRFetchConcurrencyInput(String(prefs.permissionSSRRFetchConcurrency));
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

  const commitKubernetesClientQPS = (raw: string) => {
    const normalized = commitIntegerPreferenceInput(
      'kubernetesClientQPS',
      raw,
      setKubernetesClientQPS,
      {
        defaultOnNonPositive: true,
      }
    );
    setKubernetesClientQPSInput(String(normalized));
  };

  const commitKubernetesClientBurst = (raw: string) => {
    const normalized = commitIntegerPreferenceInput(
      'kubernetesClientBurst',
      raw,
      setKubernetesClientBurst,
      {
        defaultOnNonPositive: true,
      }
    );
    setKubernetesClientBurstInput(String(normalized));
  };

  const commitPermissionSSRRFetchConcurrency = (raw: string) => {
    const normalized = commitIntegerPreferenceInput(
      'permissionSSRRFetchConcurrency',
      raw,
      setPermissionSSRRFetchConcurrency,
      {
        defaultOnNonPositive: true,
      }
    );
    setPermissionSSRRFetchConcurrencyInput(String(normalized));
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

      const clearAppState = window.go?.backend?.App?.ClearAppState;
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
            id={`${elementIdPrefix}-refresh-enabled`}
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
            id={`${elementIdPrefix}-refresh-background`}
            checked={backgroundRefreshEnabled}
            onChange={setBackgroundRefresh}
            ariaLabel="Background clusters refresh"
          />
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
              id={`${elementIdPrefix}-settings-kubernetes-client-qps`}
              min={kubernetesClientQPSMetadata.min}
              max={kubernetesClientQPSMetadata.max}
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
              id={`${elementIdPrefix}-settings-kubernetes-client-burst`}
              min={kubernetesClientBurstMetadata.min}
              max={kubernetesClientBurstMetadata.max}
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
              id={`${elementIdPrefix}-settings-permission-ssrr-concurrency`}
              min={permissionSSRRFetchConcurrencyMetadata.min}
              max={permissionSSRRFetchConcurrencyMetadata.max}
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
            id={`${elementIdPrefix}-persist-namespaced`}
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
