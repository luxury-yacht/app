/**
 * frontend/src/ui/settings/sections/DisplaySection.tsx
 *
 * Display tab content: short resource names toggle.
 */

import { useState, useEffect } from 'react';
import { errorHandler } from '@utils/errorHandler';
import ToggleSwitch from '@/shared/components/ToggleSwitch';
import {
  hydrateAppPreferences,
  setUseShortResourceNames as persistUseShortResourceNames,
} from '@/core/settings/appPreferences';

function DisplaySection() {
  const [useShortResourceNames, setUseShortResourceNames] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await hydrateAppPreferences({ force: true });
        if (!cancelled) {
          setUseShortResourceNames(prefs.useShortResourceNames);
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
    </div>
  );
}

export default DisplaySection;
