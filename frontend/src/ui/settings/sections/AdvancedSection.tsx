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
  type AppPreferenceKey,
  commitIntegerPreferenceInput,
  getKubernetesClientBurst,
  getKubernetesClientQPS,
  getPermissionSSRRFetchConcurrency,
  hydrateAppPreferences,
  setKubernetesClientBurst,
  setKubernetesClientQPS,
  setPermissionSSRRFetchConcurrency,
} from '@/core/settings/appPreferences';
import { PreferenceNumberInput, SettingRow } from './SettingsControls';

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

  // Commit a raw input string: normalize + persist, then reflect the applied value.
  const commitPreferenceInput =
    (key: AppPreferenceKey, persist: (value: number) => void, setInput: (value: string) => void) =>
    (raw: string) => {
      const normalized = commitIntegerPreferenceInput(key, raw, persist, {
        defaultOnNonPositive: true,
      });
      setInput(String(normalized));
    };

  const commitKubernetesClientQPS = commitPreferenceInput(
    'kubernetesClientQPS',
    setKubernetesClientQPS,
    setKubernetesClientQPSInput
  );
  const commitKubernetesClientBurst = commitPreferenceInput(
    'kubernetesClientBurst',
    setKubernetesClientBurst,
    setKubernetesClientBurstInput
  );
  const commitPermissionSSRRFetchConcurrency = commitPreferenceInput(
    'permissionSSRRFetchConcurrency',
    setPermissionSSRRFetchConcurrency,
    setPermissionSSRRFetchConcurrencyInput
  );

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

      <SettingRow
        title="Auto-refresh"
        help="Automatically refresh data at regular intervals. If disabled, you will have to manually refresh for updated data."
      >
        <ToggleSwitch
          id={`${elementIdPrefix}-refresh-enabled`}
          checked={refreshEnabled}
          onChange={handleRefreshToggle}
          ariaLabel="Auto-refresh"
        />
      </SettingRow>

      <SettingRow
        title="Refresh background clusters"
        help="When enabled, open cluster tabs that are not active will be refreshed in the background."
      >
        <ToggleSwitch
          id={`${elementIdPrefix}-refresh-background`}
          checked={backgroundRefreshEnabled}
          onChange={setBackgroundRefresh}
          ariaLabel="Background clusters refresh"
        />
      </SettingRow>

      <div className="settings-subgroup-label">Kubernetes API</div>
      <hr className="settings-subgroup-divider" />

      <SettingRow
        title="Client QPS"
        help="Sustained per-second rate for K8s API requests. This value is per-cluster."
      >
        <div className="setting-item setting-item-inline">
          <PreferenceNumberInput
            id={`${elementIdPrefix}-settings-kubernetes-client-qps`}
            prefKey="kubernetesClientQPS"
            step={10}
            value={kubernetesClientQPSInput}
            onChange={setKubernetesClientQPSInput}
            onCommit={commitKubernetesClientQPS}
          />{' '}
          queries per second
        </div>
      </SettingRow>

      <SettingRow
        title="Client burst allowance"
        help="Short-term burst allowance for K8s API requests. This value is per-cluster."
      >
        <div className="setting-item setting-item-inline">
          <PreferenceNumberInput
            id={`${elementIdPrefix}-settings-kubernetes-client-burst`}
            prefKey="kubernetesClientBurst"
            step={10}
            value={kubernetesClientBurstInput}
            onChange={setKubernetesClientBurstInput}
            onCommit={commitKubernetesClientBurst}
          />{' '}
          queries per second
        </div>
      </SettingRow>

      <SettingRow
        title="SSRR concurrency"
        help={
          <>
            Concurrent <code>SelfSubjectRulesReview</code> requests during permission checks.
          </>
        }
      >
        <div className="setting-item setting-item-inline">
          <PreferenceNumberInput
            id={`${elementIdPrefix}-settings-permission-ssrr-concurrency`}
            prefKey="permissionSSRRFetchConcurrency"
            step={1}
            value={permissionSSRRFetchConcurrencyInput}
            onChange={setPermissionSSRRFetchConcurrencyInput}
            onCommit={commitPermissionSSRRFetchConcurrency}
          />{' '}
          concurrent requests
        </div>
      </SettingRow>

      <div className="settings-subgroup-label">Persistence</div>
      <hr className="settings-subgroup-divider" />

      <SettingRow
        title="Per-namespace views"
        help="Save separate column, sorting, and filter settings for each namespace instead of sharing a single view across all namespaces."
      >
        <ToggleSwitch
          id={`${elementIdPrefix}-persist-namespaced`}
          checked={persistenceMode === 'namespaced'}
          onChange={handlePersistenceModeToggle}
          ariaLabel="Per-namespace views"
        />
      </SettingRow>

      <SettingRow title="Reset Views" help="Clears column/sort/filter settings in all views.">
        <div className="setting-item setting-actions">
          <button
            type="button"
            className="button generic"
            onClick={() => setIsResetViewsConfirmOpen(true)}
          >
            Reset Views
          </button>
        </div>
      </SettingRow>

      <SettingRow
        title="Factory Reset"
        help="Deletes all preferences and saved state, then restarts the app."
      >
        <div className="setting-item setting-actions">
          <button
            type="button"
            className="button generic"
            onClick={() => setIsClearStateConfirmOpen(true)}
          >
            Factory Reset
          </button>
        </div>
      </SettingRow>

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
