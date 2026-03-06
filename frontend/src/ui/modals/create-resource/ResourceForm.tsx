/**
 * frontend/src/ui/modals/create-resource/ResourceForm.tsx
 *
 * Generic form renderer component that reads a ResourceFormDefinition
 * and renders form inputs. The component reads values from YAML via
 * getFieldValue and writes changes via setFieldValue.
 */

import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import * as YAML from 'yaml';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { getFieldValue, setFieldValue } from './yamlSync';
import type { ResourceFormDefinition, FormFieldDefinition } from './formDefinitions';
import { FormEmptyActionRow, FormGhostAddText, FormIconActionButton } from './FormActionPrimitives';
import './ResourceForm.css';

interface ResourceFormProps {
  /** Declarative form definition describing sections and fields. */
  definition: ResourceFormDefinition;
  /** Current YAML content (source of truth). */
  yamlContent: string;
  /** Callback invoked with updated YAML when a field value changes. */
  onYamlChange: (yaml: string) => void;
}

/**
 * Check whether the given YAML string has parse errors.
 * Returns true if the YAML is syntactically valid, false otherwise.
 */
function isYamlValid(yamlContent: string): boolean {
  try {
    const doc = YAML.parseDocument(yamlContent);
    return doc.errors.length === 0;
  } catch {
    return false;
  }
}

/**
 * Get a nested value from a plain JS object using a path array.
 * Used for reading sub-field values from group-list items.
 */
function getNestedValue(obj: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = obj;
  for (const segment of path) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Set a nested value in a plain JS object using a path array.
 * Returns a shallow-cloned copy with the value set. Used for
 * updating sub-field values within group-list items.
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown
): Record<string, unknown> {
  if (path.length === 0) return obj;
  const clone = { ...obj };
  if (path.length === 1) {
    clone[path[0]] = value;
    return clone;
  }
  // Recursively clone and set nested objects.
  const child = (clone[path[0]] ?? {}) as Record<string, unknown>;
  clone[path[0]] = setNestedValue(child, path.slice(1), value);
  return clone;
}

/**
 * Remove a nested key from a plain JS object using a path array.
 * If an intermediate object becomes empty after removal, it is pruned.
 */
function unsetNestedValue(obj: Record<string, unknown>, path: string[]): Record<string, unknown> {
  if (path.length === 0) return obj;
  const clone = { ...obj };
  const [head, ...tail] = path;
  if (tail.length === 0) {
    delete clone[head];
    return clone;
  }

  const child = clone[head];
  if (child == null || typeof child !== 'object' || Array.isArray(child)) {
    return clone;
  }

  const nextChild = unsetNestedValue(child as Record<string, unknown>, tail);
  if (Object.keys(nextChild).length === 0) {
    delete clone[head];
  } else {
    clone[head] = nextChild;
  }
  return clone;
}

/**
 * Decide whether an empty value should be omitted from YAML for this field.
 */
function shouldOmitEmptyValue(field: FormFieldDefinition, value: unknown): boolean {
  return field.omitIfEmpty === true && typeof value === 'string' && value.trim() === '';
}

/**
 * Build standard dropdown options for select fields.
 * Includes an explicit empty option so users can clear a selection.
 */
function buildSelectOptions(field: FormFieldDefinition): DropdownOption[] {
  const includeEmptyOption = field.key !== 'protocol';
  return [
    ...(includeEmptyOption ? [{ value: '', label: '-- Select --' }] : []),
    ...(field.options?.map((opt) => ({
      value: opt.value,
      label: opt.label,
    })) ?? []),
  ];
}

/**
 * Normalize select value for fields that have implicit defaults.
 */
function getSelectFieldValue(field: FormFieldDefinition, currentValue: string): string {
  if (field.key === 'protocol' && currentValue === '') {
    return 'TCP';
  }
  return currentValue;
}

type VolumeSourceKey = 'pvc' | 'configMap' | 'secret' | 'hostPath' | 'emptyDir';

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
  type: 'text' | 'number' | 'select';
  placeholder?: string;
  options?: DropdownOption[];
  defaultValue?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  parseValue?: (rawValue: string) => unknown;
  formatValue?: (value: unknown) => string;
}

const VOLUME_SOURCE_DEFINITIONS: VolumeSourceDefinition[] = [
  {
    key: 'configMap',
    label: 'ConfigMap',
    valuePath: ['configMap', 'name'],
    placeholder: 'my-configmap',
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
    placeholder: 'my-pvc',
  },
  {
    key: 'secret',
    label: 'Secret',
    valuePath: ['secret', 'secretName'],
    placeholder: 'my-secret',
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

const BOOLEAN_FIELD_OPTIONS: DropdownOption[] = [
  { value: '', label: '-- Select --' },
  { value: 'true', label: 'True' },
  { value: 'false', label: 'False' },
];

const OPTIONAL_BOOLEAN_FIELD_OPTIONS: DropdownOption[] = [
  { value: '', label: '-----' },
  { value: 'true', label: 'true' },
  { value: 'false', label: 'false' },
];

const HOST_PATH_TYPE_OPTIONS: DropdownOption[] = [
  { value: '', label: '-- Select --' },
  { value: 'DirectoryOrCreate', label: 'DirectoryOrCreate' },
  { value: 'Directory', label: 'Directory' },
  { value: 'FileOrCreate', label: 'FileOrCreate' },
  { value: 'File', label: 'File' },
  { value: 'Socket', label: 'Socket' },
  { value: 'CharDevice', label: 'CharDevice' },
  { value: 'BlockDevice', label: 'BlockDevice' },
];

const parseBooleanFieldValue = (rawValue: string): unknown => {
  if (rawValue === 'true') return true;
  if (rawValue === 'false') return false;
  return '';
};

const formatBooleanFieldValue = (value: unknown): string => {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return '';
};

const VOLUME_SOURCE_EXTRA_FIELDS: Record<VolumeSourceKey, VolumeSourceExtraFieldDefinition[]> = {
  configMap: [
    {
      key: 'optional',
      label: 'Optional',
      path: ['configMap', 'optional'],
      type: 'select',
      options: OPTIONAL_BOOLEAN_FIELD_OPTIONS,
      parseValue: parseBooleanFieldValue,
      formatValue: formatBooleanFieldValue,
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
      parseValue: (rawValue: string) => {
        if (rawValue.trim() === '') return '';
        const parsed = Number(rawValue);
        return Number.isInteger(parsed) ? parsed : '';
      },
    },
  ],
  emptyDir: [
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
      key: 'type',
      label: 'Type',
      path: ['hostPath', 'type'],
      type: 'select',
      options: HOST_PATH_TYPE_OPTIONS,
    },
  ],
  pvc: [
    {
      key: 'readOnly',
      label: 'Read Only',
      path: ['persistentVolumeClaim', 'readOnly'],
      type: 'select',
      options: BOOLEAN_FIELD_OPTIONS,
      parseValue: parseBooleanFieldValue,
      formatValue: formatBooleanFieldValue,
    },
  ],
  secret: [
    {
      key: 'optional',
      label: 'Optional',
      path: ['secret', 'optional'],
      type: 'select',
      options: OPTIONAL_BOOLEAN_FIELD_OPTIONS,
      parseValue: parseBooleanFieldValue,
      formatValue: formatBooleanFieldValue,
    },
  ],
};

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

function getCurrentVolumeSource(item: Record<string, unknown>): VolumeSourceDefinition | undefined {
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

// Disable browser text assistance across form fields.
const INPUT_BEHAVIOR_PROPS = {
  autoCapitalize: 'off' as const,
  autoCorrect: 'off' as const,
  autoComplete: 'off' as const,
  spellCheck: false,
};

// ─── Field Components ───────────────────────────────────────────────────

/**
 * Text input field component. Uses a native change event listener via ref
 * to ensure compatibility with both React synthetic events and direct DOM
 * manipulation (e.g. in test environments).
 */
function TextField({
  field,
  yamlContent,
  onYamlChange,
}: {
  field: FormFieldDefinition;
  yamlContent: string;
  onYamlChange: (yaml: string) => void;
}): React.ReactElement {
  const value = getFieldValue(yamlContent, field.path);
  const stringValue = value != null ? String(value) : '';

  // Keep latest callback and yaml in refs so the native listener always
  // uses the current values without needing to re-attach.
  const yamlRef = useRef(yamlContent);
  const onChangeRef = useRef(onYamlChange);
  const pathRef = useRef(field.path);
  yamlRef.current = yamlContent;
  onChangeRef.current = onYamlChange;
  pathRef.current = field.path;

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const updated = setFieldValue(yamlRef.current, pathRef.current, target.value);
      if (updated !== null) onChangeRef.current(updated);
    };
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      className="resource-form-input"
      data-field-key={field.key}
      defaultValue={stringValue}
      placeholder={field.placeholder}
      {...INPUT_BEHAVIOR_PROPS}
    />
  );
}

