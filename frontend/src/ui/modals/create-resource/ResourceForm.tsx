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
import { FormIconActionButton } from './FormActionPrimitives';
import { FormCompactNumberInput, parseCompactNumberValue } from './FormCompactNumberInput';
import {
  FormContainerResourcesField,
  hasContainerResourceValues,
} from './FormContainerResourcesField';
import { FormFieldRow } from './FormFieldRow';
import { FormKeyValueListField } from './FormKeyValueListField';
import { FormNestedListField } from './FormNestedListField';
import { FormSectionCard } from './FormSectionCard';
import { FormTriStateBooleanDropdown } from './FormTriStateBooleanDropdown';
import './ResourceForm.css';

interface ResourceFormProps {
  /** Declarative form definition describing sections and fields. */
  definition: ResourceFormDefinition;
  /** Current YAML content (source of truth). */
  yamlContent: string;
  /** Callback invoked with updated YAML when a field value changes. */
  onYamlChange: (yaml: string) => void;
  /** Namespace options scoped to the currently selected cluster. */
  namespaceOptions?: DropdownOption[];
  /** Optional callback for namespace selection changes. */
  onNamespaceChange?: (namespace: string) => void;
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

const DEFAULT_SELECTOR_ENTRY: [string, string] = ['app.kubernetes.io/name', ''];

function toStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
      key,
      String(entryValue ?? ''),
    ])
  );
}

function toMapEntries(value: unknown): [string, string][] {
  return Object.entries(toStringMap(value));
}

/**
 * Build standard dropdown options for select fields.
 * Includes an explicit empty option so users can clear a selection.
 */
function buildSelectOptions(field: FormFieldDefinition): DropdownOption[] {
  const includeEmptyOption = field.key !== 'protocol';
  return [
    ...(includeEmptyOption ? [{ value: '', label: '-----' }] : []),
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
}

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
      parseValue: (rawValue: string) => {
        if (rawValue.trim() === '') return '';
        const parsed = Number(rawValue);
        return Number.isInteger(parsed) ? parsed : '';
      },
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
      const parsed = parseCompactNumberValue(
        raw,
        { min, max, integer: integerOnly },
        { allowEmpty: !hasBounds }
      );
      if (parsed === null) {
        restorePreviousValue();
        return;
      }

      const updated = setFieldValue(yamlRef.current, pathRef.current, parsed);
      if (updated !== null) onChangeRef.current(updated);
    };
    el.addEventListener('change', handler);
    return () => {
      el.removeEventListener('change', handler);
    };
  }, []);

  return (
    <FormCompactNumberInput
      inputRef={inputRef}
      dataFieldKey={field.key}
      defaultValue={stringValue}
      placeholder={field.placeholder}
      min={field.min}
      max={field.max}
      integer={field.integer}
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
 * Namespace dropdown field component.
 */
function NamespaceSelectField({
  field,
  yamlContent,
  onYamlChange,
  namespaceOptions = [],
  onNamespaceChange,
}: {
  field: FormFieldDefinition;
  yamlContent: string;
  onYamlChange: (yaml: string) => void;
  namespaceOptions?: DropdownOption[];
  onNamespaceChange?: (namespace: string) => void;
}): React.ReactElement {
  const value = getFieldValue(yamlContent, field.path);
  const stringValue = value != null ? String(value) : '';

  return (
    <div data-field-key={field.key} className="resource-form-dropdown">
      <Dropdown
        options={namespaceOptions}
        value={stringValue}
        onChange={(nextValue) => {
          const normalized = Array.isArray(nextValue) ? (nextValue[0] ?? '') : nextValue;
          const updated = setFieldValue(yamlContent, field.path, normalized);
          if (updated !== null) onYamlChange(updated);
          onNamespaceChange?.(normalized);
        }}
        placeholder="Select namespace"
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
  const excludedKeysSourceValue =
    field.excludedKeysSourcePath && field.excludedKeysSourcePath.length > 0
      ? getFieldValue(yamlContent, field.excludedKeysSourcePath)
      : undefined;
  const excludedKeys = useMemo(
    () => new Set(Object.keys(toStringMap(excludedKeysSourceValue))),
    [excludedKeysSourceValue]
  );
  const terminalPath = field.path[field.path.length - 1];
  const pathKey = field.path.join('.');
  const showInlineKeyValueLabels = terminalPath === 'labels' || terminalPath === 'annotations';
  const leftAlignEmptyStateActions = terminalPath === 'labels' || terminalPath === 'annotations';

  // Convert the object to an array of [key, value] pairs for rendering.
  const entriesFromYaml: [string, string][] = useMemo(() => {
    return toMapEntries(rawValue).filter(([key]) => !excludedKeys.has(key));
  }, [excludedKeys, rawValue]);
  const [draftEntries, setDraftEntries] = useState<[string, string][]>(entriesFromYaml);
  const lastSyncKeyRef = useRef(`${pathKey}|${yamlContent}`);

  /**
   * Build the persisted YAML map from editable rows.
   * Empty keys are skipped so partial rows do not leak into YAML.
   */
  const toPersistedMap = useCallback(
    (rows: [string, string][]): Record<string, string> => {
      const obj: Record<string, string> = {};
      for (const [k, v] of rows) {
        if (excludedKeys.has(k)) continue;
        if (k) obj[k] = v;
      }
      return obj;
    },
    [excludedKeys]
  );

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
      const editableEntries = newEntries.filter(
        ([key]) => key.trim() === '' || !excludedKeys.has(key)
      );
      setDraftEntries(editableEntries);
      const nextMap = toPersistedMap(editableEntries);
      const existingMap = toStringMap(getFieldValue(yamlContent, field.path));
      for (const [key, value] of Object.entries(existingMap)) {
        if (excludedKeys.has(key)) {
          nextMap[key] = value;
        }
      }
      const updated = setFieldValue(yamlContent, field.path, nextMap);
      if (updated !== null) onYamlChange(updated);
    },
    [excludedKeys, yamlContent, field.path, onYamlChange, toPersistedMap]
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
    <FormKeyValueListField
      dataFieldKey={field.key}
      entries={draftEntries}
      onKeyChange={handleKeyChange}
      onValueChange={handleValueChange}
      onRemove={handleRemove}
      onAdd={handleAdd}
      addButtonLabel={addButtonLabel}
      removeButtonLabel={removeButtonLabel}
      showInlineKeyValueLabels={showInlineKeyValueLabels}
      leftAlignEmptyStateActions={leftAlignEmptyStateActions}
      addGhostText={addGhostText}
    />
  );
}

