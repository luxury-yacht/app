/**
 * frontend/src/ui/settings/sections/DisplaySection.tsx
 *
 * Display tab content: display-related preferences.
 */

import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import {
  DEFAULT_TABLE_PAGE_SIZE,
  normalizeTablePageSize,
  TABLE_PAGE_SIZE_OPTIONS,
  type TablePageSize,
} from '@shared/components/tables/pageSizeOptions';
import { errorHandler } from '@utils/errorHandler';
import { useEffect, useId, useState } from 'react';
import {
  hydrateAppPreferences,
  setDefaultTablePageSize as persistDefaultTablePageSize,
  setDimInactiveNamespaces as persistDimInactiveNamespaces,
  setExclusiveNamespaces as persistExclusiveNamespaces,
  setUseShortResourceNames as persistUseShortResourceNames,
} from '@/core/settings/appPreferences';
import ToggleSwitch from '@/shared/components/ToggleSwitch';

// The same list every pagination footer renders — one source for both.
const PAGE_SIZE_DROPDOWN_OPTIONS = TABLE_PAGE_SIZE_OPTIONS.map((value) => ({
  value: String(value),
  label: String(value),
}));

function DisplaySection() {
  const elementIdPrefix = useId();
  const [useShortResourceNames, setUseShortResourceNames] = useState<boolean>(false);
  const [dimInactiveNamespaces, setDimInactiveNamespaces] = useState<boolean>(true);
  const [exclusiveNamespaces, setExclusiveNamespaces] = useState<boolean>(true);
  const [defaultTablePageSize, setDefaultTablePageSize] =
    useState<TablePageSize>(DEFAULT_TABLE_PAGE_SIZE);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await hydrateAppPreferences({ force: true });
        if (!cancelled) {
          setUseShortResourceNames(prefs.useShortResourceNames);
          setDimInactiveNamespaces(prefs.dimInactiveNamespaces);
          setExclusiveNamespaces(prefs.exclusiveNamespaces);
          setDefaultTablePageSize(normalizeTablePageSize(prefs.defaultTablePageSize));
        }
      } catch (error) {
        errorHandler.handle(error, { action: 'loadDisplaySettings' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDefaultTablePageSizeChange = (value: string | string[]) => {
    const size = normalizeTablePageSize(Number(value));
    setDefaultTablePageSize(size);
    persistDefaultTablePageSize(size);
  };

  const handleShortNamesToggle = async (useShort: boolean) => {
    setUseShortResourceNames(useShort);
    try {
      await persistUseShortResourceNames(useShort);
    } catch (error) {
      errorHandler.handle(error, { action: 'setUseShortResourceNames', useShort });
      // Revert on failure.
      setUseShortResourceNames(!useShort);
    }
  };

  const handleDimInactiveNamespacesToggle = async (enabled: boolean) => {
    setDimInactiveNamespaces(enabled);
    try {
      await persistDimInactiveNamespaces(enabled);
    } catch (error) {
      errorHandler.handle(error, { action: 'setDimInactiveNamespaces', enabled });
      setDimInactiveNamespaces(!enabled);
    }
  };

  const handleExclusiveNamespacesToggle = async (enabled: boolean) => {
    setExclusiveNamespaces(enabled);
    try {
      await persistExclusiveNamespaces(enabled);
    } catch (error) {
      errorHandler.handle(error, { action: 'setExclusiveNamespaces', enabled });
      setExclusiveNamespaces(!enabled);
    }
  };

  return (
    <div className="settings-panel">
      <h2 className="settings-panel-title">Display</h2>

      <div className="settings-subgroup-label">Tables</div>
      <hr className="settings-subgroup-divider" />

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Default page size</div>
          <div className="settings-row-label-help">
            Default page size for tables. Changing the page size on a specific table will override
            this value for that table only.
          </div>
        </div>
        <div className="settings-row-control">
          <Dropdown
            options={PAGE_SIZE_DROPDOWN_OPTIONS}
            value={String(defaultTablePageSize)}
            onChange={handleDefaultTablePageSizeChange}
            ariaLabel="Default page size"
            size="compact"
            className="settings-page-size-dropdown"
          />
        </div>
      </div>

      <div className="settings-subgroup-label">Resources</div>
      <hr className="settings-subgroup-divider" />

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Short resource names</div>
          <div className="settings-row-label-help">
            Display short resource names (e.g., "sts" instead of "StatefulSets").
          </div>
        </div>
        <div className="settings-row-control">
          <ToggleSwitch
            id={`${elementIdPrefix}-short-resource-names`}
            checked={useShortResourceNames}
            onChange={handleShortNamesToggle}
            ariaLabel="Short resource names"
          />
        </div>
      </div>

      <div className="settings-subgroup-label">Sidebar</div>
      <hr className="settings-subgroup-divider" />

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Dim inactive namespaces</div>
          <div className="settings-row-label-help">
            Dim namespaces in the Sidebar that have no Workloads.
          </div>
        </div>
        <div className="settings-row-control">
          <ToggleSwitch
            id={`${elementIdPrefix}-dim-inactive-namespaces`}
            checked={dimInactiveNamespaces}
            onChange={handleDimInactiveNamespacesToggle}
            ariaLabel="Dim inactive namespaces"
          />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Exclusive namespaces</div>
          <div className="settings-row-label-help">
            When enabled, only one namespace at a time can be expanded in the Sidebar. Expanding a
            different namespace will collapse the currently expanded one.
          </div>
        </div>
        <div className="settings-row-control">
          <ToggleSwitch
            id={`${elementIdPrefix}-exclusive-namespaces`}
            checked={exclusiveNamespaces}
            onChange={handleExclusiveNamespacesToggle}
            ariaLabel="Exclusive namespaces"
          />
        </div>
      </div>
    </div>
  );
}

export default DisplaySection;
