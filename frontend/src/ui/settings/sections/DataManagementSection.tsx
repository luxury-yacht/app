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
import { SettingRow, usePreferenceValue } from './SettingsControls';

const dataManagementOperations = {
  'export-settings': {
    run: ExportSettings,
    action: 'exportSettings',
    success: 'Settings exported.',
  },
  'import-settings': {
    run: ImportSettings,
    action: 'importSettings',
    success: 'Settings imported.',
  },
  'export-favorites': {
    run: ExportFavorites,
    action: 'exportFavorites',
    success: 'Favorites exported.',
  },
  'import-favorites': {
    run: ImportFavorites,
    action: 'importFavorites',
    success: 'Favorites imported.',
  },
};

type DataManagementOperation = keyof typeof dataManagementOperations;

function DataManagementSection() {
  const elementIdPrefix = useId();
  const errorReportingEnabled = usePreferenceValue(
    getErrorReportingEnabled,
    'settings:error-reporting'
  );
  const [operation, setOperation] = useState<DataManagementOperation | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void hydrateAppPreferences({ force: true }).catch((error) => {
      errorHandler.handle(error, { action: 'loadDataManagementSettings' });
    });
  }, []);

  const handleErrorReportingToggle = async (enabled: boolean) => {
    try {
      await setErrorReportingEnabled(enabled);
    } catch (error) {
      errorHandler.handle(error, { action: 'updateErrorReporting' });
    }
  };

  const handleOperation = async (nextOperation: DataManagementOperation) => {
    setStatus(null);
    setOperation(nextOperation);
    const { run, action, success } = dataManagementOperations[nextOperation];
    try {
      const result = await run();
      if (result.canceled) {
        return;
      }
      if (nextOperation === 'import-settings') {
        await hydrateAppPreferences({ force: true });
      } else if (nextOperation === 'import-favorites') {
        await hydrateFavorites({ force: true });
      }
      setStatus(success);
    } catch (error) {
      errorHandler.handle(error, { action });
    } finally {
      setOperation(null);
    }
  };

  return (
    <div className="settings-panel">
      <h2 className="settings-panel-title">Data Management</h2>

      <div className="settings-subgroup-label">Export and Import</div>
      <hr className="settings-subgroup-divider" />

      <SettingRow title="Settings" help="Export or import the settings managed in this panel.">
        <div className="setting-item setting-actions">
          <button
            type="button"
            className="button generic"
            disabled={operation !== null}
            onClick={() => handleOperation('export-settings')}
          >
            Export Settings
          </button>
          <button
            type="button"
            className="button generic"
            disabled={operation !== null}
            onClick={() => handleOperation('import-settings')}
          >
            Import Settings
          </button>
        </div>
      </SettingRow>

      <SettingRow title="Favorites" help="Export or import your saved Favorites.">
        <div className="setting-item setting-actions">
          <button
            type="button"
            className="button generic"
            disabled={operation !== null}
            onClick={() => handleOperation('export-favorites')}
          >
            Export Favorites
          </button>
          <button
            type="button"
            className="button generic"
            disabled={operation !== null}
            onClick={() => handleOperation('import-favorites')}
          >
            Import Favorites
          </button>
        </div>
      </SettingRow>

      <div className="settings-subgroup-label">Telemetry</div>
      <hr className="settings-subgroup-divider" />

      <SettingRow
        title="Error Reporting"
        help="Sends pseudonymous error diagnostics linked to this installation. Reports exclude request data and redact common credentials and infrastructure identifiers. Disable this to stop future reports."
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
