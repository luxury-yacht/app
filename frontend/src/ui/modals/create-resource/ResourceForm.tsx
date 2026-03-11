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
import { getFieldValue, setFieldValue, unsetFieldValue } from './yamlSync';
import type { ResourceFormDefinition, FormFieldDefinition } from './formDefinitions';
import { FormIconActionButton } from './FormActionPrimitives';
import { FormCompactNumberInput, parseCompactNumberValue } from './FormCompactNumberInput';
import { FormCommandInputField } from './FormCommandInputField';
import {
  FormContainerResourcesField,
  hasContainerResourceValues,
} from './FormContainerResourcesField';
import { FormProbeField } from './FormProbeField';
import { FormFieldRow } from './FormFieldRow';
import { FormKeyValueListField } from './FormKeyValueListField';
import { NestedGroupListField } from './NestedGroupListField';
import { FormSectionCard } from './FormSectionCard';
import { FormVolumeSourceField } from './FormVolumeSourceField';
import {
  INPUT_BEHAVIOR_PROPS,
  getNestedValue,
  setNestedValue,
  unsetNestedValue,
  toStringMap,
  toMapEntries,
  toPersistedMap,
  arePersistedMapsEqual,
  fixedWidthStyle,
  shouldOmitEmptyValue,
  buildSelectOptions,
  getSelectFieldValue,
} from './formUtils';
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