/**
 * Number input field component.
 */
function NumberField({
  field,
  yamlContent,
  onYamlChange,
}: {
  field: FormFieldDefinition;
  yamlContent: string;
  onYamlChange: (yaml: string) => void;
}): React.ReactElement {
  const value = getFieldValue(yamlContent, field.path);
  const stringValue = value != null ? String(value) : '';

  const yamlRef = useRef(yamlContent);
  const onChangeRef = useRef(onYamlChange);
  const pathRef = useRef(field.path);
  const minRef = useRef(field.min);
  const maxRef = useRef(field.max);
  const integerRef = useRef(field.integer);
  yamlRef.current = yamlContent;
  onChangeRef.current = onYamlChange;
  pathRef.current = field.path;
  minRef.current = field.min;
  maxRef.current = field.max;
  integerRef.current = field.integer;

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handleInput = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const min = minRef.current;
      const max = maxRef.current;
      const integerOnly = !!integerRef.current;

      // Keep bounded integer fields constrained while typing.
      if (!integerOnly) return;
      if (target.value === '') return;

      const digitsOnly = target.value.replace(/[^\d-]/g, '');
      const normalized =
        typeof min === 'number' && min >= 0 ? digitsOnly.replace(/-/g, '') : digitsOnly;

      if (normalized === '' || normalized === '-') {
        target.value = '';
        return;
      }
      const maxDigits =
        typeof max === 'number' && Number.isInteger(max) && max >= 0
          ? String(max).length
          : undefined;
      target.value =
        typeof maxDigits === 'number' && normalized.length > maxDigits
          ? normalized.slice(0, maxDigits)
          : normalized;
    };

    const handler = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const raw = target.value;
      const min = minRef.current;
      const max = maxRef.current;
      const hasBounds = typeof min === 'number' || typeof max === 'number';
      const integerOnly = !!integerRef.current;
      const restorePreviousValue = () => {
        const previous = getFieldValue(yamlRef.current, pathRef.current);
        target.value = previous != null ? String(previous) : '';
      };

      if (hasBounds && raw.trim() === '') {
        restorePreviousValue();
        return;
      }

      const num = Number(raw);
      if (hasBounds) {
        if (Number.isNaN(num)) {
          restorePreviousValue();
          return;
        }
        if (integerOnly && !Number.isInteger(num)) {
          restorePreviousValue();
          return;
        }
        if ((typeof min === 'number' && num < min) || (typeof max === 'number' && num > max)) {
          restorePreviousValue();
          return;
        }
      }

      const parsed = raw === '' ? '' : isNaN(num) ? raw : num;
      const updated = setFieldValue(yamlRef.current, pathRef.current, parsed);
      if (updated !== null) onChangeRef.current(updated);
    };
    el.addEventListener('input', handleInput);
    el.addEventListener('change', handler);
    return () => {
      el.removeEventListener('input', handleInput);
      el.removeEventListener('change', handler);
    };
  }, []);

  return (
    <input
      ref={inputRef}
      type="number"
      className="resource-form-input"
      data-field-key={field.key}
      defaultValue={stringValue}
      placeholder={field.placeholder}
      min={field.min}
      max={field.max}
      step={field.integer ? 1 : undefined}
      {...INPUT_BEHAVIOR_PROPS}
    />
  );
}

/**
 * Select (dropdown) field component.
 */
function SelectField({
  field,
  yamlContent,
  onYamlChange,
}: {
  field: FormFieldDefinition;
  yamlContent: string;
  onYamlChange: (yaml: string) => void;
}): React.ReactElement {
  const value = getFieldValue(yamlContent, field.path);
  const stringValue = value != null ? String(value) : '';
  const effectiveValue = getSelectFieldValue(field, stringValue);
  const options = useMemo(() => buildSelectOptions(field), [field]);

  return (
    <div data-field-key={field.key} className="resource-form-dropdown">
      <Dropdown
        options={options}
        value={effectiveValue}
        onChange={(nextValue) => {
          const normalized = Array.isArray(nextValue) ? (nextValue[0] ?? '') : nextValue;
          const updated = setFieldValue(yamlContent, field.path, normalized);
          if (updated !== null) onYamlChange(updated);
        }}
        ariaLabel={field.label}
      />
    </div>
  );
}

/**
 * Textarea field component.
 */
