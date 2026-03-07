import React from 'react';
import { FormCompactNumberInput, parseCompactNumberValue } from './FormCompactNumberInput';
import { FormNestedListField } from './FormNestedListField';
import { INPUT_BEHAVIOR_PROPS, getNestedValue } from './formUtils';

/** Inline style for the 3-character mode input. */
const MODE_INPUT_STYLE: React.CSSProperties = {
  flex: '0 0 auto',
  width: 'calc(3ch + 22px)',
  minWidth: 'calc(3ch + 22px)',
  maxWidth: 'calc(3ch + 22px)',
};

interface FormVolumeItemListFieldProps {
  /** Unique data-field-key for the list (e.g., 'configMapItems', 'secretItems'). */
  dataFieldKey: string;
  /** Current list of key/path/mode items. */
  items: Record<string, unknown>[];
  /** Called when a new empty item should be appended. */
  onAdd: () => void;
  /** Called when an item at the given index should be removed. */
  onRemove: (index: number) => void;
  /** Called when a field value changes within a specific row. */
  onFieldChange: (rowIndex: number, fieldPath: string[], value: unknown) => void;
}

/**
 * Shared key/path/mode list editor used by both ConfigMap and Secret volume sources.
 * Renders a FormNestedListField with Key, Path, and Mode columns.
 */
export function FormVolumeItemListField({
  dataFieldKey,
  items,
  onAdd,
  onRemove,
  onFieldChange,
}: FormVolumeItemListFieldProps): React.ReactElement {
  return (
    <FormNestedListField
      dataFieldKey={dataFieldKey}
      items={items}
      addLabel="Add item"
      removeLabel="Remove Items"
      onAdd={onAdd}
      onRemove={onRemove}
      leftAlignEmptyStateActions
      addGhostText="Add item"
      fieldGap="wide"
      renderFields={(entry, rowIndex) => {
        const itemKey = String(getNestedValue(entry, ['key']) ?? '');
        const itemPath = String(getNestedValue(entry, ['path']) ?? '');
        const itemMode = String(getNestedValue(entry, ['mode']) ?? '');

        return (
          <>
            <div className="resource-form-nested-group-field">
              <label className="resource-form-field-label">Key</label>
              <input
                type="text"
                className="resource-form-input"
                value={itemKey}
                placeholder="key"
                {...INPUT_BEHAVIOR_PROPS}
                onChange={(e) => onFieldChange(rowIndex, ['key'], e.target.value)}
              />
            </div>
            <div className="resource-form-nested-group-field">
              <label className="resource-form-field-label">Path</label>
              <input
                type="text"
                className="resource-form-input"
                value={itemPath}
                placeholder="path"
                {...INPUT_BEHAVIOR_PROPS}
                onChange={(e) => onFieldChange(rowIndex, ['path'], e.target.value)}
              />
            </div>
            <div className="resource-form-nested-group-field">
              <label className="resource-form-field-label">Mode</label>
              <FormCompactNumberInput
                dataFieldKey={`${dataFieldKey}Mode`}
                value={itemMode}
                placeholder="420"
                min={0}
                max={511}
                integer
                style={MODE_INPUT_STYLE}
                onChange={(e) => {
                  const parsed = parseCompactNumberValue(
                    e.target.value,
                    { min: 0, max: 511, integer: true },
                    { allowEmpty: true }
                  );
                  if (parsed === null) return;
                  onFieldChange(rowIndex, ['mode'], parsed);
                }}
              />
            </div>
          </>
        );
      }}
    />
  );
}
