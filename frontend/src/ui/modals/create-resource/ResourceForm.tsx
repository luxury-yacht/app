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

/**
 * Decide whether an empty value should be omitted from YAML for this field.
 */
function shouldOmitEmptyValue(field: FormFieldDefinition, value: unknown): boolean {
  return field.omitIfEmpty === true && typeof value === 'string' && value.trim() === '';
}

const DEFAULT_SELECTOR_ENTRY: [string, string] = ['app.kubernetes.io/name', ''];

/**
 * Build standard dropdown options for select fields.
 * Includes an explicit empty option unless the definition opts out.
 */
function buildSelectOptions(field: FormFieldDefinition): DropdownOption[] {
  const includeEmptyOption = field.includeEmptyOption !== false;
  return [
    ...(includeEmptyOption ? [{ value: '', label: '-----' }] : []),
    ...(field.options?.map((opt) => ({
      value: opt.value,
      label: opt.label,
    })) ?? []),
  ];
}

/**
 * Normalize select value for fields that have an implicit default.
 */
function getSelectFieldValue(field: FormFieldDefinition, currentValue: string): string {
  if (field.implicitDefault && currentValue === '') {
    return field.implicitDefault;
  }
  return currentValue;
}

/**
 * Build inline style for a nested group-list field wrapper from its definition.
 * Controls the flex sizing of the wrapper div.
 */
