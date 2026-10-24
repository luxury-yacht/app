/**
 * frontend/src/ui/settings/sections/ObjectPanelSection.tsx
 *
 * Object panel tab content: default position and dimensions for the object
 * detail panel.
 */

import {
  type AppPreferenceKey,
  getIntegerPreferenceMetadata,
  normalizeIntegerPreferenceValue,
  type ObjectPanelLayoutDefaults,
  type ObjectPanelPosition,
  setDefaultObjectPanelPosition,
  setObjectPanelLayoutDefaults,
} from '@core/settings/appPreferences';
import { usePreference } from '@core/settings/usePreference';
import {
  DockBottomIcon,
  DockRightIcon,
  FloatPanelIcon,
} from '@shared/components/icons/DockableIcons';
import { useDockablePanelContext } from '@ui/dockable';
import { getContentBounds } from '@ui/dockable/dockablePanelLayout';
import React, { type FC, useId, useMemo, useState } from 'react';
import { SettingRow, SettingsChoiceButtons } from './SettingsControls';

const objectPanelPositionOptions = [
  { value: 'right', label: 'Right', icon: DockRightIcon },
  { value: 'bottom', label: 'Bottom', icon: DockBottomIcon },
  { value: 'floating', label: 'Floating', icon: FloatPanelIcon },
] satisfies Array<{
  value: ObjectPanelPosition;
  label: string;
  icon: FC<{ width?: number; height?: number; fill?: string }>;
}>;

type LayoutField = 'dockedRightWidth' | 'dockedBottomHeight' | 'floatingWidth' | 'floatingHeight';

const fieldPreferenceKeys = {
  dockedRightWidth: 'objectPanelDockedRightWidth',
  dockedBottomHeight: 'objectPanelDockedBottomHeight',
  floatingWidth: 'objectPanelFloatingWidth',
  floatingHeight: 'objectPanelFloatingHeight',
} as const satisfies Record<LayoutField, AppPreferenceKey>;

// Each layout row is a pair of bounded pixel inputs.
const layoutRows: Array<{
  title: string;
  help: string;
  fields: Array<{ field: LayoutField; label: string; aria: string; idSuffix: string }>;
}> = [
  {
    title: 'Docked size',
    help: 'Default dimensions of docked panels.',
    fields: [
      {
        field: 'dockedRightWidth',
        label: 'Right',
        aria: 'Docked right width',
        idSuffix: 'panel-docked-right-width',
      },
      {
        field: 'dockedBottomHeight',
        label: 'Bottom',
        aria: 'Docked bottom height',
        idSuffix: 'panel-docked-bottom-height',
      },
    ],
  },
  {
    title: 'Floating size',
    help: 'Default dimensions of floating panel windows.',
    fields: [
      {
        field: 'floatingWidth',
        label: 'Width',
        aria: 'Floating width',
        idSuffix: 'panel-floating-width',
      },
      {
        field: 'floatingHeight',
        label: 'Height',
        aria: 'Floating height',
        idSuffix: 'panel-floating-height',
      },
    ],
  },
];

function ObjectPanelSection() {
  const elementIdPrefix = useId();
  const { applyLayoutDefaultsAcrossClusters } = useDockablePanelContext();
  const objectPanelPosition = usePreference('defaultObjectPanelPosition');
  const dockedRightWidth = usePreference(fieldPreferenceKeys.dockedRightWidth);
  const dockedBottomHeight = usePreference(fieldPreferenceKeys.dockedBottomHeight);
  const floatingWidth = usePreference(fieldPreferenceKeys.floatingWidth);
  const floatingHeight = usePreference(fieldPreferenceKeys.floatingHeight);
  const panelLayout = useMemo<ObjectPanelLayoutDefaults>(
    () => ({ dockedRightWidth, dockedBottomHeight, floatingWidth, floatingHeight }),
    [dockedRightWidth, dockedBottomHeight, floatingWidth, floatingHeight]
  );

  // Raw text per field while the user types, so clearing a field doesn't snap it
  // back; the saved value (including a rollback) shows once the field is left.
  const [layoutDrafts, setLayoutDrafts] = useState<Partial<Record<LayoutField, string>>>({});

  const handlePanelLayoutInput = (field: LayoutField, raw: string) => {
    setLayoutDrafts((prev) => ({ ...prev, [field]: raw }));
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
      const clamped = normalizeIntegerPreferenceValue(fieldPreferenceKeys[field], parsed);
      setObjectPanelLayoutDefaults({ ...panelLayout, [field]: clamped });
      applyLayoutDefaultsAcrossClusters();
    }
  };

  const handlePanelLayoutBlur = (field: LayoutField) => {
    setLayoutDrafts((prev) => ({ ...prev, [field]: undefined }));
  };

  // Warn when configured values exceed the current visible content area.
  const panelLayoutWarning = useMemo(() => {
    const content = getContentBounds();
    const issues: string[] = [];
    const fields = new Set<LayoutField>();
    if (panelLayout.dockedRightWidth > content.width) {
      issues.push('docked width exceeds content area');
      fields.add('dockedRightWidth');
    }
    if (panelLayout.dockedBottomHeight > content.height) {
      issues.push('docked height exceeds content area');
      fields.add('dockedBottomHeight');
    }
    return issues.length > 0 ? { issues, fields } : null;
  }, [panelLayout]);

  const renderLayoutInput = (
    { field, label, aria, idSuffix }: (typeof layoutRows)[number]['fields'][number],
    isFirst: boolean
  ) => {
    const metadata = getIntegerPreferenceMetadata(fieldPreferenceKeys[field]);
    return (
      <React.Fragment key={field}>
        <span className="opd-field-label">{label}</span>
        <input
          id={`${elementIdPrefix}-${idSuffix}`}
          type="number"
          min={metadata.min}
          max={metadata.max}
          className={panelLayoutWarning?.fields.has(field) ? 'opd-input-warn' : ''}
          value={layoutDrafts[field] ?? String(panelLayout[field])}
          onChange={(e) => handlePanelLayoutInput(field, e.target.value)}
          onBlur={() => handlePanelLayoutBlur(field)}
          aria-label={aria}
        />
        {isFirst ? <span className="opd-unit-gap">px</span> : <span>px</span>}
      </React.Fragment>
    );
  };

  return (
    <div className="settings-panel">
      <h2 className="settings-panel-title">Object Panel</h2>

      <div className="settings-subgroup-label">Defaults</div>
      <hr className="settings-subgroup-divider" />

      <SettingRow title="Position" help="Where the object detail panel opens by default.">
        <SettingsChoiceButtons
          ariaLabel="Default Object Panel position"
          value={objectPanelPosition}
          options={objectPanelPositionOptions}
          onChange={setDefaultObjectPanelPosition}
        />
      </SettingRow>

      {layoutRows.map((row) => (
        <SettingRow key={row.title} title={row.title} help={row.help}>
          <div className="settings-items object-panel-defaults">
            <div className="setting-item setting-item-inline">
              {row.fields.map((field, index) => renderLayoutInput(field, index === 0))}
            </div>
            {panelLayoutWarning && (
              <div className="setting-item opd-warning">
                <p>One or more values will be adjusted to fit at render time:</p>
                <ul>
                  {panelLayoutWarning.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </SettingRow>
      ))}
    </div>
  );
}

export default ObjectPanelSection;
