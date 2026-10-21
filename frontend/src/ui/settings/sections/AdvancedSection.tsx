/**
 * frontend/src/ui/settings/sections/AdvancedSection.tsx
 *
 * Advanced tab content: refresh, persistence, Kubernetes API, and reset actions.
 */

import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import ToggleSwitch from '@shared/components/ToggleSwitch';
import { clearAllGridTableState } from '@shared/components/tables/persistence/gridTablePersistenceReset';
import { clearAccentColor } from '@utils/accentColor';
import { errorHandler } from '@utils/errorHandler';
import { clearLinkColor } from '@utils/linkColor';
import { clearTintedPalette } from '@utils/paletteTint';
import { useEffect, useId, useState } from 'react';
import { ClearAppState } from '@/core/backend-api';
import {
  type GridTablePersistenceMode,
  hydrateAppPreferences,
  setAutoRefreshEnabled,
  setGridTablePersistenceMode,
  setKubernetesClientBurst,
  setKubernetesClientQPS,
  setPermissionSSRRFetchConcurrency,
} from '@/core/settings/appPreferences';
import { usePreference } from '@/core/settings/usePreference';
import { PreferenceNumberRow, type PreferenceNumberSetting, SettingRow } from './SettingsControls';

const KUBERNETES_API_SETTINGS: PreferenceNumberSetting[] = [
  {
    title: 'Client QPS',
    help: 'Sustained per-second rate for K8s API requests. This value is per-cluster.',
    prefKey: 'kubernetesClientQPS',
    persist: setKubernetesClientQPS,
    step: 10,
    unit: 'queries per second',
  },
  {
    title: 'Client burst allowance',
    help: 'Short-term burst allowance for K8s API requests. This value is per-cluster.',
    prefKey: 'kubernetesClientBurst',
    persist: setKubernetesClientBurst,
    step: 10,
    unit: 'queries per second',
  },
  {
    title: 'SSRR concurrency',
    help: (
      <>
        Concurrent <code>SelfSubjectRulesReview</code> requests during permission checks.
      </>
    ),
    prefKey: 'permissionSSRRFetchConcurrency',
    persist: setPermissionSSRRFetchConcurrency,
    step: 1,
    unit: 'concurrent requests',
  },
];

function AdvancedSection() {
  const elementIdPrefix = useId();
  const refreshEnabled = usePreference('autoRefreshEnabled');
  const persistenceMode = usePreference('gridTablePersistenceMode');
  const [isClearStateConfirmOpen, setIsClearStateConfirmOpen] = useState(false);
  const [isResetViewsConfirmOpen, setIsResetViewsConfirmOpen] = useState(false);

  useEffect(() => {
    void hydrateAppPreferences({ force: true }).catch((error) => {
      errorHandler.handle(error, { action: 'loadAdvancedSettings' });
    });
  }, []);

  const handlePersistenceModeToggle = (checked: boolean) => {
    const mode: GridTablePersistenceMode = checked ? 'namespaced' : 'shared';
    setGridTablePersistenceMode(mode);
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

      await ClearAppState();

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
          onChange={setAutoRefreshEnabled}
          ariaLabel="Auto-refresh"
        />
      </SettingRow>

      <div className="settings-subgroup-label">Kubernetes API</div>
      <hr className="settings-subgroup-divider" />

      {KUBERNETES_API_SETTINGS.map((setting) => (
        <PreferenceNumberRow
          key={setting.prefKey}
          setting={setting}
          id={`${elementIdPrefix}-${setting.prefKey}`}
        />
      ))}

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
        help="Deletes all preferences and saved state, then reloads the app."
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
