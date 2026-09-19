/**
 * frontend/src/ui/settings/sections/DisplaySection.tsx
 *
 * Display tab content: display-related preferences.
 */

import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import {
  normalizeTablePageSize,
  TABLE_PAGE_SIZE_OPTIONS,
} from '@shared/components/tables/pageSizeOptions';
import { errorHandler } from '@utils/errorHandler';
import { useEffect, useId } from 'react';
import {
  getDefaultTablePageSize,
  getDimInactiveNamespaces,
  getExclusiveNamespaces,
  getUseShortResourceNames,
  hydrateAppPreferences,
  setDefaultTablePageSize as persistDefaultTablePageSize,
  setDimInactiveNamespaces as persistDimInactiveNamespaces,
  setExclusiveNamespaces as persistExclusiveNamespaces,
  setUseShortResourceNames as persistUseShortResourceNames,
} from '@/core/settings/appPreferences';
import ToggleSwitch from '@/shared/components/ToggleSwitch';
import { SettingRow, usePreferenceToggle, usePreferenceValue } from './SettingsControls';

// The same list every pagination footer renders — one source for both.
const PAGE_SIZE_DROPDOWN_OPTIONS = TABLE_PAGE_SIZE_OPTIONS.map((value) => ({
  value: String(value),
  label: String(value),
}));

function DisplaySection() {
  const elementIdPrefix = useId();
  const useShortResourceNames = usePreferenceValue(
    getUseShortResourceNames,
    'settings:short-names'
  );
  const dimInactiveNamespaces = usePreferenceValue(
    getDimInactiveNamespaces,
    'settings:dim-inactive-namespaces'
  );
  const exclusiveNamespaces = usePreferenceValue(
    getExclusiveNamespaces,
    'settings:exclusive-namespaces'
  );
  const defaultTablePageSize = usePreferenceValue(
    getDefaultTablePageSize,
    'settings:default-table-page-size'
  );

  useEffect(() => {
    void hydrateAppPreferences({ force: true }).catch((error) => {
      errorHandler.handle(error, { action: 'loadDisplaySettings' });
    });
  }, []);

  const handleDefaultTablePageSizeChange = (value: string | string[]) => {
    const size = normalizeTablePageSize(Number(value));
    persistDefaultTablePageSize(size);
  };

  const handleShortNamesToggle = usePreferenceToggle({
    action: 'setUseShortResourceNames',
    valueKey: 'useShort',
    persist: persistUseShortResourceNames,
  });

  const handleDimInactiveNamespacesToggle = usePreferenceToggle({
    action: 'setDimInactiveNamespaces',
    valueKey: 'enabled',
    persist: persistDimInactiveNamespaces,
  });

  const handleExclusiveNamespacesToggle = usePreferenceToggle({
    action: 'setExclusiveNamespaces',
    valueKey: 'enabled',
    persist: persistExclusiveNamespaces,
  });

  return (
    <div className="settings-panel">
      <h2 className="settings-panel-title">Display</h2>

      <div className="settings-subgroup-label">Tables</div>
      <hr className="settings-subgroup-divider" />

      <SettingRow
        title="Default page size"
        help="Default page size for tables. Changing the page size on a specific table will override this value for that table only."
      >
        <Dropdown
          options={PAGE_SIZE_DROPDOWN_OPTIONS}
          value={String(defaultTablePageSize)}
          onChange={handleDefaultTablePageSizeChange}
          ariaLabel="Default page size"
          size="compact"
          className="settings-page-size-dropdown"
        />
      </SettingRow>

      <div className="settings-subgroup-label">Resources</div>
      <hr className="settings-subgroup-divider" />

      <SettingRow
        title="Short resource names"
        help='Display short resource names (e.g., "sts" instead of "StatefulSets").'
      >
        <ToggleSwitch
          id={`${elementIdPrefix}-short-resource-names`}
          checked={useShortResourceNames}
          onChange={handleShortNamesToggle}
          ariaLabel="Short resource names"
        />
      </SettingRow>

      <div className="settings-subgroup-label">Sidebar</div>
      <hr className="settings-subgroup-divider" />

      <SettingRow
        title="Dim inactive namespaces"
        help="Dim namespaces in the Sidebar that have no Workloads."
      >
        <ToggleSwitch
          id={`${elementIdPrefix}-dim-inactive-namespaces`}
          checked={dimInactiveNamespaces}
          onChange={handleDimInactiveNamespacesToggle}
          ariaLabel="Dim inactive namespaces"
        />
      </SettingRow>

      <SettingRow
        title="Exclusive namespaces"
        help="When enabled, only one namespace at a time can be expanded in the Sidebar. Expanding a different namespace will collapse the currently expanded one."
      >
        <ToggleSwitch
          id={`${elementIdPrefix}-exclusive-namespaces`}
          checked={exclusiveNamespaces}
          onChange={handleExclusiveNamespacesToggle}
          ariaLabel="Exclusive namespaces"
        />
      </SettingRow>
    </div>
  );
}

export default DisplaySection;