function TextareaField({
  field,
  yamlContent,
  onYamlChange,
}: {
  field: FormFieldDefinition;
  yamlContent: string;
  onYamlChange: (yaml: string) => void;
}): React.ReactElement {
  const value = getFieldValue(yamlContent, field.path);
  const stringValue = value != null ? String(value) : '';

  const yamlRef = useRef(yamlContent);
  const onChangeRef = useRef(onYamlChange);
  const pathRef = useRef(field.path);
  yamlRef.current = yamlContent;
  onChangeRef.current = onYamlChange;
  pathRef.current = field.path;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLTextAreaElement;
      const updated = setFieldValue(yamlRef.current, pathRef.current, target.value);
      if (updated !== null) onChangeRef.current(updated);
    };
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, []);

  return (
    <textarea
      ref={textareaRef}
      className="resource-form-textarea"
      data-field-key={field.key}
      defaultValue={stringValue}
      placeholder={field.placeholder}
      {...INPUT_BEHAVIOR_PROPS}
    />
  );
}

/**
 * Key-value list field component. Reads the current value as an object
 * from YAML and renders rows of key/value input pairs.
 */
function KeyValueListField({
  field,
  yamlContent,
  onYamlChange,
}: {
  field: FormFieldDefinition;
  yamlContent: string;
  onYamlChange: (yaml: string) => void;
}): React.ReactElement {
  const rawValue = getFieldValue(yamlContent, field.path);
  const terminalPath = field.path[field.path.length - 1];
  const pathKey = field.path.join('.');
  const showInlineKeyValueLabels = terminalPath === 'labels' || terminalPath === 'annotations';
  const leftAlignEmptyStateActions = terminalPath === 'labels' || terminalPath === 'annotations';

  // Convert the object to an array of [key, value] pairs for rendering.
  const entriesFromYaml: [string, string][] = useMemo(() => {
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      return Object.entries(rawValue as Record<string, unknown>).map(([k, v]) => [
        k,
        String(v ?? ''),
      ]);
    }
    return [];
  }, [rawValue]);
  const [draftEntries, setDraftEntries] = useState<[string, string][]>(entriesFromYaml);
  const lastSyncKeyRef = useRef(`${pathKey}|${yamlContent}`);

  /**
   * Build the persisted YAML map from editable rows.
   * Empty keys are skipped so partial rows do not leak into YAML.
   */
  const toPersistedMap = useCallback((rows: [string, string][]): Record<string, string> => {
    const obj: Record<string, string> = {};
    for (const [k, v] of rows) {
      if (k) obj[k] = v;
    }
    return obj;
  }, []);

  /**
   * Compare persisted key-value maps so draft-only rows (blank keys) can
   * survive parent YAML resync when effective YAML data has not changed.
   */
  const arePersistedMapsEqual = useCallback(
    (leftRows: [string, string][], rightRows: [string, string][]): boolean => {
      const left = toPersistedMap(leftRows);
      const right = toPersistedMap(rightRows);
      const leftKeys = Object.keys(left);
      const rightKeys = Object.keys(right);
      if (leftKeys.length !== rightKeys.length) return false;
      for (const key of leftKeys) {
        if (right[key] !== left[key]) return false;
      }
      return true;
    },
    [toPersistedMap]
  );

  /**
   * Resync draft rows only when the upstream YAML/path changes.
   * Internal edits should not be overwritten until parent state updates.
   */
  useEffect(() => {
    const syncKey = `${pathKey}|${yamlContent}`;
    if (syncKey === lastSyncKeyRef.current) return;
    lastSyncKeyRef.current = syncKey;
    setDraftEntries((previousDraft) => {
      if (arePersistedMapsEqual(previousDraft, entriesFromYaml)) {
        return previousDraft;
      }
      return entriesFromYaml;
    });
  }, [arePersistedMapsEqual, entriesFromYaml, pathKey, yamlContent]);

  /**
   * Resolve the add-button label for key-value lists.
   * Labels and annotations use explicit wording; other maps stay generic.
   */
  const addButtonLabel = useMemo(() => {
    if (terminalPath === 'labels') return 'Add Label';
    if (terminalPath === 'annotations') return 'Add Annotation';
    return 'Add Entry';
  }, [terminalPath]);
  const addGhostText = useMemo(() => {
    if (terminalPath === 'labels') return 'Add label';
    if (terminalPath === 'annotations') return 'Add annotation';
    return null;
  }, [terminalPath]);
  const removeButtonLabel = useMemo(
    () => addButtonLabel.replace(/^Add\b/, 'Remove'),
    [addButtonLabel]
  );

  /** Persist rows to local draft state and YAML. */
  const updateEntries = useCallback(
    (newEntries: [string, string][]) => {
      setDraftEntries(newEntries);
      const updated = setFieldValue(yamlContent, field.path, toPersistedMap(newEntries));
      if (updated !== null) onYamlChange(updated);
    },
    [yamlContent, field.path, onYamlChange, toPersistedMap]
  );

  /** Handle key change for a specific row. */
  const handleKeyChange = (index: number, newKey: string) => {
    const newEntries = draftEntries.map((entry, i) =>
      i === index ? ([newKey, entry[1]] as [string, string]) : entry
    );
    updateEntries(newEntries);
  };

  /** Handle value change for a specific row. */
  const handleValueChange = (index: number, newValue: string) => {
    const newEntries = draftEntries.map((entry, i) =>
      i === index ? ([entry[0], newValue] as [string, string]) : entry
    );
    updateEntries(newEntries);
  };

  /** Remove a row. */
  const handleRemove = (index: number) => {
    const newEntries = draftEntries.filter((_, i) => i !== index);
    updateEntries(newEntries);
  };

  /** Add a new empty row. */
  const handleAdd = () => {
    if (terminalPath === 'labels' || terminalPath === 'annotations') {
      const newEntries: [string, string][] = [...draftEntries, ['', '']];
      updateEntries(newEntries);
      return;
    }
    const baseKey = 'key';
    const existingKeys = new Set(draftEntries.map(([k]) => k));
    let candidate = baseKey;
    let suffix = 2;
    while (existingKeys.has(candidate)) {
      candidate = `${baseKey}-${suffix}`;
      suffix += 1;
    }
    const newEntries: [string, string][] = [...draftEntries, [candidate, '']];
    updateEntries(newEntries);
  };

  return (
    <div data-field-key={field.key} className="resource-form-kv-container">
      {draftEntries.map(([k, v], index) => (
        <div
          key={index}
          className={`resource-form-kv-row${showInlineKeyValueLabels ? ' resource-form-kv-row--labeled' : ''}`}
        >
          {showInlineKeyValueLabels ? (
            <div className="resource-form-kv-labeled-pairs">
              <div className="resource-form-kv-pair">
                <span className="resource-form-kv-inline-label">Key</span>
                <input
                  type="text"
                  className="resource-form-input resource-form-kv-input--25ch"
                  value={k}
                  placeholder="key"
                  size={25}
                  {...INPUT_BEHAVIOR_PROPS}
                  onChange={(e) => handleKeyChange(index, e.target.value)}
                />
              </div>
              <div className="resource-form-kv-pair">
                <span className="resource-form-kv-inline-label">Value</span>
                <input
                  type="text"
                  className="resource-form-input resource-form-kv-input--25ch"
                  value={v}
                  placeholder="value"
                  size={25}
                  {...INPUT_BEHAVIOR_PROPS}
                  onChange={(e) => handleValueChange(index, e.target.value)}
                />
              </div>
            </div>
          ) : (
            <>
              <input
                type="text"
                className="resource-form-input"
                value={k}
                placeholder="key"
                {...INPUT_BEHAVIOR_PROPS}
                onChange={(e) => handleKeyChange(index, e.target.value)}
              />
              <input
                type="text"
                className="resource-form-input"
                value={v}
                placeholder="value"
                {...INPUT_BEHAVIOR_PROPS}
                onChange={(e) => handleValueChange(index, e.target.value)}
              />
            </>
          )}
          <div className="resource-form-actions-inline">
            <FormIconActionButton
              variant="add"
              hidden={index !== draftEntries.length - 1}
              label={index === draftEntries.length - 1 ? addButtonLabel : undefined}
              onClick={index === draftEntries.length - 1 ? handleAdd : undefined}
            />
            <FormIconActionButton
              variant="remove"
              label={removeButtonLabel}
              onClick={() => handleRemove(index)}
            />
          </div>
        </div>
      ))}
      {draftEntries.length === 0 && (
        <FormEmptyActionRow
          rowClassName="resource-form-kv-row"
          spacerClassName={
            !leftAlignEmptyStateActions ? 'resource-form-kv-empty-spacer' : undefined
          }
          actionsClassName="resource-form-actions-inline"
          alignLeft={leftAlignEmptyStateActions}
          alignLeftClassName="resource-form-actions-inline--left"
          addLabel={addButtonLabel}
          removeLabel={removeButtonLabel}
          onAdd={handleAdd}
          ghostText={addGhostText}
        />
      )}
    </div>
  );
}

