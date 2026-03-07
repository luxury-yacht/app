/**
 * frontend/src/ui/modals/create-resource/FormVolumeSourceField.tsx
 *
 * Extracted volume source editor component. Handles source type selection,
 * source value editing, extra fields (optional, defaultMode, type, etc.),
 * and ConfigMap/Secret items lists.
 */

import React from 'react';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { FormCompactNumberInput, parseCompactNumberValue } from './FormCompactNumberInput';
import { FormTriStateBooleanDropdown } from './FormTriStateBooleanDropdown';
import { FormVolumeItemListField } from './FormVolumeItemListField';
import {
  INPUT_BEHAVIOR_PROPS,
  getNestedValue,
  setNestedValue,
  unsetNestedValue,
  fixedWidthStyle,
} from './formUtils';

// ─── Types ──────────────────────────────────────────────────────────────

export type VolumeSourceKey = 'pvc' | 'configMap' | 'secret' | 'hostPath' | 'emptyDir';

interface VolumeSourceDefinition {
  key: VolumeSourceKey;
  label: string;
  valuePath: string[];
  placeholder: string;
}

interface VolumeSourceExtraFieldDefinition {
  key: string;
  label: string;
  path: string[];
  type: 'text' | 'number' | 'select' | 'tri-state-boolean';
  required?: boolean;
  placeholder?: string;
  options?: DropdownOption[];
  defaultValue?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  parseValue?: (rawValue: string) => unknown;
  formatValue?: (value: unknown) => string;
  emptyLabel?: string;
  trueLabel?: string;
  falseLabel?: string;
  /** Fixed CSS width for the input element. */
  inputWidth?: string;
  /** Fixed CSS width for the dropdown wrapper. */
  dropdownWidth?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────

const VOLUME_SOURCE_DEFINITIONS: VolumeSourceDefinition[] = [
  {
    key: 'configMap',
    label: 'ConfigMap',
    valuePath: ['configMap', 'name'],
    placeholder: 'configmap-name',
  },
  {
    key: 'emptyDir',
    label: 'EmptyDir',
    valuePath: ['emptyDir', 'medium'],
    placeholder: 'Memory (optional)',
  },
  {
    key: 'hostPath',
    label: 'Host Path',
    valuePath: ['hostPath', 'path'],
    placeholder: '/data',
  },
  {
    key: 'pvc',
    label: 'PVC',
    valuePath: ['persistentVolumeClaim', 'claimName'],
    placeholder: 'pvc-name',
  },
  {
    key: 'secret',
    label: 'Secret',
    valuePath: ['secret', 'secretName'],
    placeholder: 'secret-name',
  },
];

const VOLUME_SOURCE_ROOT_PATHS: string[][] = [
  ['persistentVolumeClaim'],
  ['configMap'],
  ['secret'],
  ['hostPath'],
  ['emptyDir'],
];

const VOLUME_SOURCE_ROOT_BY_KEY: Record<VolumeSourceKey, string[]> = {
  configMap: ['configMap'],
  emptyDir: ['emptyDir'],
  hostPath: ['hostPath'],
  pvc: ['persistentVolumeClaim'],
  secret: ['secret'],
};

const DEFAULT_VOLUME_SOURCE_KEY: VolumeSourceKey = 'configMap';

const HOST_PATH_TYPE_OPTIONS: DropdownOption[] = [
  { value: '', label: '-----' },
  { value: 'DirectoryOrCreate', label: 'DirectoryOrCreate' },
  { value: 'Directory', label: 'Directory' },
  { value: 'FileOrCreate', label: 'FileOrCreate' },
  { value: 'File', label: 'File' },
  { value: 'Socket', label: 'Socket' },
  { value: 'CharDevice', label: 'CharDevice' },
  { value: 'BlockDevice', label: 'BlockDevice' },
];

const EMPTY_DIR_MEDIUM_OPTIONS: DropdownOption[] = [
  { value: '', label: 'Node Filesystem' },
  { value: 'Memory', label: 'Memory' },
];

const VOLUME_SOURCE_EXTRA_FIELDS: Record<VolumeSourceKey, VolumeSourceExtraFieldDefinition[]> = {
  configMap: [
    {
      key: 'optional',
      label: 'Optional',
      path: ['configMap', 'optional'],
      type: 'tri-state-boolean',
      emptyLabel: '-----',
      trueLabel: 'true',
      falseLabel: 'false',
      dropdownWidth: 'calc(5ch + 40px)',
    },
    {
      key: 'defaultMode',
      label: 'Default Mode',
      path: ['configMap', 'defaultMode'],
      type: 'number',
      placeholder: '420',
      min: 0,
      max: 511,
      integer: true,
      inputWidth: 'calc(3ch + 22px)',
      parseValue: (rawValue: string) => {
        if (rawValue.trim() === '') return '';
        const parsed = Number(rawValue);
        return Number.isInteger(parsed) ? parsed : '';
      },
    },
  ],
  emptyDir: [
    {
      key: 'medium',
      label: 'Medium',
      path: ['emptyDir', 'medium'],
      type: 'select',
      options: EMPTY_DIR_MEDIUM_OPTIONS,
    },
    {
      key: 'sizeLimit',
      label: 'Size Limit',
      path: ['emptyDir', 'sizeLimit'],
      type: 'text',
      placeholder: '1Gi',
    },
  ],
  hostPath: [
    {
      key: 'path',
      label: 'Path',
      path: ['hostPath', 'path'],
      type: 'text',
      placeholder: '/data',
      required: true,
    },
    {
      key: 'type',
      label: 'Type',
      path: ['hostPath', 'type'],
      type: 'select',
      options: HOST_PATH_TYPE_OPTIONS,
    },
  ],
  pvc: [
    {
      key: 'claimName',
      label: 'Claim',
      path: ['persistentVolumeClaim', 'claimName'],
      type: 'text',
      placeholder: 'pvc-name',
      required: true,
    },
    {
      key: 'readOnly',
      label: 'Read Only',
      path: ['persistentVolumeClaim', 'readOnly'],
      type: 'tri-state-boolean',
      emptyLabel: '-----',
      trueLabel: 'true',
      falseLabel: 'false',
    },
  ],
  secret: [
    {
      key: 'secretName',
      label: 'Secret',
      path: ['secret', 'secretName'],
      type: 'text',
      placeholder: 'secret-name',
      required: true,
    },
    {
      key: 'optional',
      label: 'Optional',
      path: ['secret', 'optional'],
      type: 'tri-state-boolean',
      emptyLabel: '-----',
      trueLabel: 'true',
      falseLabel: 'false',
      dropdownWidth: 'calc(5ch + 40px)',
    },
    {
      key: 'defaultMode',
      label: 'Default Mode',
      path: ['secret', 'defaultMode'],
      type: 'number',
      placeholder: '420',
      min: 0,
      max: 511,
      integer: true,
      inputWidth: 'calc(3ch + 22px)',
      parseValue: (rawValue: string) => {
        if (rawValue.trim() === '') return '';
        const parsed = Number(rawValue);
        return Number.isInteger(parsed) ? parsed : '';
      },
    },
  ],
};

// ─── Helper Functions ───────────────────────────────────────────────────

function getVolumeSourceDefinition(key: VolumeSourceKey): VolumeSourceDefinition {
  const definition = VOLUME_SOURCE_DEFINITIONS.find((candidate) => candidate.key === key);
  // Guard against a broken static configuration.
  if (!definition) {
    throw new Error(`Missing volume source definition for key: ${key}`);
  }
  return definition;
}

function clearVolumeSources(item: Record<string, unknown>): Record<string, unknown> {
  let next = item;
  for (const rootPath of VOLUME_SOURCE_ROOT_PATHS) {
    next = unsetNestedValue(next, rootPath);
  }
  return next;
}

function clearOtherVolumeSources(
  item: Record<string, unknown>,
  selectedSourceKey: VolumeSourceKey
): Record<string, unknown> {
  let next = item;
  for (const [sourceKey, rootPath] of Object.entries(VOLUME_SOURCE_ROOT_BY_KEY)) {
    if (sourceKey === selectedSourceKey) continue;
    next = unsetNestedValue(next, rootPath);
  }
  return next;
}

function ensureVolumeSourceRoot(
  item: Record<string, unknown>,
  sourceKey: VolumeSourceKey
): Record<string, unknown> {
  const rootPath = VOLUME_SOURCE_ROOT_BY_KEY[sourceKey];
  const existing = getNestedValue(item, rootPath);
  if (existing != null && typeof existing === 'object' && !Array.isArray(existing)) {
    return item;
  }
  return setNestedValue(item, rootPath, {});
}

/** Detect which volume source type is active for the given item. */
export function getCurrentVolumeSource(
  item: Record<string, unknown>
): VolumeSourceDefinition | undefined {
  const configMap = getNestedValue(item, ['configMap']);
  if (configMap !== undefined) return getVolumeSourceDefinition('configMap');

  const emptyDir = getNestedValue(item, ['emptyDir']);
  if (emptyDir !== undefined) return getVolumeSourceDefinition('emptyDir');

  const hostPath = getNestedValue(item, ['hostPath']);
  if (hostPath !== undefined) return getVolumeSourceDefinition('hostPath');

  const pvc = getNestedValue(item, ['persistentVolumeClaim']);
  if (pvc !== undefined) return getVolumeSourceDefinition('pvc');

  const secret = getNestedValue(item, ['secret']);
  if (secret !== undefined) return getVolumeSourceDefinition('secret');

  return undefined;
}

// ─── Component ──────────────────────────────────────────────────────────

interface FormVolumeSourceFieldProps {
  /** The current volume item data. */
  item: Record<string, unknown>;
  /** All volume items in the array. */
  items: Record<string, unknown>[];
  /** Index of this volume in the items array. */
  itemIndex: number;
  /** Callback to update the entire items array. */
  updateItems: (items: Record<string, unknown>[]) => void;
  /** data-field-key for the wrapper element. */
  dataFieldKey: string;
  /** Accessible label for the source type dropdown. */
  ariaLabel: string;
}

/**
 * Volume source editor. Renders source type dropdown, source value input,
 * extra fields per source type, and ConfigMap/Secret items lists.
 */
export function FormVolumeSourceField({
  item,
  items,
  itemIndex,
  updateItems,
  dataFieldKey,
  ariaLabel,
}: FormVolumeSourceFieldProps): React.ReactElement {
  const currentSource = getCurrentVolumeSource(item);
  const effectiveSource = currentSource ?? getVolumeSourceDefinition(DEFAULT_VOLUME_SOURCE_KEY);
  const isConfigMapSource = effectiveSource.key === 'configMap';
  const isSecretSource = effectiveSource.key === 'secret';
  const sourceKey = effectiveSource.key;
  const sourceValue = String(getNestedValue(item, effectiveSource.valuePath) ?? '');
  const sourceOptions: DropdownOption[] = VOLUME_SOURCE_DEFINITIONS.map((definition) => ({
    value: definition.key,
    label: definition.label,
  }));
  const extraFields = VOLUME_SOURCE_EXTRA_FIELDS[effectiveSource.key] ?? [];
  const visibleExtraFields = isSecretSource
    ? extraFields.filter((extraField) => extraField.key !== 'secretName')
    : extraFields;

  // ConfigMap items list.
  const configMapItems =
    effectiveSource.key === 'configMap' &&
    Array.isArray(getNestedValue(item, ['configMap', 'items']))
      ? (getNestedValue(item, ['configMap', 'items']) as Record<string, unknown>[])
      : [];

  // Secret items list.
  const secretItems =
    effectiveSource.key === 'secret' &&
    Array.isArray(getNestedValue(item, ['secret', 'items']))
      ? (getNestedValue(item, ['secret', 'items']) as Record<string, unknown>[])
      : [];

  // ── Source type change handler ──────────────────────────────────────

  const handleSourceTypeChange = (nextValue: string | string[]) => {
    const selectedKey = Array.isArray(nextValue) ? (nextValue[0] ?? '') : nextValue;
    const selectedDefinition =
      VOLUME_SOURCE_DEFINITIONS.find((definition) => definition.key === selectedKey) ??
      getVolumeSourceDefinition(DEFAULT_VOLUME_SOURCE_KEY);
    if (selectedDefinition.key === sourceKey) {
      return;
    }
    const updatedItems = items.map((currentItem, i) => {
      if (i !== itemIndex) return currentItem;
      const clearedItem = clearVolumeSources(currentItem);
      const withSourceRoot = ensureVolumeSourceRoot(clearedItem, selectedDefinition.key);
      if (selectedDefinition.key === 'hostPath') {
        return setNestedValue(withSourceRoot, ['hostPath', 'path'], '');
      }
      if (selectedDefinition.key === 'pvc') {
        return setNestedValue(withSourceRoot, ['persistentVolumeClaim', 'claimName'], '');
      }
      if (selectedDefinition.key === 'secret') {
        return setNestedValue(withSourceRoot, ['secret', 'secretName'], '');
      }
      return withSourceRoot;
    });
    updateItems(updatedItems);
  };

  // ── Source value change handler ─────────────────────────────────────

  const handleSourceValueChange = (nextValue: string) => {
    const updatedItems = items.map((currentItem, i) => {
      if (i !== itemIndex) return currentItem;
      let nextItem = clearOtherVolumeSources(currentItem, effectiveSource.key);
      nextItem = ensureVolumeSourceRoot(nextItem, effectiveSource.key);
      if (effectiveSource.key === 'emptyDir' && nextValue.trim() === '') {
        return nextItem;
      }
      if (effectiveSource.key === 'secret' && nextValue.trim() === '') {
        return setNestedValue(nextItem, ['secret', 'secretName'], '');
      }
      if (nextValue.trim() === '') {
        return unsetNestedValue(nextItem, effectiveSource.valuePath);
      }
      return setNestedValue(nextItem, effectiveSource.valuePath, nextValue);
    });
    updateItems(updatedItems);
  };

  // ── Extra field change handler ──────────────────────────────────────

  const handleExtraFieldChange = (
    extraField: VolumeSourceExtraFieldDefinition,
    nextValue: unknown
  ) => {
    const updatedItems = items.map((currentItem, i) => {
      if (i !== itemIndex) return currentItem;
      let nextItem = clearOtherVolumeSources(currentItem, effectiveSource.key);
      nextItem = ensureVolumeSourceRoot(nextItem, effectiveSource.key);
      const unsetExtraField = () => {
        if (
          effectiveSource.key === 'hostPath' &&
          extraField.path.join('.') === 'hostPath.path'
        ) {
          return setNestedValue(nextItem, ['hostPath', 'path'], '');
        }
        if (
          effectiveSource.key === 'pvc' &&
          extraField.path.join('.') === 'persistentVolumeClaim.claimName'
        ) {
          return setNestedValue(nextItem, ['persistentVolumeClaim', 'claimName'], '');
        }
        if (
          effectiveSource.key === 'secret' &&
          extraField.path.join('.') === 'secret.secretName'
        ) {
          return setNestedValue(nextItem, ['secret', 'secretName'], '');
        }
        const removed = unsetNestedValue(nextItem, extraField.path);
        return effectiveSource.key === 'emptyDir'
          ? ensureVolumeSourceRoot(removed, 'emptyDir')
          : removed;
      };
      if (nextValue === undefined || nextValue === null) {
        return unsetExtraField();
      }
      if (typeof nextValue === 'string' && nextValue.trim() === '') {
        return unsetExtraField();
      }
      const parsedValue =
        typeof nextValue === 'string' && extraField.parseValue
          ? extraField.parseValue(nextValue)
          : nextValue;
      if (parsedValue === '' || parsedValue === undefined || parsedValue === null) {
        return unsetExtraField();
      }
      return setNestedValue(nextItem, extraField.path, parsedValue);
    });
    updateItems(updatedItems);
  };

  // ── ConfigMap items handlers ────────────────────────────────────────

  const updateConfigMapItems = (newItems: Record<string, unknown>[]) => {
    const updatedItems = items.map((currentItem, i) => {
      if (i !== itemIndex) return currentItem;
      let nextItem = clearOtherVolumeSources(currentItem, 'configMap');
      nextItem = ensureVolumeSourceRoot(nextItem, 'configMap');
      if (newItems.length === 0) {
        return unsetNestedValue(nextItem, ['configMap', 'items']);
      }
      return setNestedValue(nextItem, ['configMap', 'items'], newItems);
    });
    updateItems(updatedItems);
  };

  const handleConfigMapItemChange = (
    rowIndex: number,
    fieldPath: string[],
    newValue: unknown
  ) => {
    const updated = configMapItems.map((entry, index) => {
      if (index !== rowIndex) return entry;
      if (typeof newValue === 'string' && newValue.trim() === '') {
        return unsetNestedValue(entry, fieldPath);
      }
      return setNestedValue(entry, fieldPath, newValue);
    });
    updateConfigMapItems(updated);
  };

  const handleConfigMapAddItem = () => {
    updateConfigMapItems([...configMapItems, {}]);
  };

  const handleConfigMapRemoveItem = (rowIndex: number) => {
    updateConfigMapItems(configMapItems.filter((_, index) => index !== rowIndex));
  };

  // ── Secret items handlers ───────────────────────────────────────────

  const updateSecretItems = (newItems: Record<string, unknown>[]) => {
    const updatedItems = items.map((currentItem, i) => {
      if (i !== itemIndex) return currentItem;
      let nextItem = clearOtherVolumeSources(currentItem, 'secret');
      nextItem = ensureVolumeSourceRoot(nextItem, 'secret');
      if (newItems.length === 0) {
        return unsetNestedValue(nextItem, ['secret', 'items']);
      }
      return setNestedValue(nextItem, ['secret', 'items'], newItems);
    });
    updateItems(updatedItems);
  };

  const handleSecretItemChange = (
    rowIndex: number,
    fieldPath: string[],
    newValue: unknown
  ) => {
    const updated = secretItems.map((entry, index) => {
      if (index !== rowIndex) return entry;
      if (typeof newValue === 'string' && newValue.trim() === '') {
        return unsetNestedValue(entry, fieldPath);
      }
      return setNestedValue(entry, fieldPath, newValue);
    });
    updateSecretItems(updated);
  };

  const handleSecretAddItem = () => {
    updateSecretItems([...secretItems, {}]);
  };

  const handleSecretRemoveItem = (rowIndex: number) => {
    updateSecretItems(secretItems.filter((_, index) => index !== rowIndex));
  };

  // ── Extra field renderer ────────────────────────────────────────────

  const renderExtraField = (extraField: VolumeSourceExtraFieldDefinition) => {
    const rawExtraValue = getNestedValue(item, extraField.path);
    const resolvedExtraValue =
      rawExtraValue === undefined && extraField.defaultValue !== undefined
        ? extraField.defaultValue
        : rawExtraValue;
    const stringExtraValue = extraField.formatValue
      ? extraField.formatValue(resolvedExtraValue)
      : String(resolvedExtraValue ?? '');

    return (
      <div
        key={extraField.key}
        data-field-key={extraField.key}
        className="resource-form-volume-source-extra-field"
      >
        <span className="resource-form-field-label">{extraField.label}</span>
        {extraField.type === 'select' ? (
          <div className="resource-form-volume-source-extra-dropdown" style={fixedWidthStyle(extraField)}>
            <Dropdown
              options={extraField.options ?? []}
              value={stringExtraValue}
              onChange={(nextValue) => {
                const normalized = Array.isArray(nextValue)
                  ? (nextValue[0] ?? '')
                  : nextValue;
                handleExtraFieldChange(extraField, normalized);
              }}
              ariaLabel={extraField.label}
            />
          </div>
        ) : extraField.type === 'tri-state-boolean' ? (
          <FormTriStateBooleanDropdown
            className="resource-form-volume-source-extra-dropdown"
            style={extraField.dropdownWidth ? fixedWidthStyle({ inputWidth: extraField.dropdownWidth }) : undefined}
            value={resolvedExtraValue}
            emptyLabel={extraField.emptyLabel}
            trueLabel={extraField.trueLabel}
            falseLabel={extraField.falseLabel}
            ariaLabel={extraField.label}
            onChange={(nextValue) => handleExtraFieldChange(extraField, nextValue)}
          />
        ) : extraField.type === 'number' ? (
          <FormCompactNumberInput
            dataFieldKey={extraField.key}
            value={stringExtraValue}
            placeholder={extraField.placeholder}
            min={extraField.min}
            max={extraField.max}
            integer={extraField.integer}
            style={fixedWidthStyle(extraField)}
            onChange={(event) => {
              const parsed = parseCompactNumberValue(
                event.target.value,
                {
                  min: extraField.min,
                  max: extraField.max,
                  integer: extraField.integer,
                },
                { allowEmpty: true }
              );
              if (parsed === null) return;
              handleExtraFieldChange(extraField, parsed);
            }}
          />
        ) : (
          <input
            type="text"
            className="resource-form-input"
            style={fixedWidthStyle(extraField)}
            value={stringExtraValue}
            placeholder={extraField.placeholder}
            required={extraField.required === true}
            aria-required={extraField.required === true}
            {...INPUT_BEHAVIOR_PROPS}
            onChange={(e) => handleExtraFieldChange(extraField, e.target.value)}
          />
        )}
      </div>
    );
  };

  // ── JSX ─────────────────────────────────────────────────────────────

  return (
    <div data-field-key={dataFieldKey} className="resource-form-volume-source-group">
      <div className="resource-form-volume-source">
        <div className="resource-form-volume-source-dropdown">
          <Dropdown
            options={sourceOptions}
            value={sourceKey}
            onChange={handleSourceTypeChange}
            ariaLabel={ariaLabel}
          />
        </div>
        {!isConfigMapSource &&
          effectiveSource.key !== 'emptyDir' &&
          effectiveSource.key !== 'hostPath' &&
          effectiveSource.key !== 'pvc' &&
          effectiveSource.key !== 'secret' && (
            <input
              type="text"
              className="resource-form-input"
              value={sourceValue}
              placeholder={effectiveSource.placeholder}
              {...INPUT_BEHAVIOR_PROPS}
              onChange={(e) => handleSourceValueChange(e.target.value)}
            />
          )}
      </div>

      {(isConfigMapSource || isSecretSource) && (
        <div className="resource-form-volume-source-extra resource-form-volume-source-extra--configmap">
          <div
            data-field-key={isConfigMapSource ? 'configMapName' : 'secretName'}
            className="resource-form-volume-source-extra-field"
          >
            <span className="resource-form-field-label">
              {isConfigMapSource ? 'ConfigMap' : 'Secret'}
            </span>
            <input
              type="text"
              className="resource-form-input"
              value={sourceValue}
              placeholder={effectiveSource.placeholder}
              required={isSecretSource}
              aria-required={isSecretSource}
              {...INPUT_BEHAVIOR_PROPS}
              onChange={(e) => handleSourceValueChange(e.target.value)}
            />
          </div>
          {visibleExtraFields.map((extraField) => renderExtraField(extraField))}
        </div>
      )}

      {!isConfigMapSource && !isSecretSource && visibleExtraFields.length > 0 && (
        <div className="resource-form-volume-source-extra">
          {visibleExtraFields.map((extraField) => renderExtraField(extraField))}
        </div>
      )}

      {effectiveSource.key === 'configMap' && (
        <FormVolumeItemListField
          dataFieldKey="configMapItems"
          items={configMapItems}
          onAdd={handleConfigMapAddItem}
          onRemove={handleConfigMapRemoveItem}
          onFieldChange={handleConfigMapItemChange}
        />
      )}

      {effectiveSource.key === 'secret' && (
        <FormVolumeItemListField
          dataFieldKey="secretItems"
          items={secretItems}
          onAdd={handleSecretAddItem}
          onRemove={handleSecretRemoveItem}
          onFieldChange={handleSecretItemChange}
        />
      )}
    </div>
  );
}
