/**
 * frontend/src/ui/settings/sections/ObjectPanelSection.tsx
 *
 * Object panel tab content: default position and dimensions for the object
 * detail panel.
 */

import {
  type AppPreferenceKey,
  getDefaultObjectPanelPosition,
  getIntegerPreferenceMetadata,
  getObjectPanelLayoutDefaults,
  normalizeIntegerPreferenceValue,
  type ObjectPanelLayoutDefaults,
  type ObjectPanelPosition,
  setDefaultObjectPanelPosition,
  setObjectPanelLayoutDefaults,
} from '@core/settings/appPreferences';
import {
  DockBottomIcon,
  DockRightIcon,
  FloatPanelIcon,
} from '@shared/components/icons/DockableIcons';
import { useDockablePanelContext } from '@ui/dockable';
import { getContentBounds } from '@ui/dockable/dockablePanelLayout';
import React, { type FC, useId, useMemo, useState } from 'react';
import { SettingRow } from './SettingsControls';

const objectPanelPositionOptions = [
  { value: 'right', label: 'Right', icon: DockRightIcon },
  { value: 'bottom', label: 'Bottom', icon: DockBottomIcon },
  { value: 'floating', label: 'Floating', icon: FloatPanelIcon },
] satisfies Array<{
  value: ObjectPanelPosition;
  label: string;
  icon: FC<{ width?: number; height?: number; fill?: string }>;
}>;

type LayoutField = keyof ObjectPanelLayoutDefaults;

const fieldPreferenceKeys: Record<LayoutField, AppPreferenceKey> = {
  dockedRightWidth: 'objectPanelDockedRightWidth',
  dockedBottomHeight: 'objectPanelDockedBottomHeight',
  floatingWidth: 'objectPanelFloatingWidth',
  floatingHeight: 'objectPanelFloatingHeight',
  floatingX: 'objectPanelFloatingX',
  floatingY: 'objectPanelFloatingY',
};

// The three layout rows, each a pair of bounded pixel inputs.
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
    help: 'Default dimensions of floating panels.',
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
  {
    title: 'Floating position',
    help: 'Default position of floating panels.',
    fields: [
      {
        field: 'floatingY',
        label: 'Top',
        aria: 'Floating top position',
        idSuffix: 'panel-floating-y',
      },
      {
        field: 'floatingX',
        label: 'Left',
        aria: 'Floating left position',
        idSuffix: 'panel-floating-x',
      },
    ],
  },
];

function ObjectPanelSection() {
  const elementIdPrefix = useId();
  const { applyLayoutDefaultsAcrossClusters } = useDockablePanelContext();
  const [objectPanelPosition, setObjectPanelPositionState] = useState<ObjectPanelPosition>(() =>
    getDefaultObjectPanelPosition()
  );
  const [panelLayout, setPanelLayout] = useState<ObjectPanelLayoutDefaults>(() =>
    getObjectPanelLayoutDefaults()
  );

  // Track raw input strings so users can freely backspace/clear without
  // values snapping back to 0 on every keystroke.
  const [panelLayoutInputs, setPanelLayoutInputs] = useState<Record<LayoutField, string>>(() => {
    const defaults = getObjectPanelLayoutDefaults();
    return {
      dockedRightWidth: String(defaults.dockedRightWidth),
      dockedBottomHeight: String(defaults.dockedBottomHeight),
      floatingWidth: String(defaults.floatingWidth),
      floatingHeight: String(defaults.floatingHeight),
      floatingX: String(defaults.floatingX),
      floatingY: String(defaults.floatingY),
    };
  });

  const handleObjectPanelPositionChange = (position: ObjectPanelPosition) => {
    setObjectPanelPositionState(position);
    setDefaultObjectPanelPosition(position);
  };

  const handlePanelLayoutInput = (field: LayoutField, raw: string) => {
    setPanelLayoutInputs((prev) => ({ ...prev, [field]: raw }));
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
      const clamped = normalizeIntegerPreferenceValue(fieldPreferenceKeys[field], parsed, {
        defaultOnNonPositive: true,
      });
      const updated = { ...panelLayout, [field]: clamped };
      setPanelLayout(updated);
      setObjectPanelLayoutDefaults(updated);
      applyLayoutDefaultsAcrossClusters();
    }
  };

  const handlePanelLayoutBlur = (field: LayoutField) => {
    setPanelLayoutInputs((prev) => ({ ...prev, [field]: String(panelLayout[field]) }));
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
    if (panelLayout.floatingWidth > content.width) {
      issues.push('floating width exceeds content area');
      fields.add('floatingWidth');
    }
    if (panelLayout.floatingHeight > content.height) {
      issues.push('floating height exceeds content area');
      fields.add('floatingHeight');
    }
    if (panelLayout.floatingX + panelLayout.floatingWidth > content.width) {
      issues.push('floating panel extends beyond right edge');
      fields.add('floatingX');
      fields.add('floatingWidth');
    }
    if (panelLayout.floatingY + panelLayout.floatingHeight > content.height) {
      issues.push('floating panel extends beyond bottom edge');
      fields.add('floatingY');
      fields.add('floatingHeight');
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
          value={panelLayoutInputs[field]}
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
        <fieldset className="settings-choice-buttons" aria-label="Default Object Panel position">
          {objectPanelPositionOptions.map((option) => {
            const Icon = option.icon;
            const isSelected = objectPanelPosition === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`settings-choice-button${isSelected ? ' settings-choice-button--active' : ''}`}
                aria-pressed={isSelected}
                onClick={() => handleObjectPanelPositionChange(option.value)}
              >
                <Icon width={18} height={18} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </fieldset>
      </SettingRow>

      {layoutRows.map((row) => (
        <SettingRow key={row.title} title={row.title} help={row.help}>
          <div className="settings-items object-panel-defaults">
            <div className="setting-item setting-item-inline">
              {row.fields.map((field, index) => renderLayoutInput(field, index === 0))}
            </div>
            {row.title === 'Floating position' && panelLayoutWarning && (
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
