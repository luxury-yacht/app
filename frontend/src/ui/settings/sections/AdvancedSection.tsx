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
  getMaxTableRows,
  MAX_TABLE_ROWS_DEFAULT,
  MAX_TABLE_ROWS_MAX,
  MAX_TABLE_ROWS_MIN,
  setMaxTableRows,
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

      <div className="settings-subgroup-label">Refresh</div>
      <hr className="settings-subgroup-divider" />

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Auto-refresh</div>
          <div className="settings-row-label-help">
            Automatically refresh resource data at regular intervals to keep views up to date.
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
          <div className="settings-row-label-title">Background clusters</div>
          <div className="settings-row-label-help">
            When enabled, clusters that are not actively selected will be refreshed in the
            background so their data stays current.
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
            Max number of rows in a data table. Larger values will show more data, but app
            performance may be impacted.
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
            />
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
          <div className="settings-row-label-title">Reset</div>
          <div className="settings-row-label-help">
            Reset Views clears column/sort/filter settings. Factory Reset wipes all preferences and
            restarts the app.
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
