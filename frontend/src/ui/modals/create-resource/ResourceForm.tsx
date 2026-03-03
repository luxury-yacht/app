/**
 * frontend/src/ui/modals/create-resource/ResourceForm.tsx
 *
 * Generic form renderer component that reads a ResourceFormDefinition
 * and renders form inputs. The component reads values from YAML via
 * getFieldValue and writes changes via setFieldValue.
 */

import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import * as YAML from 'yaml';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { CloseIcon } from '@shared/components/icons/MenuIcons';
import { getFieldValue, setFieldValue } from './yamlSync';
import type {
  ResourceFormDefinition,
  FormFieldDefinition,
} from './formDefinitions';
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
        typeof min === 'number' && min >= 0
          ? digitsOnly.replace(/-/g, '')
          : digitsOnly;

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
          const normalized = Array.isArray(nextValue) ? nextValue[0] ?? '' : nextValue;
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

  // Convert the object to an array of [key, value] pairs for rendering.
  const entries: [string, string][] = useMemo(() => {
    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      return Object.entries(rawValue as Record<string, unknown>).map(([k, v]) => [
        k,
        String(v ?? ''),
      ]);
    }
    return [];
  }, [rawValue]);

  /**
   * Resolve the add-button label for key-value lists.
   * Labels and annotations use explicit wording; other maps stay generic.
   */
  const addButtonLabel = useMemo(() => {
    const terminalPath = field.path[field.path.length - 1];
    if (terminalPath === 'labels') return 'Add Label';
    if (terminalPath === 'annotations') return 'Add Annotation';
    return 'Add Entry';
  }, [field.path]);

  /** Rebuild the object from the entries array and write it back to YAML. */
  const updateEntries = useCallback(
    (newEntries: [string, string][]) => {
      const obj: Record<string, string> = {};
      for (const [k, v] of newEntries) {
        if (k) obj[k] = v;
      }
      const updated = setFieldValue(yamlContent, field.path, obj);
      if (updated !== null) onYamlChange(updated);
    },
    [yamlContent, field.path, onYamlChange]
  );

  /** Handle key change for a specific row. */
  const handleKeyChange = (index: number, newKey: string) => {
    const newEntries = entries.map((entry, i) =>
      i === index ? ([newKey, entry[1]] as [string, string]) : entry
    );
    updateEntries(newEntries);
  };

  /** Handle value change for a specific row. */
  const handleValueChange = (index: number, newValue: string) => {
    const newEntries = entries.map((entry, i) =>
      i === index ? ([entry[0], newValue] as [string, string]) : entry
    );
    updateEntries(newEntries);
  };

  /** Remove a row. */
  const handleRemove = (index: number) => {
    const newEntries = entries.filter((_, i) => i !== index);
    updateEntries(newEntries);
  };

  /** Add a new empty row. */
  const handleAdd = () => {
    const terminalPath = field.path[field.path.length - 1];
    const baseKey =
      terminalPath === 'labels'
        ? 'label-key'
        : terminalPath === 'annotations'
          ? 'annotation-key'
          : 'key';
    const existingKeys = new Set(entries.map(([k]) => k));
    let candidate = baseKey;
    let suffix = 2;
    while (existingKeys.has(candidate)) {
      candidate = `${baseKey}-${suffix}`;
      suffix += 1;
    }
    const newEntries: [string, string][] = [...entries, [candidate, '']];
    updateEntries(newEntries);
  };

  return (
    <div data-field-key={field.key} className="resource-form-kv-container">
      {entries.map(([k, v], index) => (
        <div key={index} className="resource-form-kv-row">
          <input
            type="text"
            className="resource-form-input"
            value={k}
            placeholder="Key"
            onChange={(e) => handleKeyChange(index, e.target.value)}
          />
          <input
            type="text"
            className="resource-form-input"
            value={v}
            placeholder="Value"
            onChange={(e) => handleValueChange(index, e.target.value)}
          />
          <button
            type="button"
            className="resource-form-remove-btn"
            onClick={() => handleRemove(index)}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="resource-form-add-btn" onClick={handleAdd}>
        {addButtonLabel}
      </button>
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
    if (!isContainerGroup) return `${field.label} ${itemIndex + 1}`;
    const nameValue = getNestedValue(item, ['name']);
    const name = String(nameValue ?? '').trim();
    return name || 'Container';
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
            onChange={(e) =>
              handleSubFieldChange(itemIndex, subField, e.target.value)
            }
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
                const normalized = Array.isArray(nextValue)
                  ? nextValue[0] ?? ''
                  : nextValue;
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
            onChange={(e) =>
              handleSubFieldChange(itemIndex, subField, e.target.value)
            }
          />
        );
      case 'group-list': {
        const nestedItems = Array.isArray(subValue)
          ? (subValue as Record<string, unknown>[])
          : [];

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
                        ? nextValue[0] ?? ''
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
                  {nestedIndex === nestedItems.length - 1 && (
                    <button
                      type="button"
                      className="resource-form-add-btn resource-form-icon-btn"
                      aria-label={`Add ${subField.label}`}
                      title={`Add ${subField.label}`}
                      onClick={handleNestedAdd}
                    >
                      +
                    </button>
                  )}
                  <button
                    type="button"
                    className="resource-form-remove-btn resource-form-icon-btn"
                    aria-label={`Remove ${subField.label}`}
                    title={`Remove ${subField.label}`}
                    onClick={() => handleNestedRemove(nestedIndex)}
                  >
                    <CloseIcon width={12} height={12} />
                  </button>
                </div>
              </div>
            ))}
            {nestedItems.length === 0 && (
              <div className="resource-form-nested-group-row">
                <div className="resource-form-nested-group-fields" />
                <div className="resource-form-nested-group-row-actions">
                  <button
                    type="button"
                    className="resource-form-add-btn resource-form-icon-btn"
                    aria-label={`Add ${subField.label}`}
                    title={`Add ${subField.label}`}
                    onClick={handleNestedAdd}
                  >
                    +
                  </button>
                </div>
              </div>
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
              className={`resource-form-group-item-header${isContainerGroup ? ' resource-form-group-item-header--container' : ''}`}
            >
              <span className="resource-form-group-item-title">
                {getItemTitle(item, itemIndex)}
              </span>
              <button
                type="button"
                className="resource-form-remove-btn"
                onClick={() => handleRemoveItem(itemIndex)}
              >
                Remove
              </button>
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
      <button type="button" className="resource-form-add-btn" onClick={handleAddItem}>
        Add {field.label}
      </button>
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
            const useFullWidthLayout = field.key === 'containers';
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
      return (
        <TextField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />
      );
    case 'number':
      return (
        <NumberField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />
      );
    case 'select':
      return (
        <SelectField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />
      );
    case 'textarea':
      return (
        <TextareaField field={field} yamlContent={yamlContent} onYamlChange={onYamlChange} />
      );
    case 'key-value-list':
      return (
        <KeyValueListField
          field={field}
          yamlContent={yamlContent}
          onYamlChange={onYamlChange}
        />
      );
    case 'group-list':
      return (
        <GroupListField
          field={field}
          yamlContent={yamlContent}
          onYamlChange={onYamlChange}
        />
      );
    default:
      return null;
  }
}