/**
 * Group-list field component. Reads the current value as an array from
 * YAML and renders each item as a bordered card with sub-fields.
 * Sub-field paths are relative to each item, not the document root.
 */
function GroupListField({
  field,
  yamlContent,
  onYamlChange,
}: {
  field: FormFieldDefinition;
  yamlContent: string;
  onYamlChange: (yaml: string) => void;
}): React.ReactElement {
  const rawValue = getFieldValue(yamlContent, field.path);
  const items: Record<string, unknown>[] = useMemo(() => {
    if (Array.isArray(rawValue)) {
      return rawValue as Record<string, unknown>[];
    }
    return [];
  }, [rawValue]);
  const isContainerGroup = field.key === 'containers';
  const isVolumeGroup = field.key === 'volumes';
  const usesContainerGroupStyling = isContainerGroup || isVolumeGroup;
  const [resourceFieldsVisible, setResourceFieldsVisible] = useState<Record<string, boolean>>({});

  /** Write the full updated array back to the YAML at the group-list's path. */
  const updateItems = useCallback(
    (newItems: Record<string, unknown>[]) => {
      const updated = setFieldValue(yamlContent, field.path, newItems);
      if (updated !== null) onYamlChange(updated);
    },
    [yamlContent, field.path, onYamlChange]
  );

  /** Handle a sub-field change within a specific item. */
  const handleSubFieldChange = (
    itemIndex: number,
    subField: FormFieldDefinition,
    newValue: unknown
  ) => {
    const newItems = items.map((item, i) => {
      if (i !== itemIndex) return item;
      if (shouldOmitEmptyValue(subField, newValue)) {
        return unsetNestedValue(item, subField.path);
      }
      return setNestedValue(item, subField.path, newValue);
    });
    updateItems(newItems);
  };

  /** Remove an item from the array. */
  const handleRemoveItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index);
    updateItems(newItems);
    // Item indexes may shift after removal, so clear the transient visibility map.
    setResourceFieldsVisible({});
  };

  /** Add a new item with the default value. */
  const handleAddItem = () => {
    const defaultItem = (field.defaultValue ?? {}) as Record<string, unknown>;
    const newItems = [...items, { ...defaultItem }];
    updateItems(newItems);
  };

  /**
   * Build the per-item header title.
   * Container groups use the current container name so the header tracks edits.
   */
  const getItemTitle = (item: Record<string, unknown>, itemIndex: number): string => {
    if (!usesContainerGroupStyling) return `${field.label} ${itemIndex + 1}`;
    const nameValue = getNestedValue(item, ['name']);
    const name = String(nameValue ?? '').trim();
    if (isContainerGroup) return name || 'Container';
    if (isVolumeGroup) return name || 'Volume';
    return `${field.label} ${itemIndex + 1}`;
  };

  /**
   * Render a single sub-field within a group-list item.
   * The sub-field's path is relative to the item object.
   */
  const renderSubField = (
    subField: FormFieldDefinition,
    item: Record<string, unknown>,
    itemIndex: number
  ): React.ReactNode => {
    const subValue = getNestedValue(item, subField.path);
    const stringValue = subValue != null ? String(subValue) : '';

    switch (subField.type) {
      case 'text':
        return (
          <input
            type="text"
            className="resource-form-input"
            data-field-key={subField.key}
            value={stringValue}
            placeholder={subField.placeholder}
            {...INPUT_BEHAVIOR_PROPS}
            onChange={(e) => handleSubFieldChange(itemIndex, subField, e.target.value)}
          />
        );
      case 'number':
        return (
          <input
            type="number"
            className="resource-form-input"
            data-field-key={subField.key}
            value={stringValue}
            placeholder={subField.placeholder}
            min={subField.min}
            max={subField.max}
            step={subField.integer ? 1 : undefined}
            {...INPUT_BEHAVIOR_PROPS}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                handleSubFieldChange(itemIndex, subField, '');
                return;
              }
              const num = Number(raw);
              if (Number.isNaN(num)) return;
              if (subField.integer && !Number.isInteger(num)) return;
              if (typeof subField.min === 'number' && num < subField.min) return;
              if (typeof subField.max === 'number' && num > subField.max) return;
              handleSubFieldChange(itemIndex, subField, num);
            }}
          />
        );
      case 'select':
        return (
          <div data-field-key={subField.key} className="resource-form-dropdown">
            <Dropdown
              options={buildSelectOptions(subField)}
              value={getSelectFieldValue(subField, stringValue)}
              onChange={(nextValue) => {
                const normalized = Array.isArray(nextValue) ? (nextValue[0] ?? '') : nextValue;
                handleSubFieldChange(itemIndex, subField, normalized);
              }}
              ariaLabel={subField.label}
            />
          </div>
        );
      case 'textarea':
        return (
          <textarea
            className="resource-form-textarea"
            data-field-key={subField.key}
            value={stringValue}
            placeholder={subField.placeholder}
            {...INPUT_BEHAVIOR_PROPS}
            onChange={(e) => handleSubFieldChange(itemIndex, subField, e.target.value)}
          />
        );
      case 'container-resources': {
        const requestFields = [
          { key: 'requestsCpu', label: 'CPU', path: ['requests', 'cpu'] },
          { key: 'requestsMemory', label: 'Memory', path: ['requests', 'memory'] },
        ] as const;
        const limitFields = [
          { key: 'limitsCpu', label: 'CPU', path: ['limits', 'cpu'] },
          { key: 'limitsMemory', label: 'Memory', path: ['limits', 'memory'] },
        ] as const;
        const resourceFieldRows = [
          { key: 'requests', label: 'Requests', fields: requestFields },
          { key: 'limits', label: 'Limits', fields: limitFields },
        ] as const;
        const allResourceFields = [...requestFields, ...limitFields] as const;

        const resources =
          subValue && typeof subValue === 'object' && !Array.isArray(subValue)
            ? (subValue as Record<string, unknown>)
            : undefined;
        const visibilityKey = `${itemIndex}:${subField.key}`;
        const hasAnyValue = allResourceFields.some((resourceField) => {
          const value = resources ? getNestedValue(resources, [...resourceField.path]) : undefined;
          return String(value ?? '').trim() !== '';
        });
        const visibilityOverride = resourceFieldsVisible[visibilityKey];
        const showFields = visibilityOverride !== undefined ? visibilityOverride : hasAnyValue;

        const handleResourceValueChange = (resourcePath: readonly string[], rawValue: string) => {
          const absolutePath = [...subField.path, ...resourcePath];
          const updatedItems = items.map((currentItem, i) => {
            if (i !== itemIndex) return currentItem;
            if (rawValue.trim() === '') {
              return unsetNestedValue(currentItem, absolutePath);
            }
            return setNestedValue(currentItem, absolutePath, rawValue);
          });
          updateItems(updatedItems);
        };
        const handleRemoveResources = () => {
          if (hasAnyValue) {
            const updatedItems = items.map((currentItem, i) => {
              if (i !== itemIndex) return currentItem;
              return unsetNestedValue(currentItem, [...subField.path]);
            });
            updateItems(updatedItems);
          }
          setResourceFieldsVisible((previous) => ({
            ...previous,
            [visibilityKey]: false,
          }));
        };

        if (!showFields) {
          return (
            <div className="resource-form-actions-row">
              <FormIconActionButton
                variant="add"
                label="Add Resources"
                onClick={() =>
                  setResourceFieldsVisible((previous) => ({
                    ...previous,
                    [visibilityKey]: true,
                  }))
                }
              />
              <FormGhostAddText text="Add resource requests/limits" />
            </div>
          );
        }

        return (
          <div data-field-key={subField.key} className="resource-form-container-resources">
            {resourceFieldRows.map((row, rowIndex) => (
              <div key={row.key} className="resource-form-container-resources-row">
                <span className="resource-form-container-resources-row-label">{row.label}</span>
                {row.fields.map((resourceField) => {
                  const value = resources
                    ? getNestedValue(resources, [...resourceField.path])
                    : undefined;
                  return (
                    <div
                      key={resourceField.key}
                      className="resource-form-container-resources-metric"
                    >
                      <label className="resource-form-container-resources-metric-label">
                        {resourceField.label}
                      </label>
                      <input
                        type="text"
                        className="resource-form-input"
                        data-field-key={resourceField.key}
                        value={value != null ? String(value) : ''}
                        placeholder="optional"
                        {...INPUT_BEHAVIOR_PROPS}
                        onChange={(e) =>
                          handleResourceValueChange(resourceField.path, e.target.value)
                        }
                      />
                    </div>
                  );
                })}
                <div className="resource-form-container-resources-row-actions">
                  <FormIconActionButton
                    variant="remove"
                    hidden={rowIndex !== 0}
                    label={rowIndex === 0 ? 'Remove Resources' : undefined}
                    onClick={rowIndex === 0 ? handleRemoveResources : undefined}
                  />
                </div>
              </div>
            ))}
          </div>
        );
      }
      case 'volume-source': {
        const currentSource = getCurrentVolumeSource(item);
        const effectiveSource =
          currentSource ?? getVolumeSourceDefinition(DEFAULT_VOLUME_SOURCE_KEY);
        const isConfigMapSource = effectiveSource.key === 'configMap';
        const sourceKey = effectiveSource.key;
        const sourceValue = String(getNestedValue(item, effectiveSource.valuePath) ?? '');
        const sourceOptions: DropdownOption[] = VOLUME_SOURCE_DEFINITIONS.map((definition) => ({
          value: definition.key,
          label: definition.label,
        }));
        const extraFields = VOLUME_SOURCE_EXTRA_FIELDS[effectiveSource.key] ?? [];
        const configMapItems =
          effectiveSource.key === 'configMap' &&
          Array.isArray(getNestedValue(item, ['configMap', 'items']))
            ? (getNestedValue(item, ['configMap', 'items']) as Record<string, unknown>[])
            : [];

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
            return ensureVolumeSourceRoot(clearedItem, selectedDefinition.key);
          });
          updateItems(updatedItems);
        };

        const handleSourceValueChange = (nextValue: string) => {
          const updatedItems = items.map((currentItem, i) => {
            if (i !== itemIndex) return currentItem;
            let nextItem = clearOtherVolumeSources(currentItem, effectiveSource.key);
            nextItem = ensureVolumeSourceRoot(nextItem, effectiveSource.key);
            if (effectiveSource.key === 'emptyDir' && nextValue.trim() === '') {
              return nextItem;
            }
            if (nextValue.trim() === '') {
              return unsetNestedValue(nextItem, effectiveSource.valuePath);
            }
            return setNestedValue(nextItem, effectiveSource.valuePath, nextValue);
          });
          updateItems(updatedItems);
        };

        const handleExtraFieldChange = (
          extraField: VolumeSourceExtraFieldDefinition,
          rawValue: string
        ) => {
          const normalizedRaw = rawValue.trim();
          const updatedItems = items.map((currentItem, i) => {
            if (i !== itemIndex) return currentItem;
            let nextItem = clearOtherVolumeSources(currentItem, effectiveSource.key);
            nextItem = ensureVolumeSourceRoot(nextItem, effectiveSource.key);
            if (normalizedRaw === '') {
              return unsetNestedValue(nextItem, extraField.path);
            }
            const parsedValue = extraField.parseValue ? extraField.parseValue(rawValue) : rawValue;
            if (parsedValue === '') {
              return unsetNestedValue(nextItem, extraField.path);
            }
            return setNestedValue(nextItem, extraField.path, parsedValue);
          });
          updateItems(updatedItems);
        };

        /** Persist ConfigMap items while preserving selected source and clearing other source roots. */
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

        const renderExtraField = (extraField: VolumeSourceExtraFieldDefinition) => {
          const rawExtraValue = getNestedValue(item, extraField.path);
          const extraValue =
            rawExtraValue === undefined && extraField.defaultValue !== undefined
              ? extraField.defaultValue
              : extraField.formatValue
                ? extraField.formatValue(rawExtraValue)
                : String(rawExtraValue ?? '');

          return (
            <div
              key={extraField.key}
              data-field-key={extraField.key}
              className="resource-form-volume-source-extra-field"
            >
              <span className="resource-form-nested-group-label">{extraField.label}</span>
              {extraField.type === 'select' ? (
                <div className="resource-form-volume-source-extra-dropdown">
                  <Dropdown
                    options={extraField.options ?? []}
                    value={extraValue}
                    onChange={(nextValue) => {
                      const normalized = Array.isArray(nextValue)
                        ? (nextValue[0] ?? '')
                        : nextValue;
                      handleExtraFieldChange(extraField, normalized);
                    }}
                    ariaLabel={extraField.label}
                  />
                </div>
              ) : extraField.type === 'number' ? (
                <input
                  type="number"
                  className="resource-form-input"
                  data-field-key={extraField.key}
                  value={extraValue}
                  placeholder={extraField.placeholder}
                  min={extraField.min}
                  max={extraField.max}
                  step={extraField.integer ? 1 : undefined}
                  {...INPUT_BEHAVIOR_PROPS}
                  onChange={(e) => handleExtraFieldChange(extraField, e.target.value)}
                />
              ) : (
                <input
                  type="text"
                  className="resource-form-input"
                  value={extraValue}
                  placeholder={extraField.placeholder}
                  {...INPUT_BEHAVIOR_PROPS}
                  onChange={(e) => handleExtraFieldChange(extraField, e.target.value)}
                />
              )}
            </div>
          );
        };

        return (
          <div data-field-key={subField.key} className="resource-form-volume-source-group">
            <div className="resource-form-volume-source">
              <div className="resource-form-volume-source-dropdown">
                <Dropdown
                  options={sourceOptions}
                  value={sourceKey}
                  onChange={handleSourceTypeChange}
                  ariaLabel={subField.label}
                />
              </div>
              {!isConfigMapSource && (
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

            {isConfigMapSource && (
              <div className="resource-form-volume-source-extra resource-form-volume-source-extra--configmap">
                <div
                  data-field-key="configMapName"
                  className="resource-form-volume-source-extra-field"
                >
                  <span className="resource-form-nested-group-label">ConfigMap</span>
                  <input
                    type="text"
                    className="resource-form-input"
                    value={sourceValue}
                    placeholder={effectiveSource.placeholder}
                    {...INPUT_BEHAVIOR_PROPS}
                    onChange={(e) => handleSourceValueChange(e.target.value)}
                  />
                </div>
                {extraFields.map((extraField) => renderExtraField(extraField))}
              </div>
            )}

            {!isConfigMapSource && extraFields.length > 0 && (
              <div className="resource-form-volume-source-extra">
                {extraFields.map((extraField) => renderExtraField(extraField))}
              </div>
            )}

            {effectiveSource.key === 'configMap' && (
              <div data-field-key="configMapItems" className="resource-form-nested-group-list">
                {configMapItems.map((entry, rowIndex) => {
                  const itemKey = String(getNestedValue(entry, ['key']) ?? '');
                  const itemPath = String(getNestedValue(entry, ['path']) ?? '');
                  const itemMode = String(getNestedValue(entry, ['mode']) ?? '');

                  return (
                    <div key={rowIndex} className="resource-form-nested-group-row">
                      <div className="resource-form-nested-group-fields">
                        <div
                          data-field-key="configMapItemKey"
                          className="resource-form-nested-group-field"
                        >
                          <label className="resource-form-nested-group-label">Key</label>
                          <input
                            type="text"
                            className="resource-form-input"
                            value={itemKey}
                            placeholder="key"
                            {...INPUT_BEHAVIOR_PROPS}
                            onChange={(e) =>
                              handleConfigMapItemChange(rowIndex, ['key'], e.target.value)
                            }
                          />
                        </div>
                        <div
                          data-field-key="configMapItemPath"
                          className="resource-form-nested-group-field"
                        >
                          <label className="resource-form-nested-group-label">Path</label>
                          <input
                            type="text"
                            className="resource-form-input"
                            value={itemPath}
                            placeholder="path"
                            {...INPUT_BEHAVIOR_PROPS}
                            onChange={(e) =>
                              handleConfigMapItemChange(rowIndex, ['path'], e.target.value)
                            }
                          />
                        </div>
                        <div
                          data-field-key="configMapItemMode"
                          className="resource-form-nested-group-field"
                        >
                          <label className="resource-form-nested-group-label">Mode</label>
                          <input
                            type="number"
                            className="resource-form-input"
                            value={itemMode}
                            placeholder="420"
                            min={0}
                            max={511}
                            step={1}
                            {...INPUT_BEHAVIOR_PROPS}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === '') {
                                handleConfigMapItemChange(rowIndex, ['mode'], '');
                                return;
                              }
                              const parsed = Number(raw);
                              if (!Number.isInteger(parsed) || parsed < 0 || parsed > 511) {
                                return;
                              }
                              handleConfigMapItemChange(rowIndex, ['mode'], parsed);
                            }}
                          />
                        </div>
                      </div>
                      <div className="resource-form-nested-group-row-actions">
                        <FormIconActionButton
                          variant="add"
                          hidden={rowIndex !== configMapItems.length - 1}
                          label={rowIndex === configMapItems.length - 1 ? 'Add item' : undefined}
                          onClick={
                            rowIndex === configMapItems.length - 1
                              ? handleConfigMapAddItem
                              : undefined
                          }
                        />
                        <FormIconActionButton
                          variant="remove"
                          label="Remove Items"
                          onClick={() => handleConfigMapRemoveItem(rowIndex)}
                        />
                      </div>
                    </div>
                  );
                })}

                {configMapItems.length === 0 && (
                  <FormEmptyActionRow
                    rowClassName="resource-form-nested-group-row"
                    actionsClassName="resource-form-nested-group-row-actions"
                    alignLeft
                    alignLeftClassName="resource-form-nested-group-row-actions--left"
                    addLabel="Add item"
                    removeLabel="Remove Items"
                    onAdd={handleConfigMapAddItem}
                    ghostText="Add item"
                  />
                )}
              </div>
            )}
          </div>
        );
      }
      case 'key-value-list': {
        const entries: [string, string][] =
          subValue && typeof subValue === 'object' && !Array.isArray(subValue)
            ? Object.entries(subValue as Record<string, unknown>).map(([k, v]) => [
                k,
                String(v ?? ''),
              ])
            : [];

        /** Rebuild the map and write it back to the current group-list item. */
        const updateEntries = (newEntries: [string, string][]) => {
          const obj: Record<string, string> = {};
          for (const [k, v] of newEntries) {
            if (k) obj[k] = v;
          }
          handleSubFieldChange(itemIndex, subField, obj);
        };

        const handleKeyChange = (entryIndex: number, newKey: string) => {
          const newEntries = entries.map((entry, i) =>
            i === entryIndex ? ([newKey, entry[1]] as [string, string]) : entry
          );
          updateEntries(newEntries);
        };

        const handleValueChange = (entryIndex: number, newValue: string) => {
          const newEntries = entries.map((entry, i) =>
            i === entryIndex ? ([entry[0], newValue] as [string, string]) : entry
          );
          updateEntries(newEntries);
        };

        const handleRemove = (entryIndex: number) => {
          updateEntries(entries.filter((_, i) => i !== entryIndex));
        };

        const handleAdd = () => {
          const terminalPath = subField.path[subField.path.length - 1];
          const baseKey =
            terminalPath === 'requests'
              ? 'request-key'
              : terminalPath === 'limits'
                ? 'limit-key'
                : 'key';
          const existingKeys = new Set(entries.map(([k]) => k));
          let candidate = baseKey;
          let suffix = 2;
          while (existingKeys.has(candidate)) {
            candidate = `${baseKey}-${suffix}`;
            suffix += 1;
          }
          updateEntries([...entries, [candidate, '']]);
        };
        const nestedAddLabel = 'Add Entry';
        const nestedRemoveLabel = 'Remove Entry';

        return (
          <div data-field-key={subField.key} className="resource-form-kv-container">
            {entries.map(([k, v], entryIndex) => (
              <div key={entryIndex} className="resource-form-kv-row">
                <input
                  type="text"
                  className="resource-form-input"
                  value={k}
                  placeholder="key"
                  {...INPUT_BEHAVIOR_PROPS}
                  onChange={(e) => handleKeyChange(entryIndex, e.target.value)}
                />
                <input
                  type="text"
                  className="resource-form-input"
                  value={v}
                  placeholder="value"
                  {...INPUT_BEHAVIOR_PROPS}
                  onChange={(e) => handleValueChange(entryIndex, e.target.value)}
                />
                <div className="resource-form-actions-inline">
                  <FormIconActionButton
                    variant="add"
                    hidden={entryIndex !== entries.length - 1}
                    label={entryIndex === entries.length - 1 ? nestedAddLabel : undefined}
                    onClick={entryIndex === entries.length - 1 ? handleAdd : undefined}
                  />
                  <FormIconActionButton
                    variant="remove"
                    label={nestedRemoveLabel}
                    onClick={() => handleRemove(entryIndex)}
                  />
                </div>
              </div>
            ))}
            {entries.length === 0 && (
              <FormEmptyActionRow
                rowClassName="resource-form-kv-row"
                spacerClassName="resource-form-kv-empty-spacer"
                actionsClassName="resource-form-actions-inline"
                addLabel={nestedAddLabel}
                removeLabel={nestedRemoveLabel}
                onAdd={handleAdd}
              />
            )}
          </div>
        );
      }
      case 'group-list': {
        const nestedItems = Array.isArray(subValue) ? (subValue as Record<string, unknown>[]) : [];
        const nestedTerminalPath = subField.path[subField.path.length - 1];
        const leftAlignNestedEmptyActions =
          nestedTerminalPath === 'ports' || nestedTerminalPath === 'env';
        const nestedAddGhostText =
          nestedTerminalPath === 'ports'
            ? 'Add port'
            : nestedTerminalPath === 'env'
              ? 'Add env var'
              : null;

        /** Write an updated nested list back into the parent item. */
        const updateNestedItems = (newNestedItems: Record<string, unknown>[]) => {
          handleSubFieldChange(itemIndex, subField, newNestedItems);
        };

        /** Change a nested field value for one nested row. */
        const handleNestedFieldChange = (
          nestedIndex: number,
          nestedField: FormFieldDefinition,
          newValue: unknown
        ) => {
          const updated = nestedItems.map((nestedItem, i) => {
            if (i !== nestedIndex) return nestedItem;
            if (shouldOmitEmptyValue(nestedField, newValue)) {
              return unsetNestedValue(nestedItem, nestedField.path);
            }
            return setNestedValue(nestedItem, nestedField.path, newValue);
          });
          updateNestedItems(updated);
        };

        /** Remove a nested row. */
        const handleNestedRemove = (nestedIndex: number) => {
          updateNestedItems(nestedItems.filter((_, i) => i !== nestedIndex));
        };

        /** Add a nested row using the nested defaultValue. */
        const handleNestedAdd = () => {
          const defaultItem = (subField.defaultValue ?? {}) as Record<string, unknown>;
          updateNestedItems([...nestedItems, { ...defaultItem }]);
        };

        /** Render a nested leaf input inside the nested group-list. */
        const renderNestedLeafField = (
          nestedField: FormFieldDefinition,
          nestedItem: Record<string, unknown>,
          nestedIndex: number
        ): React.ReactNode => {
          const nestedValue = getNestedValue(nestedItem, nestedField.path);
          const nestedStringValue = nestedValue != null ? String(nestedValue) : '';

          switch (nestedField.type) {
            case 'text':
              return (
                <input
                  type="text"
                  className="resource-form-input"
                  data-field-key={nestedField.key}
                  value={nestedStringValue}
                  placeholder={nestedField.placeholder}
                  {...INPUT_BEHAVIOR_PROPS}
                  onChange={(e) =>
                    handleNestedFieldChange(nestedIndex, nestedField, e.target.value)
                  }
                />
              );
            case 'number':
              return (
                <input
                  type="number"
                  className="resource-form-input"
                  data-field-key={nestedField.key}
                  value={nestedStringValue}
                  placeholder={nestedField.placeholder}
                  min={nestedField.min}
                  max={nestedField.max}
                  step={nestedField.integer ? 1 : undefined}
                  {...INPUT_BEHAVIOR_PROPS}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      handleNestedFieldChange(nestedIndex, nestedField, '');
                      return;
                    }
                    const num = Number(raw);
                    if (Number.isNaN(num)) return;
                    if (nestedField.integer && !Number.isInteger(num)) return;
                    if (typeof nestedField.min === 'number' && num < nestedField.min) return;
                    if (typeof nestedField.max === 'number' && num > nestedField.max) return;
                    handleNestedFieldChange(nestedIndex, nestedField, num);
                  }}
                />
              );
            case 'select':
              return (
                <div data-field-key={nestedField.key} className="resource-form-dropdown">
                  <Dropdown
                    options={buildSelectOptions(nestedField)}
                    value={getSelectFieldValue(nestedField, nestedStringValue)}
                    onChange={(nextValue) => {
                      const normalized = Array.isArray(nextValue)
                        ? (nextValue[0] ?? '')
                        : nextValue;
                      handleNestedFieldChange(nestedIndex, nestedField, normalized);
                    }}
                    ariaLabel={nestedField.label}
                  />
                </div>
              );
            case 'textarea':
              return (
                <textarea
                  className="resource-form-textarea"
                  data-field-key={nestedField.key}
                  value={nestedStringValue}
                  placeholder={nestedField.placeholder}
                  {...INPUT_BEHAVIOR_PROPS}
                  onChange={(e) =>
                    handleNestedFieldChange(nestedIndex, nestedField, e.target.value)
                  }
                />
              );
            default:
              return null;
          }
        };

        return (
          <div data-field-key={subField.key} className="resource-form-nested-group-list">
            {nestedItems.map((nestedItem, nestedIndex) => (
              <div key={nestedIndex} className="resource-form-nested-group-row">
                <div className="resource-form-nested-group-fields">
                  {subField.fields?.map((nestedField) => (
                    <div
                      key={nestedField.key}
                      data-field-key={nestedField.key}
                      className="resource-form-nested-group-field"
                    >
                      <label className="resource-form-nested-group-label">
                        {nestedField.label}
                      </label>
                      {renderNestedLeafField(nestedField, nestedItem, nestedIndex)}
                    </div>
                  ))}
                </div>
                <div className="resource-form-nested-group-row-actions">
                  <FormIconActionButton
                    variant="add"
                    hidden={nestedIndex !== nestedItems.length - 1}
                    label={
                      nestedIndex === nestedItems.length - 1 ? `Add ${subField.label}` : undefined
                    }
                    onClick={nestedIndex === nestedItems.length - 1 ? handleNestedAdd : undefined}
                  />
                  <FormIconActionButton
                    variant="remove"
                    label={`Remove ${subField.label}`}
                    onClick={() => handleNestedRemove(nestedIndex)}
                  />
                </div>
              </div>
            ))}
            {nestedItems.length === 0 && (
              <FormEmptyActionRow
                rowClassName="resource-form-nested-group-row"
                spacerClassName={
                  !leftAlignNestedEmptyActions ? 'resource-form-nested-group-fields' : undefined
                }
                actionsClassName="resource-form-nested-group-row-actions"
                alignLeft={leftAlignNestedEmptyActions}
                alignLeftClassName="resource-form-nested-group-row-actions--left"
                addLabel={`Add ${subField.label}`}
                removeLabel={`Remove ${subField.label}`}
                onAdd={handleNestedAdd}
                ghostText={nestedAddGhostText}
              />
            )}
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div data-field-key={field.key} className="resource-form-group-container">
      {items.map((item, itemIndex) => (
        <div key={itemIndex} className="resource-form-group-entry">
          <div className="resource-form-group-item">
            <div
              className={`resource-form-group-item-header${usesContainerGroupStyling ? ' resource-form-group-item-header--container' : ''}`}
            >
              <span className="resource-form-group-item-title">
                {getItemTitle(item, itemIndex)}
              </span>
              <div className="resource-form-group-item-header-actions">
                <FormIconActionButton
                  variant="add"
                  hidden={itemIndex !== items.length - 1}
                  label={itemIndex === items.length - 1 ? `Add ${field.label}` : undefined}
                  onClick={itemIndex === items.length - 1 ? handleAddItem : undefined}
                />
                <FormIconActionButton
                  variant="remove"
                  label={`Remove ${isContainerGroup ? 'Container' : isVolumeGroup ? 'Volume' : field.label}`}
                  onClick={() => handleRemoveItem(itemIndex)}
                />
              </div>
            </div>
            <div className="resource-form-group-item-fields">
              {field.fields?.map((subField) => (
                <div key={subField.key} className="resource-form-field">
                  <label className="resource-form-label">{subField.label}</label>
                  {renderSubField(subField, item, itemIndex)}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
      {items.length === 0 && (
        <div className="resource-form-actions-row">
          <FormIconActionButton
            variant="add"
            label={`Add ${field.label}`}
            onClick={handleAddItem}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

/**
 * ResourceForm — generic form renderer that reads a ResourceFormDefinition
 * and renders the appropriate form inputs. Values are read from YAML via
 * getFieldValue and written via setFieldValue.
 */
export function ResourceForm({
  definition,
  yamlContent,
  onYamlChange,
}: ResourceFormProps): React.ReactElement {
  const valid = isYamlValid(yamlContent);

  // If YAML has parse errors, show an error message instead of the form.
  if (!valid) {
    return (
      <div className="resource-form">
        <div className="resource-form-parse-error">
          YAML has syntax errors. Switch to the YAML tab to fix them.
        </div>
      </div>
    );
  }

  return (
    <div className="resource-form">
      {definition.sections.map((section) => (
        <div key={section.title} className="resource-form-section">
          <h3 className="resource-form-section-title">{section.title}</h3>
          {section.fields.map((field) => {
            const useFullWidthLayout = field.key === 'containers' || field.key === 'volumes';
            return (
              <div
                key={field.key}
                className={`resource-form-field${useFullWidthLayout ? ' resource-form-field--full-width' : ''}`}
              >
                {!useFullWidthLayout && (
                  <label className="resource-form-label">{field.label}</label>
                )}
                <FieldRenderer
                  field={field}
                  yamlContent={yamlContent}
                  onYamlChange={onYamlChange}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Render a single field based on its type definition.
 * Dispatches to the appropriate field component.
 */
function FieldRenderer({
  field,
  yamlContent,
  onYamlChange,
}: {
  field: FormFieldDefinition;
  yamlContent: string;
  onYamlChange: (yaml: string) => void;
}): React.ReactElement | null {
  switch (field.type) {
    case 'text':
      return <TextField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />;
    case 'number':
      return <NumberField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />;
    case 'select':
      return <SelectField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />;
    case 'textarea':
      return <TextareaField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />;
    case 'key-value-list':
      return (
        <KeyValueListField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />
      );
    case 'group-list':
      return <GroupListField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />;
    default:
      return null;
  }
}
