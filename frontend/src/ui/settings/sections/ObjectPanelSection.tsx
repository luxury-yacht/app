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
import { type FC, useId, useMemo, useState } from 'react';

const objectPanelPositionOptions = [
  { value: 'right', label: 'Right', icon: DockRightIcon },
  { value: 'bottom', label: 'Bottom', icon: DockBottomIcon },
  { value: 'floating', label: 'Floating', icon: FloatPanelIcon },
] satisfies Array<{
  value: ObjectPanelPosition;
  label: string;
  icon: FC<{ width?: number; height?: number; fill?: string }>;
}>;

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
  const [panelLayoutInputs, setPanelLayoutInputs] = useState<
    Record<keyof ObjectPanelLayoutDefaults, string>
  >(() => {
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

  const fieldPreferenceKeys: Record<keyof ObjectPanelLayoutDefaults, AppPreferenceKey> = {
    dockedRightWidth: 'objectPanelDockedRightWidth',
    dockedBottomHeight: 'objectPanelDockedBottomHeight',
    floatingWidth: 'objectPanelFloatingWidth',
    floatingHeight: 'objectPanelFloatingHeight',
    floatingX: 'objectPanelFloatingX',
    floatingY: 'objectPanelFloatingY',
  };
  const fieldMetadata = Object.fromEntries(
    Object.entries(fieldPreferenceKeys).map(([field, key]) => [
      field,
      getIntegerPreferenceMetadata(key),
    ])
  ) as Record<keyof ObjectPanelLayoutDefaults, ReturnType<typeof getIntegerPreferenceMetadata>>;

  const handleObjectPanelPositionChange = (position: ObjectPanelPosition) => {
    setObjectPanelPositionState(position);
    setDefaultObjectPanelPosition(position);
  };

  const handlePanelLayoutInput = (field: keyof ObjectPanelLayoutDefaults, raw: string) => {
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

  const handlePanelLayoutBlur = (field: keyof ObjectPanelLayoutDefaults) => {
    setPanelLayoutInputs((prev) => ({ ...prev, [field]: String(panelLayout[field]) }));
  };

  // Warn when configured values exceed the current visible content area.
  const panelLayoutWarning = useMemo(() => {
    const content = getContentBounds();
    const issues: string[] = [];
    const fields = new Set<keyof ObjectPanelLayoutDefaults>();
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

  return (
    <div className="settings-panel">
      <h2 className="settings-panel-title">Object Panel</h2>

      <div className="settings-subgroup-label">Defaults</div>
      <hr className="settings-subgroup-divider" />

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Position</div>
          <div className="settings-row-label-help">
            Where the object detail panel opens by default.
          </div>
        </div>
        <div className="settings-row-control">
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
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Docked size</div>
          <div className="settings-row-label-help">Default dimensions of docked panels.</div>
        </div>
        <div className="settings-row-control">
          <div className="settings-items object-panel-defaults">
            <div className="setting-item setting-item-inline">
              <span className="opd-field-label">Right</span>
              <input
                id={`${elementIdPrefix}-panel-docked-right-width`}
                type="number"
                min={fieldMetadata.dockedRightWidth.min}
                max={fieldMetadata.dockedRightWidth.max}
                className={
                  panelLayoutWarning?.fields.has('dockedRightWidth') ? 'opd-input-warn' : ''
                }
                value={panelLayoutInputs.dockedRightWidth}
                onChange={(e) => handlePanelLayoutInput('dockedRightWidth', e.target.value)}
                onBlur={() => handlePanelLayoutBlur('dockedRightWidth')}
                aria-label="Docked right width"
              />
              <span className="opd-unit-gap">px</span>
              <span className="opd-field-label">Bottom</span>
              <input
                id={`${elementIdPrefix}-panel-docked-bottom-height`}
                type="number"
                min={fieldMetadata.dockedBottomHeight.min}
                max={fieldMetadata.dockedBottomHeight.max}
                className={
                  panelLayoutWarning?.fields.has('dockedBottomHeight') ? 'opd-input-warn' : ''
                }
                value={panelLayoutInputs.dockedBottomHeight}
                onChange={(e) => handlePanelLayoutInput('dockedBottomHeight', e.target.value)}
                onBlur={() => handlePanelLayoutBlur('dockedBottomHeight')}
                aria-label="Docked bottom height"
              />
              <span>px</span>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Floating size</div>
          <div className="settings-row-label-help">Default dimensions of floating panels.</div>
        </div>
        <div className="settings-row-control">
          <div className="settings-items object-panel-defaults">
            <div className="setting-item setting-item-inline">
              <span className="opd-field-label">Width</span>
              <input
                id={`${elementIdPrefix}-panel-floating-width`}
                type="number"
                min={fieldMetadata.floatingWidth.min}
                max={fieldMetadata.floatingWidth.max}
                className={panelLayoutWarning?.fields.has('floatingWidth') ? 'opd-input-warn' : ''}
                value={panelLayoutInputs.floatingWidth}
                onChange={(e) => handlePanelLayoutInput('floatingWidth', e.target.value)}
                onBlur={() => handlePanelLayoutBlur('floatingWidth')}
                aria-label="Floating width"
              />
              <span className="opd-unit-gap">px</span>
              <span className="opd-field-label">Height</span>
              <input
                id={`${elementIdPrefix}-panel-floating-height`}
                type="number"
                min={fieldMetadata.floatingHeight.min}
                max={fieldMetadata.floatingHeight.max}
                className={panelLayoutWarning?.fields.has('floatingHeight') ? 'opd-input-warn' : ''}
                value={panelLayoutInputs.floatingHeight}
                onChange={(e) => handlePanelLayoutInput('floatingHeight', e.target.value)}
                onBlur={() => handlePanelLayoutBlur('floatingHeight')}
                aria-label="Floating height"
              />
              <span>px</span>
            </div>
          </div>
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-row-label">
          <div className="settings-row-label-title">Floating position</div>
          <div className="settings-row-label-help">Default position of floating panels.</div>
        </div>
        <div className="settings-row-control">
          <div className="settings-items object-panel-defaults">
            <div className="setting-item setting-item-inline">
              <span className="opd-field-label">Top</span>
              <input
                id={`${elementIdPrefix}-panel-floating-y`}
                type="number"
                min={fieldMetadata.floatingY.min}
                max={fieldMetadata.floatingY.max}
                className={panelLayoutWarning?.fields.has('floatingY') ? 'opd-input-warn' : ''}
                value={panelLayoutInputs.floatingY}
                onChange={(e) => handlePanelLayoutInput('floatingY', e.target.value)}
                onBlur={() => handlePanelLayoutBlur('floatingY')}
                aria-label="Floating top position"
              />
              <span className="opd-unit-gap">px</span>
              <span className="opd-field-label">Left</span>
              <input
                id={`${elementIdPrefix}-panel-floating-x`}
                type="number"
                min={fieldMetadata.floatingX.min}
                max={fieldMetadata.floatingX.max}
                className={panelLayoutWarning?.fields.has('floatingX') ? 'opd-input-warn' : ''}
                value={panelLayoutInputs.floatingX}
                onChange={(e) => handlePanelLayoutInput('floatingX', e.target.value)}
                onBlur={() => handlePanelLayoutBlur('floatingX')}
                aria-label="Floating left position"
              />
              <span>px</span>
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
        </div>
      </div>
    </div>
  );
}

export default ObjectPanelSection;
