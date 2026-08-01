import ToggleSwitch from '@shared/components/ToggleSwitch';
import { errorHandler } from '@utils/errorHandler';
import { useEffect, useId, useState } from 'react';
import {
  ExportFavorites,
  ExportSettings,
  ImportFavorites,
  ImportSettings,
} from '@/core/backend-api';
import { hydrateFavorites } from '@/core/persistence/favorites';
import {
  getErrorReportingEnabled,
  hydrateAppPreferences,
  setErrorReportingEnabled,
} from '@/core/settings/appPreferences';
import { SettingRow } from './SettingsControls';

type DataManagementOperation =
  | 'export-settings'
  | 'import-settings'
  | 'export-favorites'
  | 'import-favorites';

function DataManagementSection() {
  const elementIdPrefix = useId();
  const [errorReportingEnabled, setErrorReportingState] = useState(() =>
    getErrorReportingEnabled()
  );
  const [operation, setOperation] = useState<DataManagementOperation | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const preferences = await hydrateAppPreferences({ force: true });
        if (!cancelled) {
          setErrorReportingState(preferences.errorReportingEnabled);
        }
      } catch (error) {
        errorHandler.handle(error, { action: 'loadDataManagementSettings' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleErrorReportingToggle = async (enabled: boolean) => {
    const previous = errorReportingEnabled;
    setErrorReportingState(enabled);
    try {
      await setErrorReportingEnabled(enabled);
    } catch (error) {
      setErrorReportingState(previous);
      errorHandler.handle(error, { action: 'updateErrorReporting' });
    }
  };

  const handleExportSettings = async () => {
    setStatus(null);
    setOperation('export-settings');
    try {
      const result = await ExportSettings();
      if (!result.canceled) {
        setStatus('Settings exported.');
      }
    } catch (error) {
      errorHandler.handle(error, { action: 'exportSettings' });
    } finally {
      setOperation(null);
    }
  };

  const handleExportFavorites = async () => {
    setStatus(null);
    setOperation('export-favorites');
    try {
      const result = await ExportFavorites();
      if (!result.canceled) {
        setStatus('Favorites exported.');
      }
    } catch (error) {
      errorHandler.handle(error, { action: 'exportFavorites' });
    } finally {
      setOperation(null);
    }
  };

  const handleImportSettings = async () => {
    setStatus(null);
    setOperation('import-settings');
    try {
      const result = await ImportSettings();
      if (!result.canceled) {
        const preferences = await hydrateAppPreferences({ force: true });
        setErrorReportingState(preferences.errorReportingEnabled);
        setStatus('Settings imported.');
      }
    } catch (error) {
      errorHandler.handle(error, { action: 'importSettings' });
    } finally {
      setOperation(null);
    }
  };

  const handleImportFavorites = async () => {
    setStatus(null);
    setOperation('import-favorites');
    try {
      const result = await ImportFavorites();
      if (!result.canceled) {
        await hydrateFavorites({ force: true });
        setStatus('Favorites imported.');
      }
    } catch (error) {
      errorHandler.handle(error, { action: 'importFavorites' });
    } finally {
      setOperation(null);
    }
  };

  return (
    <div className="settings-panel">
      <h2 className="settings-panel-title">Data Management</h2>

      <SettingRow
        title="Settings"
        help="Export or import preferences, themes, and kubeconfig search paths. Saved view state is not included."
      >
        <div className="setting-item setting-actions">
          <button
            type="button"
            className="button generic"
            disabled={operation !== null}
            onClick={handleExportSettings}
          >
            Export Settings
          </button>
          <button
            type="button"
            className="button generic"
            disabled={operation !== null}
            onClick={handleImportSettings}
          >
            Import Settings
          </button>
        </div>
      </SettingRow>

      <SettingRow
        title="Favorites"
        help="Export your favorites or replace the current favorites library from an export file."
      >
        <div className="setting-item setting-actions">
          <button
            type="button"
            className="button generic"
            disabled={operation !== null}
            onClick={handleExportFavorites}
          >
            Export Favorites
          </button>
          <button
            type="button"
            className="button generic"
            disabled={operation !== null}
            onClick={handleImportFavorites}
          >
            Import Favorites
          </button>
        </div>
      </SettingRow>

      <SettingRow
        title="Error Reporting"
        help="Sends helpful data when an error occurs that I use to improve the app. It is completely anonymous and cannot be used to identify you. Toggle it off if you do not wish to participate."
      >
        <ToggleSwitch
          id={`${elementIdPrefix}-error-reporting`}
          checked={errorReportingEnabled}
          onChange={handleErrorReportingToggle}
          ariaLabel="Error Reporting"
        />
      </SettingRow>

      {status ? (
        <div className="settings-data-management-status" role="status" aria-live="polite">
          {status}
        </div>
      ) : null}
    </div>
  );
}

export default DataManagementSection;
