/**
 * frontend/src/ui/settings/sections/DisplaySection.tsx
 *
 * Display tab content: display-related preferences.
 */

import { useState, useEffect } from 'react';
import { errorHandler } from '@utils/errorHandler';
import ToggleSwitch from '@/shared/components/ToggleSwitch';
import {
  hydrateAppPreferences,
  setDimInactiveNamespaces as persistDimInactiveNamespaces,
  setExclusiveNamespaces as persistExclusiveNamespaces,
  setUseShortResourceNames as persistUseShortResourceNames,
} from '@/core/settings/appPreferences';

function DisplaySection() {
  const [useShortResourceNames, setUseShortResourceNames] = useState<boolean>(false);
  const [dimInactiveNamespaces, setDimInactiveNamespaces] = useState<boolean>(true);
  const [exclusiveNamespaces, setExclusiveNamespaces] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await hydrateAppPreferences({ force: true });
        if (!cancelled) {
          setUseShortResourceNames(prefs.useShortResourceNames);
          setDimInactiveNamespaces(prefs.dimInactiveNamespaces);
          setExclusiveNamespaces(prefs.exclusiveNamespaces);
        }
      } catch (error) {
        errorHandler.handle(error, { action: 'loadDisplaySettings' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
            id="short-resource-names"
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
            id="dim-inactive-namespaces"
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
            When enabled, only one namespace at a time can be expanded in the Sidebar.
          </div>
        </div>
        <div className="settings-row-control">
          <ToggleSwitch
            id="exclusive-namespaces"
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