/**
 * Deployment selectors field. Keeps selector entries synced across
 * metadata.labels, spec.selector.matchLabels, and spec.template.metadata.labels.
 */
function SelectorListField({
  field,
  yamlContent,
  onYamlChange,
}: {
  field: FormFieldDefinition;
  yamlContent: string;
  onYamlChange: (yaml: string) => void;
}): React.ReactElement {
  const basePathKey = field.path.join('.');
  const mirrorPathKeys = useMemo(
    () => (field.mirrorPaths ?? []).map((path) => path.join('.')).join('|'),
    [field.mirrorPaths]
  );
  const syncKey = `${basePathKey}|${mirrorPathKeys}`;
  const sourceValues = useMemo(
    () => [
      getFieldValue(yamlContent, field.path),
      ...(field.mirrorPaths ?? []).map((path) => getFieldValue(yamlContent, path)),
    ],
    [yamlContent, field.path, field.mirrorPaths]
  );

  const entriesFromYaml: [string, string][] = useMemo(() => {
    for (const sourceValue of sourceValues) {
      const entries = toMapEntries(sourceValue);
      if (entries.length > 0) return entries;
    }
    return [DEFAULT_SELECTOR_ENTRY];
  }, [sourceValues]);
  const [draftEntries, setDraftEntries] = useState<[string, string][]>(entriesFromYaml);
  const lastSyncKeyRef = useRef(`${syncKey}|${yamlContent}`);

  const toPersistedMap = useCallback((rows: [string, string][]): Record<string, string> => {
    const obj: Record<string, string> = {};
    for (const [key, value] of rows) {
      if (key) obj[key] = value;
    }
    return obj;
  }, []);

  const arePersistedMapsEqual = useCallback(
    (leftRows: [string, string][], rightRows: [string, string][]): boolean => {
      const left = toPersistedMap(leftRows);
      const right = toPersistedMap(rightRows);
      const leftKeys = Object.keys(left);
      const rightKeys = Object.keys(right);
      if (leftKeys.length !== rightKeys.length) return false;
      for (const key of leftKeys) {
        if (left[key] !== right[key]) return false;
      }
      return true;
    },
    [toPersistedMap]
  );

  useEffect(() => {
    const currentSyncKey = `${syncKey}|${yamlContent}`;
    if (currentSyncKey === lastSyncKeyRef.current) return;
    lastSyncKeyRef.current = currentSyncKey;
    setDraftEntries((previousDraft) => {
      if (arePersistedMapsEqual(previousDraft, entriesFromYaml)) {
        return previousDraft;
      }
      return entriesFromYaml;
    });
  }, [arePersistedMapsEqual, entriesFromYaml, syncKey, yamlContent]);

  const updateEntries = useCallback(
    (newEntries: [string, string][]) => {
      const normalizedEntries = newEntries.length > 0 ? newEntries : [DEFAULT_SELECTOR_ENTRY];
      setDraftEntries(normalizedEntries);
      const persisted = toPersistedMap(normalizedEntries);
      const syncPaths = [field.path, ...(field.mirrorPaths ?? [])];
      let nextYaml = yamlContent;
      for (const syncPath of syncPaths) {
        const updated = setFieldValue(nextYaml, syncPath, persisted);
        if (updated === null) return;
        nextYaml = updated;
      }
      onYamlChange(nextYaml);
    },
    [field.path, field.mirrorPaths, onYamlChange, toPersistedMap, yamlContent]
  );

  const handleKeyChange = (index: number, newKey: string) => {
    const nextEntries = draftEntries.map((entry, i) =>
      i === index ? ([newKey, entry[1]] as [string, string]) : entry
    );
    updateEntries(nextEntries);
  };

  const handleValueChange = (index: number, newValue: string) => {
    const nextEntries = draftEntries.map((entry, i) =>
      i === index ? ([entry[0], newValue] as [string, string]) : entry
    );
    updateEntries(nextEntries);
  };

  const handleRemove = (index: number) => {
    if (draftEntries.length <= 1) return;
    updateEntries(draftEntries.filter((_, i) => i !== index));
  };

  const handleAdd = () => {
    updateEntries([...draftEntries, ['', '']]);
  };

  return (
    <FormKeyValueListField
      dataFieldKey={field.key}
      entries={draftEntries}
      onKeyChange={handleKeyChange}
      onValueChange={handleValueChange}
      onRemove={handleRemove}
      onAdd={handleAdd}
      addButtonLabel="Add Selector"
      removeButtonLabel="Remove Selector"
      showInlineKeyValueLabels
      leftAlignEmptyStateActions
      addGhostText="Add selector"
      canRemoveEntry={() => draftEntries.length > 1}
    />
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
  const availableVolumeNames = useMemo(() => {
    const templateVolumes = getFieldValue(yamlContent, ['spec', 'template', 'spec', 'volumes']);
    if (!Array.isArray(templateVolumes)) return [] as string[];
    const names = new Set<string>();
    for (const volume of templateVolumes) {
      if (!volume || typeof volume !== 'object' || Array.isArray(volume)) continue;
      const name = String((volume as Record<string, unknown>).name ?? '').trim();
      if (name) names.add(name);
    }
    return Array.from(names);
  }, [yamlContent]);

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
          <FormCompactNumberInput
            dataFieldKey={subField.key}
            value={stringValue}
            placeholder={subField.placeholder}
            min={subField.min}
            max={subField.max}
            integer={subField.integer}
            onChange={(e) => {
              const parsed = parseCompactNumberValue(
                e.target.value,
                {
                  min: subField.min,
                  max: subField.max,
                  integer: subField.integer,
                },
                { allowEmpty: true }
              );
              if (parsed === null) return;
              handleSubFieldChange(itemIndex, subField, parsed);
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
        const resources =
          subValue && typeof subValue === 'object' && !Array.isArray(subValue)
            ? (subValue as Record<string, unknown>)
            : undefined;
        const visibilityKey = `${itemIndex}:${subField.key}`;
        const visibilityOverride = resourceFieldsVisible[visibilityKey];
        const hasAnyValue = hasContainerResourceValues(resources);
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
        const handleRemoveResources = (hasAnyValue: boolean) => {
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

        return (
          <FormContainerResourcesField
            dataFieldKey={subField.key}
            resources={resources}
            showFields={showFields}
            onShowFields={() =>
              setResourceFieldsVisible((previous) => ({
                ...previous,
                [visibilityKey]: true,
              }))
            }
            onRemoveResources={handleRemoveResources}
            onResourceValueChange={handleResourceValueChange}
          />
        );
      }
      case 'volume-source': {
        const currentSource = getCurrentVolumeSource(item);
        const effectiveSource =
          currentSource ?? getVolumeSourceDefinition(DEFAULT_VOLUME_SOURCE_KEY);
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
        const configMapItems =
          effectiveSource.key === 'configMap' &&
          Array.isArray(getNestedValue(item, ['configMap', 'items']))
            ? (getNestedValue(item, ['configMap', 'items']) as Record<string, unknown>[])
            : [];
        const secretItems =
          effectiveSource.key === 'secret' &&
          Array.isArray(getNestedValue(item, ['secret', 'items']))
            ? (getNestedValue(item, ['secret', 'items']) as Record<string, unknown>[])
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

        /** Persist Secret items while preserving selected source and clearing other source roots. */
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
              <span className="resource-form-nested-group-label">{extraField.label}</span>
              {extraField.type === 'select' ? (
                <div className="resource-form-volume-source-extra-dropdown">
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
                  <span className="resource-form-nested-group-label">
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
              <FormNestedListField
                dataFieldKey="configMapItems"
                items={configMapItems}
                addLabel="Add item"
                removeLabel="Remove Items"
                onAdd={handleConfigMapAddItem}
                onRemove={handleConfigMapRemoveItem}
                leftAlignEmptyStateActions
                addGhostText="Add item"
                renderFields={(entry, rowIndex) => {
                  const itemKey = String(getNestedValue(entry, ['key']) ?? '');
                  const itemPath = String(getNestedValue(entry, ['path']) ?? '');
                  const itemMode = String(getNestedValue(entry, ['mode']) ?? '');

                  return (
                    <>
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
                        <FormCompactNumberInput
                          value={itemMode}
                          dataFieldKey="configMapItemMode"
                          placeholder="420"
                          min={0}
                          max={511}
                          integer
                          onChange={(e) => {
                            const parsed = parseCompactNumberValue(
                              e.target.value,
                              { min: 0, max: 511, integer: true },
                              { allowEmpty: true }
                            );
                            if (parsed === null) return;
                            handleConfigMapItemChange(rowIndex, ['mode'], parsed);
                          }}
                        />
                      </div>
                    </>
                  );
                }}
              />
            )}

            {effectiveSource.key === 'secret' && (
              <FormNestedListField
                dataFieldKey="secretItems"
                items={secretItems}
                addLabel="Add item"
                removeLabel="Remove Items"
                onAdd={handleSecretAddItem}
                onRemove={handleSecretRemoveItem}
                leftAlignEmptyStateActions
                addGhostText="Add item"
                renderFields={(entry, rowIndex) => {
                  const itemKey = String(getNestedValue(entry, ['key']) ?? '');
                  const itemPath = String(getNestedValue(entry, ['path']) ?? '');
                  const itemMode = String(getNestedValue(entry, ['mode']) ?? '');

                  return (
                    <>
                      <div
                        data-field-key="secretItemKey"
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
                            handleSecretItemChange(rowIndex, ['key'], e.target.value)
                          }
                        />
                      </div>
                      <div
                        data-field-key="secretItemPath"
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
                            handleSecretItemChange(rowIndex, ['path'], e.target.value)
                          }
                        />
                      </div>
                      <div
                        data-field-key="secretItemMode"
                        className="resource-form-nested-group-field"
                      >
                        <label className="resource-form-nested-group-label">Mode</label>
                        <FormCompactNumberInput
                          dataFieldKey="secretItemMode"
                          value={itemMode}
                          placeholder="420"
                          min={0}
                          max={511}
                          integer
                          onChange={(event) => {
                            const parsed = parseCompactNumberValue(
                              event.target.value,
                              { min: 0, max: 511, integer: true },
                              { allowEmpty: true }
                            );
                            if (parsed === null) return;
                            handleSecretItemChange(rowIndex, ['mode'], parsed);
                          }}
                        />
                      </div>
                    </>
                  );
                }}
              />
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
          <FormKeyValueListField
            dataFieldKey={subField.key}
            entries={entries}
            onKeyChange={handleKeyChange}
            onValueChange={handleValueChange}
            onRemove={handleRemove}
            onAdd={handleAdd}
            addButtonLabel={nestedAddLabel}
            removeButtonLabel={nestedRemoveLabel}
          />
        );
      }
      case 'group-list': {
        const nestedItems = Array.isArray(subValue) ? (subValue as Record<string, unknown>[]) : [];
        const nestedTerminalPath = subField.path[subField.path.length - 1];
        const isVolumeMountsList = nestedTerminalPath === 'volumeMounts';
        const disableVolumeMountAdd = isVolumeMountsList && availableVolumeNames.length === 0;
        const leftAlignNestedEmptyActions =
          nestedTerminalPath === 'ports' ||
          nestedTerminalPath === 'env' ||
          nestedTerminalPath === 'volumeMounts';
        const nestedAddGhostText =
          nestedTerminalPath === 'ports'
            ? 'Add port'
            : nestedTerminalPath === 'env'
              ? 'Add env var'
              : nestedTerminalPath === 'volumeMounts'
                ? disableVolumeMountAdd
                  ? 'Add a Volume below to enable Volume Mounts'
                  : 'Add volume mount'
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
          if (disableVolumeMountAdd) return;
          const defaultItem = (subField.defaultValue ?? {}) as Record<string, unknown>;
          updateNestedItems([...nestedItems, { ...defaultItem }]);
        };

        const updateNestedItem = (
          nestedIndex: number,
          updater: (nestedItem: Record<string, unknown>) => Record<string, unknown>
        ) => {
          const updated = nestedItems.map((nestedItem, i) =>
            i === nestedIndex ? updater(nestedItem) : nestedItem
          );
          updateNestedItems(updated);
        };

        /** Render a nested leaf input inside the nested group-list. */
        const renderNestedLeafField = (
          nestedField: FormFieldDefinition,
          nestedItem: Record<string, unknown>,
          nestedIndex: number
        ): React.ReactNode => {
          const nestedValue = getNestedValue(nestedItem, nestedField.path);
          const nestedStringValue = nestedValue != null ? String(nestedValue) : '';

          if (isVolumeMountsList && nestedField.key === 'name') {
            const options: DropdownOption[] = [
              { value: '', label: '-----' },
              ...availableVolumeNames.map((name) => ({ value: name, label: name })),
            ];
            if (
              nestedStringValue.trim() !== '' &&
              !options.some((option) => option.value === nestedStringValue)
            ) {
              options.push({ value: nestedStringValue, label: nestedStringValue });
            }
            return (
              <div data-field-key={nestedField.key} className="resource-form-dropdown">
                <Dropdown
                  options={options}
                  value={nestedStringValue}
                  onChange={(nextValue) => {
                    const normalized = Array.isArray(nextValue) ? (nextValue[0] ?? '') : nextValue;
                    handleNestedFieldChange(nestedIndex, nestedField, normalized);
                  }}
                  ariaLabel={nestedField.label}
                />
              </div>
            );
          }

          if (isVolumeMountsList && nestedField.key === 'readOnly') {
            const checked = getNestedValue(nestedItem, ['readOnly']) === true;
            const handleReadOnlyChange = (nextChecked: boolean) => {
              updateNestedItem(nestedIndex, (currentNestedItem) => {
                if (nextChecked) {
                  return setNestedValue(currentNestedItem, ['readOnly'], true);
                }
                return unsetNestedValue(currentNestedItem, ['readOnly']);
              });
            };
            return (
              <input
                type="checkbox"
                className="resource-form-checkbox"
                data-field-key="readOnly"
                checked={checked}
                onChange={(event) => handleReadOnlyChange(event.target.checked)}
                onClick={(event) =>
                  handleReadOnlyChange((event.currentTarget as HTMLInputElement).checked)
                }
              />
            );
          }

          if (isVolumeMountsList && nestedField.key === 'subPath') {
            const usesSubPathExpr = getNestedValue(nestedItem, ['subPathExpr']) !== undefined;
            const pathKey = usesSubPathExpr ? 'subPathExpr' : 'subPath';
            const pathValue = String(getNestedValue(nestedItem, [pathKey]) ?? '');
            const handleSubPathExprToggle = (nextUsesSubPathExpr: boolean) => {
              updateNestedItem(nestedIndex, (currentNestedItem) => {
                const currentSubPath = String(getNestedValue(currentNestedItem, ['subPath']) ?? '');
                const currentSubPathExpr = String(
                  getNestedValue(currentNestedItem, ['subPathExpr']) ?? ''
                );
                const nextValue = nextUsesSubPathExpr ? currentSubPath : currentSubPathExpr;
                let nextNestedItem = unsetNestedValue(currentNestedItem, ['subPath']);
                nextNestedItem = unsetNestedValue(nextNestedItem, ['subPathExpr']);
                if (nextValue.trim() === '') {
                  return nextNestedItem;
                }
                return setNestedValue(
                  nextNestedItem,
                  [nextUsesSubPathExpr ? 'subPathExpr' : 'subPath'],
                  nextValue
                );
              });
            };

            return (
              <div className="resource-form-volume-mount-subpath-control">
                <input
                  type="text"
                  className="resource-form-input"
                  data-field-key="subPath"
                  value={pathValue}
                  placeholder={nestedField.placeholder}
                  {...INPUT_BEHAVIOR_PROPS}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    updateNestedItem(nestedIndex, (currentNestedItem) => {
                      let nextNestedItem = unsetNestedValue(currentNestedItem, ['subPath']);
                      nextNestedItem = unsetNestedValue(nextNestedItem, ['subPathExpr']);
                      if (nextValue.trim() === '') {
                        return nextNestedItem;
                      }
                      return setNestedValue(nextNestedItem, [pathKey], nextValue);
                    });
                  }}
                />
                <label className="resource-form-volume-mount-subpath-toggle">
                  <input
                    type="checkbox"
                    data-field-key="subPathExprToggle"
                    checked={usesSubPathExpr}
                    onChange={(event) => handleSubPathExprToggle(event.target.checked)}
                    onClick={(event) =>
                      handleSubPathExprToggle((event.currentTarget as HTMLInputElement).checked)
                    }
                  />
                  <span>Expr</span>
                </label>
              </div>
            );
          }

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
                <FormCompactNumberInput
                  dataFieldKey={nestedField.key}
                  value={nestedStringValue}
                  placeholder={nestedField.placeholder}
                  min={nestedField.min}
                  max={nestedField.max}
                  integer={nestedField.integer}
                  onChange={(e) => {
                    const parsed = parseCompactNumberValue(
                      e.target.value,
                      {
                        min: nestedField.min,
                        max: nestedField.max,
                        integer: nestedField.integer,
                      },
                      { allowEmpty: true }
                    );
                    if (parsed === null) return;
                    handleNestedFieldChange(nestedIndex, nestedField, parsed);
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
          <FormNestedListField
            dataFieldKey={subField.key}
            items={nestedItems}
            addLabel={`Add ${subField.label}`}
            removeLabel={`Remove ${subField.label}`}
            onAdd={handleNestedAdd}
            onRemove={handleNestedRemove}
            leftAlignEmptyStateActions={leftAlignNestedEmptyActions}
            addGhostText={nestedAddGhostText}
            addDisabled={disableVolumeMountAdd}
            renderFields={(nestedItem, nestedIndex) => (
              <>
                {subField.fields?.map((nestedField) => (
                  <div
                    key={nestedField.key}
                    data-field-key={nestedField.key}
                    className="resource-form-nested-group-field"
                  >
                    <label className="resource-form-nested-group-label">{nestedField.label}</label>
                    {renderNestedLeafField(nestedField, nestedItem, nestedIndex)}
                  </div>
                ))}
              </>
            )}
          />
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
                <FormFieldRow key={subField.key} label={subField.label}>
                  {renderSubField(subField, item, itemIndex)}
                </FormFieldRow>
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
  namespaceOptions = [],
  onNamespaceChange,
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
        <FormSectionCard key={section.title} title={section.title}>
          {section.fields.map((field) => {
            const useFullWidthLayout = field.key === 'containers' || field.key === 'volumes';
            return (
              <FormFieldRow key={field.key} label={field.label} fullWidth={useFullWidthLayout}>
                <FieldRenderer
                  field={field}
                  yamlContent={yamlContent}
                  onYamlChange={onYamlChange}
                  namespaceOptions={namespaceOptions}
                  onNamespaceChange={onNamespaceChange}
                />
              </FormFieldRow>
            );
          })}
        </FormSectionCard>
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
  namespaceOptions,
  onNamespaceChange,
}: {
  field: FormFieldDefinition;
  yamlContent: string;
  onYamlChange: (yaml: string) => void;
  namespaceOptions?: DropdownOption[];
  onNamespaceChange?: (namespace: string) => void;
}): React.ReactElement | null {
  switch (field.type) {
    case 'text':
      return <TextField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />;
    case 'number':
      return <NumberField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />;
    case 'select':
      return <SelectField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />;
    case 'namespace-select':
      return (
        <NamespaceSelectField
          field={field}
          yamlContent={yamlContent}
          onYamlChange={onYamlChange}
          namespaceOptions={namespaceOptions}
          onNamespaceChange={onNamespaceChange}
        />
      );
    case 'textarea':
      return <TextareaField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />;
    case 'key-value-list':
      return (
        <KeyValueListField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />
      );
    case 'selector-list':
      return (
        <SelectorListField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />
      );
    case 'group-list':
      return <GroupListField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />;
    default:
      return null;
  }
}