const DEFAULT_SELECTOR_ENTRY: [string, string] = ['app.kubernetes.io/name', ''];

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
  const mirrorPathsRef = useRef(field.mirrorPaths);
  const omitRef = useRef(field.required !== true && field.omitIfEmpty !== false);
  yamlRef.current = yamlContent;
  onChangeRef.current = onYamlChange;
  pathRef.current = field.path;
  mirrorPathsRef.current = field.mirrorPaths;
  omitRef.current = field.required !== true && field.omitIfEmpty !== false;

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const allPaths = [pathRef.current, ...(mirrorPathsRef.current ?? [])];
      // When the value is blank and the field should omit empties, remove the
      // key from YAML instead of writing an empty string.
      if (omitRef.current && target.value.trim() === '') {
        let nextYaml = yamlRef.current;
        for (const p of allPaths) {
          const updated = unsetFieldValue(nextYaml, p);
          if (updated !== null) nextYaml = updated;
        }
        onChangeRef.current(nextYaml);
        return;
      }
      let nextYaml = yamlRef.current;
      for (const p of allPaths) {
        const updated = setFieldValue(nextYaml, p, target.value);
        if (updated !== null) nextYaml = updated;
      }
      onChangeRef.current(nextYaml);
    };
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      className="resource-form-input"
      style={fixedWidthStyle(field)}
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
  const omitRef = useRef(field.required !== true && field.omitIfEmpty !== false);
  yamlRef.current = yamlContent;
  onChangeRef.current = onYamlChange;
  pathRef.current = field.path;
  minRef.current = field.min;
  maxRef.current = field.max;
  integerRef.current = field.integer;
  omitRef.current = field.required !== true && field.omitIfEmpty !== false;

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

      // When the field is cleared and should omit empties, remove the key
      // from YAML instead of writing an empty string.
      if (parsed === '' && omitRef.current) {
        const updated = unsetFieldValue(yamlRef.current, pathRef.current);
        if (updated !== null) onChangeRef.current(updated);
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
      style={fixedWidthStyle(field)}
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
    <div
      data-field-key={field.key}
      className="resource-form-dropdown"
      style={fixedWidthStyle(field.dropdownWidth ? { inputWidth: field.dropdownWidth } : field)}
    >
      <Dropdown
        options={options}
        value={effectiveValue}
        onChange={(nextValue) => {
          const normalized = Array.isArray(nextValue) ? (nextValue[0] ?? '') : nextValue;
          // When the user selects the empty "-----" option, remove the key
          // from YAML instead of writing an empty string.
          if (normalized === '') {
            let nextYaml = yamlContent;
            // Unset the field itself first, then any additional clearPaths.
            const pathsToUnset = [field.path, ...(field.clearPaths ?? [])];
            for (const p of pathsToUnset) {
              const updated = unsetFieldValue(nextYaml, p);
              if (updated !== null) nextYaml = updated;
            }
            onYamlChange(nextYaml);
            return;
          }
          let nextYaml = yamlContent;
          const updated = setFieldValue(nextYaml, field.path, normalized);
          if (updated !== null) nextYaml = updated;
          // Clear paths associated with the selected value (e.g., remove rollingUpdate when Recreate).
          const valueClearPaths = field.clearPathsOnValues?.[normalized];
          if (valueClearPaths) {
            for (const p of valueClearPaths) {
              const cleared = unsetFieldValue(nextYaml, p);
              if (cleared !== null) nextYaml = cleared;
            }
          }
          onYamlChange(nextYaml);
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
 * String-list field component. Displays a comma-separated text input
 * that reads/writes as a YAML sequence (string[]).
 */
function StringListField({
  field,
  yamlContent,
  onYamlChange,
}: {
  field: FormFieldDefinition;
  yamlContent: string;
  onYamlChange: (yaml: string) => void;
}): React.ReactElement {
  const value = getFieldValue(yamlContent, field.path);
  const stringValue = Array.isArray(value) ? (value as string[]).join(', ') : '';

  const yamlRef = useRef(yamlContent);
  const onChangeRef = useRef(onYamlChange);
  const pathRef = useRef(field.path);
  const omitRef = useRef(field.required !== true && field.omitIfEmpty !== false);
  yamlRef.current = yamlContent;
  onChangeRef.current = onYamlChange;
  pathRef.current = field.path;
  omitRef.current = field.required !== true && field.omitIfEmpty !== false;

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const raw = target.value.trim();
      // Parse comma-separated values into a string array, filtering empty entries.
      const items = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
      // When empty and the field should omit empties, remove the key from YAML.
      if (items.length === 0 && omitRef.current) {
        const updated = unsetFieldValue(yamlRef.current, pathRef.current);
        if (updated !== null) onChangeRef.current(updated);
        return;
      }
      const updated = setFieldValue(yamlRef.current, pathRef.current, items);
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
      style={fixedWidthStyle(field)}
      data-field-key={field.key}
      defaultValue={stringValue}
      placeholder={field.placeholder}
      {...INPUT_BEHAVIOR_PROPS}
    />
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
  const omitRef = useRef(field.required !== true && field.omitIfEmpty !== false);
  yamlRef.current = yamlContent;
  onChangeRef.current = onYamlChange;
  pathRef.current = field.path;
  omitRef.current = field.required !== true && field.omitIfEmpty !== false;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLTextAreaElement;
      if (omitRef.current && target.value.trim() === '') {
        const updated = unsetFieldValue(yamlRef.current, pathRef.current);
        if (updated !== null) onChangeRef.current(updated);
        return;
      }
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
  const pathKey = field.path.join('.');
  const showInlineKeyValueLabels = field.inlineLabels === true;
  const leftAlignEmptyStateActions = field.leftAlignEmptyActions === true;

  // Convert the object to an array of [key, value] pairs for rendering.
  const entriesFromYaml: [string, string][] = useMemo(() => {
    return toMapEntries(rawValue).filter(([key]) => !excludedKeys.has(key));
  }, [excludedKeys, rawValue]);
  const [draftEntries, setDraftEntries] = useState<[string, string][]>(entriesFromYaml);
  const lastSyncKeyRef = useRef(`${pathKey}|${yamlContent}`);

  /**
   * Resync draft rows only when the upstream YAML/path changes.
   * Internal edits should not be overwritten until parent state updates.
   */
  useEffect(() => {
    const syncKey = `${pathKey}|${yamlContent}`;
    if (syncKey === lastSyncKeyRef.current) return;
    lastSyncKeyRef.current = syncKey;
    setDraftEntries((previousDraft) => {
      if (arePersistedMapsEqual(previousDraft, entriesFromYaml, excludedKeys)) {
        return previousDraft;
      }
      return entriesFromYaml;
    });
  }, [excludedKeys, entriesFromYaml, pathKey, yamlContent]);

  const addButtonLabel = field.addLabel ?? 'Add Entry';
  const addGhostText = field.addGhostText ?? null;
  const removeButtonLabel = addButtonLabel.replace(/^Add\b/, 'Remove');

  /** Persist rows to local draft state and YAML. */
  const updateEntries = useCallback(
    (newEntries: [string, string][]) => {
      const editableEntries = newEntries.filter(
        ([key]) => key.trim() === '' || !excludedKeys.has(key)
      );
      setDraftEntries(editableEntries);
      const nextMap = toPersistedMap(editableEntries, excludedKeys);
      const existingMap = toStringMap(getFieldValue(yamlContent, field.path));
      for (const [key, value] of Object.entries(existingMap)) {
        if (excludedKeys.has(key)) {
          nextMap[key] = value;
        }
      }
      const updated = setFieldValue(yamlContent, field.path, nextMap);
      if (updated !== null) onYamlChange(updated);
    },
    [excludedKeys, yamlContent, field.path, onYamlChange]
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
    if (field.blankNewKeys) {
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
  }, [entriesFromYaml, syncKey, yamlContent]);

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
    [field.path, field.mirrorPaths, onYamlChange, yamlContent]
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
  const hasItemTitle = !!field.itemTitleField;
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
    if (!field.itemTitleField) return `${field.label} ${itemIndex + 1}`;
    const nameValue = getNestedValue(item, [field.itemTitleField]);
    const name = String(nameValue ?? '').trim();
    return name || field.itemTitleFallback || `${field.label} ${itemIndex + 1}`;
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
            style={fixedWidthStyle(subField)}
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
            style={fixedWidthStyle(subField)}
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
          <div
            data-field-key={subField.key}
            className="resource-form-dropdown"
            style={fixedWidthStyle(subField.dropdownWidth ? { inputWidth: subField.dropdownWidth } : subField)}
          >
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
      case 'probe': {
        const probeValue =
          subValue && typeof subValue === 'object' && !Array.isArray(subValue)
            ? (subValue as Record<string, unknown>)
            : undefined;
        return (
          <FormProbeField
            dataFieldKey={subField.key}
            probe={probeValue}
            label={subField.label}
            onProbeChange={(newProbe) => handleSubFieldChange(itemIndex, subField, newProbe)}
            onRemoveProbe={() => {
              const updatedItems = items.map((currentItem, i) => {
                if (i !== itemIndex) return currentItem;
                return unsetNestedValue(currentItem, subField.path);
              });
              updateItems(updatedItems);
            }}
          />
        );
      }
      case 'volume-source':
        return (
          <FormVolumeSourceField
            item={item}
            updateItem={(updater) => {
              const newItems = items.map((it, i) => (i === itemIndex ? updater(it) : it));
              updateItems(newItems);
            }}
            dataFieldKey={subField.key}
            ariaLabel={subField.label}
          />
        );
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
        return (
          <NestedGroupListField
            subField={subField}
            nestedItems={nestedItems}
            yamlContent={yamlContent}
            onNestedItemsChange={(newItems) => handleSubFieldChange(itemIndex, subField, newItems)}
          />
        );
      }
      case 'string-list': {
        // Comma-separated text input that reads/writes a YAML sequence.
        const listItems = Array.isArray(subValue) ? (subValue as string[]) : [];
        const csvValue = listItems.join(', ');
        return (
          <input
            type="text"
            className="resource-form-input"
            style={fixedWidthStyle(subField)}
            data-field-key={subField.key}
            value={csvValue}
            placeholder={subField.placeholder}
            {...INPUT_BEHAVIOR_PROPS}
            onChange={(e) => {
              const raw = e.target.value.trim();
              const items = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
              handleSubFieldChange(itemIndex, subField, items);
            }}
          />
        );
      }
      case 'command-input':
        return (
          <FormCommandInputField
            field={subField}
            value={subValue}
            onChange={(newValue) => handleSubFieldChange(itemIndex, subField, newValue)}
            onAdd={() => {
              // Set an empty array directly, bypassing shouldOmitEmptyValue.
              const updatedItems = items.map((currentItem, i) => {
                if (i !== itemIndex) return currentItem;
                return setNestedValue(currentItem, subField.path, []);
              });
              updateItems(updatedItems);
            }}
            onRemove={() => {
              const updatedItems = items.map((currentItem, i) => {
                if (i !== itemIndex) return currentItem;
                return unsetNestedValue(currentItem, subField.path);
              });
              updateItems(updatedItems);
            }}
          />
        );
      default:
        if (process.env.NODE_ENV !== 'production') {
          console.warn(
            `GroupListField: unhandled sub-field type "${subField.type}" for key "${subField.key}"`
          );
        }
        return null;
    }
  };

  return (
    <div data-field-key={field.key} className="resource-form-group-container">
      {items.map((item, itemIndex) => (
        <div key={itemIndex} className="resource-form-group-entry">
          <div className="resource-form-group-item">
            <div
              className={`resource-form-group-item-header${hasItemTitle ? ' resource-form-group-item-header--container' : ''}`}
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
                  label={`Remove ${field.itemTitleFallback || field.label}`}
                  onClick={() => handleRemoveItem(itemIndex)}
                />
              </div>
            </div>
            <div className="resource-form-group-item-fields">
              {(() => {
                const subFields = field.fields ?? [];
                const rows: React.ReactNode[] = [];
                let i = 0;
                while (i < subFields.length) {
                  const subField = subFields[i];
                  // When groupWithNext is set, combine this field and the next
                  // into a single row so they render side by side.
                  if (subField.groupWithNext && i + 1 < subFields.length) {
                    const nextField = subFields[i + 1];
                    rows.push(
                      <FormFieldRow key={subField.key} label={subField.label}>
                        {renderSubField(subField, item, itemIndex)}
                        <FormFieldRow label={nextField.label} className="resource-form-field--inline">
                          {renderSubField(nextField, item, itemIndex)}
                        </FormFieldRow>
                      </FormFieldRow>
                    );
                    i += 2;
                  } else {
                    rows.push(
                      <FormFieldRow key={subField.key} label={subField.label}>
                        {renderSubField(subField, item, itemIndex)}
                      </FormFieldRow>
                    );
                    i += 1;
                  }
                }
                return rows;
              })()}
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
    <div className="resource-form" data-tab-native="true">
      {definition.sections.map((section) => {
        // Filter out fields whose visibleWhen condition is not met.
        // Track original indices so groupWithNext only chains originally-adjacent fields.
        const visibleWithIndices = section.fields
          .map((f, idx) => ({ field: f, originalIndex: idx }))
          .filter(({ field: f }) => {
            if (!f.visibleWhen) return true;
            const currentValue = getFieldValue(yamlContent, f.visibleWhen.path);
            const strValue = currentValue != null ? String(currentValue) : '';
            return f.visibleWhen.values.includes(strValue);
          });
        const sectionFields = visibleWithIndices.map(({ field: f }) => f);
        const originalIndices = visibleWithIndices.map(({ originalIndex }) => originalIndex);
        const rows: React.ReactElement[] = [];
        let i = 0;
        while (i < sectionFields.length) {
          const field = sectionFields[i];
          const useFullWidthLayout = field.fullWidth === true;

          // Collect consecutive groupWithNext fields into a single row.
          // Only chain fields that were originally adjacent (not brought together by filtering).
          if (field.groupWithNext && i + 1 < sectionFields.length &&
              originalIndices[i + 1] === originalIndices[i] + 1) {
            const grouped: FormFieldDefinition[] = [field];
            while (
              i + grouped.length < sectionFields.length &&
              sectionFields[i + grouped.length - 1].groupWithNext &&
              originalIndices[i + grouped.length] === originalIndices[i + grouped.length - 1] + 1
            ) {
              grouped.push(sectionFields[i + grouped.length]);
            }
            const firstField = grouped[0];
            const isIndented = firstField.indented === true;
            rows.push(
              <FormFieldRow key={firstField.key} label={isIndented ? '' : firstField.label} tooltip={isIndented ? undefined : firstField.tooltip}>
                {isIndented ? (
                  <FormFieldRow label={firstField.label} className="resource-form-field--inline">
                    <FieldRenderer
                      field={firstField}
                      yamlContent={yamlContent}
                      onYamlChange={onYamlChange}
                      namespaceOptions={namespaceOptions}
                      onNamespaceChange={onNamespaceChange}
                    />
                  </FormFieldRow>
                ) : (
                  <FieldRenderer
                    field={firstField}
                    yamlContent={yamlContent}
                    onYamlChange={onYamlChange}
                    namespaceOptions={namespaceOptions}
                    onNamespaceChange={onNamespaceChange}
                  />
                )}
                {grouped.slice(1).map((gf) => (
                  <FormFieldRow key={gf.key} label={gf.label} tooltip={gf.tooltip} className="resource-form-field--inline">
                    <FieldRenderer
                      field={gf}
                      yamlContent={yamlContent}
                      onYamlChange={onYamlChange}
                      namespaceOptions={namespaceOptions}
                      onNamespaceChange={onNamespaceChange}
                    />
                  </FormFieldRow>
                ))}
              </FormFieldRow>
            );
            i += grouped.length;
          } else {
            // Indented fields hide the label and show empty space in its place.
            const label = field.indented ? '' : field.label;
            rows.push(
              <FormFieldRow key={field.key} label={label} tooltip={field.tooltip} fullWidth={useFullWidthLayout}>
                <FieldRenderer
                  field={field}
                  yamlContent={yamlContent}
                  onYamlChange={onYamlChange}
                  namespaceOptions={namespaceOptions}
                  onNamespaceChange={onNamespaceChange}
                />
              </FormFieldRow>
            );
            i += 1;
          }
        }
        return (
          <FormSectionCard key={section.title} title={section.title} labelWidth={section.labelWidth}>
            {rows}
          </FormSectionCard>
        );
      })}
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
    case 'string-list':
      return (
        <StringListField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />
      );
    case 'command-input': {
      const cmdValue = getFieldValue(yamlContent, field.path);
      return (
        <FormCommandInputField
          field={field}
          value={cmdValue}
          onChange={(newValue) => {
            const arr = newValue as string[];
            if (shouldOmitEmptyValue(field, arr)) {
              const updated = unsetFieldValue(yamlContent, field.path);
              if (updated !== null) onYamlChange(updated);
            } else {
              const updated = setFieldValue(yamlContent, field.path, arr);
              if (updated !== null) onYamlChange(updated);
            }
          }}
        />
      );
    }
    default:
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`FieldRenderer: unhandled field type "${field.type}" for key "${field.key}"`);
      }
      return null;
  }
}