function fieldFlexStyle(field: { fieldFlex?: string }): React.CSSProperties | undefined {
  if (!field.fieldFlex) return undefined;
  return { flex: field.fieldFlex };
}

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
          <div data-field-key={subField.key} className="resource-form-dropdown" style={fixedWidthStyle(subField)}>
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
        // Disable adding nested items when a dynamic-options field has no available options.
        const hasDynamicField = subField.fields?.some((f) => f.dynamicOptionsPath);
        const dynamicOptionsEmpty = hasDynamicField && availableVolumeNames.length === 0;
        const disableAdd = dynamicOptionsEmpty === true;
        const leftAlignNestedEmptyActions = subField.leftAlignEmptyActions === true;
        const nestedAddGhostText =
          disableAdd
            ? 'Add a Volume below to enable Volume Mounts'
            : (subField.addGhostText ?? null);

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
          if (disableAdd) return;
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

        /**
         * Resolve dynamic select options from a YAML path.
         * Returns static options from the field definition if no dynamic path is set.
         */
        const resolveDynamicOptions = (nestedField: FormFieldDefinition, currentValue: string): DropdownOption[] => {
          if (!nestedField.dynamicOptionsPath || !nestedField.dynamicOptionsField) {
            return buildSelectOptions(nestedField);
          }
          const sourceArray = getFieldValue(yamlContent, nestedField.dynamicOptionsPath);
          const names: string[] = [];
          if (Array.isArray(sourceArray)) {
            for (const entry of sourceArray) {
              if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
              const name = String((entry as Record<string, unknown>)[nestedField.dynamicOptionsField] ?? '').trim();
              if (name) names.push(name);
            }
          }
          const options: DropdownOption[] = [
            { value: '', label: '-----' },
            ...names.map((name) => ({ value: name, label: name })),
          ];
          // Preserve current value even if it's no longer in the options.
          if (currentValue.trim() !== '' && !options.some((opt) => opt.value === currentValue)) {
            options.push({ value: currentValue, label: currentValue });
          }
          return options;
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
            case 'text': {
              // Text field with alternate path toggle (e.g., subPath/subPathExpr).
              if (nestedField.alternatePath) {
                const altPath = nestedField.alternatePath;
                const usesAlternate = getNestedValue(nestedItem, altPath) !== undefined;
                const activePath = usesAlternate ? altPath : nestedField.path;
                const activeValue = String(getNestedValue(nestedItem, activePath) ?? '');
                const handleToggle = (nextUsesAlternate: boolean) => {
                  updateNestedItem(nestedIndex, (currentNestedItem) => {
                    const currentPrimary = String(getNestedValue(currentNestedItem, nestedField.path) ?? '');
                    const currentAlternate = String(getNestedValue(currentNestedItem, altPath) ?? '');
                    const nextValue = nextUsesAlternate ? currentPrimary : currentAlternate;
                    let next = unsetNestedValue(currentNestedItem, nestedField.path);
                    next = unsetNestedValue(next, altPath);
                    if (nextValue.trim() === '') return next;
                    return setNestedValue(next, [nextUsesAlternate ? altPath[0] : nestedField.path[0]], nextValue);
                  });
                };
                return (
                  <div className="resource-form-volume-mount-subpath-control">
                    <input
                      type="text"
                      className="resource-form-input"
                      style={fixedWidthStyle(nestedField)}
                      data-field-key={nestedField.key}
                      value={activeValue}
                      placeholder={nestedField.placeholder}
                      {...INPUT_BEHAVIOR_PROPS}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        updateNestedItem(nestedIndex, (currentNestedItem) => {
                          let next = unsetNestedValue(currentNestedItem, nestedField.path);
                          next = unsetNestedValue(next, altPath);
                          if (nextValue.trim() === '') return next;
                          return setNestedValue(next, activePath, nextValue);
                        });
                      }}
                    />
                    <label className="resource-form-field-label resource-form-volume-mount-subpath-toggle">
                      <input
                        type="checkbox"
                        data-field-key={`${nestedField.key}ExprToggle`}
                        checked={usesAlternate}
                        onChange={(event) => handleToggle(event.target.checked)}
                        onClick={(event) =>
                          handleToggle((event.currentTarget as HTMLInputElement).checked)
                        }
                      />
                      <span>{nestedField.alternateLabel ?? 'Use Alternate'}</span>
                    </label>
                  </div>
                );
              }
              return (
                <input
                  type="text"
                  className="resource-form-input"
                  style={fixedWidthStyle(nestedField)}
                  data-field-key={nestedField.key}
                  value={nestedStringValue}
                  placeholder={nestedField.placeholder}
                  {...INPUT_BEHAVIOR_PROPS}
                  onChange={(e) =>
                    handleNestedFieldChange(nestedIndex, nestedField, e.target.value)
                  }
                />
              );
            }
            case 'number':
              return (
                <FormCompactNumberInput
                  dataFieldKey={nestedField.key}
                  value={nestedStringValue}
                  placeholder={nestedField.placeholder}
                  min={nestedField.min}
                  max={nestedField.max}
                  integer={nestedField.integer}
                  style={fixedWidthStyle(nestedField)}
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
            case 'select': {
              const options = resolveDynamicOptions(nestedField, nestedStringValue);
              return (
                <div data-field-key={nestedField.key} className="resource-form-dropdown" style={fixedWidthStyle(nestedField)}>
                  <Dropdown
                    options={options}
                    value={nestedField.dynamicOptionsPath ? nestedStringValue : getSelectFieldValue(nestedField, nestedStringValue)}
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
            }
            case 'boolean-toggle': {
              const checked = getNestedValue(nestedItem, nestedField.path) === true;
              const handleBooleanChange = (nextChecked: boolean) => {
                updateNestedItem(nestedIndex, (currentNestedItem) => {
                  if (nextChecked) {
                    return setNestedValue(currentNestedItem, nestedField.path, true);
                  }
                  return unsetNestedValue(currentNestedItem, nestedField.path);
                });
              };
              return (
                <label className="resource-form-field-label resource-form-volume-mount-inline-toggle">
                  <input
                    type="checkbox"
                    className="resource-form-checkbox"
                    data-field-key={nestedField.key}
                    checked={checked}
                    onChange={(event) => handleBooleanChange(event.target.checked)}
                    onClick={(event) =>
                      handleBooleanChange((event.currentTarget as HTMLInputElement).checked)
                    }
                  />
                  <span>{nestedField.label}</span>
                </label>
              );
            }
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
            addDisabled={disableAdd}
            fieldGap={subField.fieldGap}
            wrapFields={subField.wrapFields}
            rowAlign={subField.rowAlign}
            renderFields={(nestedItem, nestedIndex) => (
              <>
                {subField.fields?.map((nestedField) => {
                  const hideFieldLabel = nestedField.type === 'boolean-toggle';
                  return (
                    <div
                      key={nestedField.key}
                      data-field-key={nestedField.key}
                      className={`resource-form-nested-group-field${hideFieldLabel ? ' resource-form-nested-group-field--no-label' : ''}`}
                      style={fieldFlexStyle(nestedField)}
                    >
                      {!hideFieldLabel ? (
                        <label
                          className="resource-form-field-label"
                          style={nestedField.labelWidth ? { minWidth: nestedField.labelWidth } : undefined}
                        >
                          {nestedField.label}
                        </label>
                      ) : null}
                      {renderNestedLeafField(nestedField, nestedItem, nestedIndex)}
                    </div>
                  );
                })}
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
