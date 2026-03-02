/**
 * frontend/src/ui/modals/create-resource/ResourceForm.tsx
 *
 * Generic form renderer component that reads a ResourceFormDefinition
 * and renders form inputs. The component reads values from YAML via
 * getFieldValue and writes changes via setFieldValue.
 */

import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import * as YAML from 'yaml';
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
  yamlRef.current = yamlContent;
  onChangeRef.current = onYamlChange;
  pathRef.current = field.path;

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const raw = target.value;
      const num = Number(raw);
      const parsed = raw === '' ? '' : isNaN(num) ? raw : num;
      const updated = setFieldValue(yamlRef.current, pathRef.current, parsed);
      if (updated !== null) onChangeRef.current(updated);
    };
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, []);

  return (
    <input
      ref={inputRef}
      type="number"
      className="resource-form-input"
      data-field-key={field.key}
      defaultValue={stringValue}
      placeholder={field.placeholder}
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

  const yamlRef = useRef(yamlContent);
  const onChangeRef = useRef(onYamlChange);
  const pathRef = useRef(field.path);
  yamlRef.current = yamlContent;
  onChangeRef.current = onYamlChange;
  pathRef.current = field.path;

  const selectRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    const el = selectRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLSelectElement;
      const updated = setFieldValue(yamlRef.current, pathRef.current, target.value);
      if (updated !== null) onChangeRef.current(updated);
    };
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, []);

  return (
    <select
      ref={selectRef}
      className="resource-form-select"
      data-field-key={field.key}
      defaultValue={stringValue}
    >
      <option value="">-- Select --</option>
      {field.options?.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
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
    const newEntries: [string, string][] = [...entries, ['', '']];
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
        + Add Entry
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
            onChange={(e) => {
              const raw = e.target.value;
              const num = Number(raw);
              const parsed = raw === '' ? '' : isNaN(num) ? raw : num;
              handleSubFieldChange(itemIndex, subField, parsed);
            }}
          />
        );
      case 'select':
        return (
          <select
            className="resource-form-select"
            data-field-key={subField.key}
            value={stringValue}
            onChange={(e) =>
              handleSubFieldChange(itemIndex, subField, e.target.value)
            }
          >
            <option value="">-- Select --</option>
            {subField.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
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
      default:
        return null;
    }
  };

  return (
    <div data-field-key={field.key} className="resource-form-group-container">
      {items.map((item, itemIndex) => (
        <div key={itemIndex} className="resource-form-group-item">
          <div className="resource-form-group-item-header">
            <span className="resource-form-group-item-title">
              {field.label} {itemIndex + 1}
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
      ))}
      <button type="button" className="resource-form-add-btn" onClick={handleAddItem}>
        + Add {field.label}
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
          {section.fields.map((field) => (
            <div key={field.key} className="resource-form-field">
              <label className="resource-form-label">{field.label}</label>
              <FieldRenderer
                field={field}
                yamlContent={yamlContent}
                onYamlChange={onYamlChange}
              />
            </div>
          ))}
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
