/**
 * frontend/src/ui/modals/create-resource/NestedGroupListField.tsx
 *
 * Renders a nested group-list inside a parent GroupListField item.
 * Handles inline leaf fields (text, number, select, boolean-toggle, textarea)
 * plus dynamic options resolution and alternate-path toggles.
 */

import React from 'react';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { getFieldValue } from './yamlSync';
import type { FormFieldDefinition } from './formDefinitions';
import { FormCompactNumberInput, parseCompactNumberValue } from './FormCompactNumberInput';
import { FormNestedListField } from './FormNestedListField';
import {
  INPUT_BEHAVIOR_PROPS,
  getNestedValue,
  setNestedValue,
  unsetNestedValue,
  fixedWidthStyle,
  shouldOmitEmptyValue,
  buildSelectOptions,
  getSelectFieldValue,
  fieldFlexStyle,
} from './formUtils';

interface NestedGroupListFieldProps {
  /** The field definition for this nested group-list. */
  subField: FormFieldDefinition;
  /** The current array of nested items. */
  nestedItems: Record<string, unknown>[];
  /** Full YAML content (needed for resolving dynamic options). */
  yamlContent: string;
  /** Callback to write the updated nested array back to the parent item. */
  onNestedItemsChange: (newItems: Record<string, unknown>[]) => void;
}

/**
 * Resolve dynamic select options from a YAML path.
 * Returns static options from the field definition if no dynamic path is set.
 */
function resolveDynamicOptions(
  nestedField: FormFieldDefinition,
  currentValue: string,
  yamlContent: string
): DropdownOption[] {
  if (!nestedField.dynamicOptionsPath || !nestedField.dynamicOptionsField) {
    return buildSelectOptions(nestedField);
  }
  const sourceArray = getFieldValue(yamlContent, nestedField.dynamicOptionsPath);
  const names: string[] = [];
  if (Array.isArray(sourceArray)) {
    for (const entry of sourceArray) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const name = String(
        (entry as Record<string, unknown>)[nestedField.dynamicOptionsField] ?? ''
      ).trim();
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
}

/**
 * NestedGroupListField — renders a nested group-list inside a parent
 * GroupListField card. Each row is a set of inline leaf fields
 * (text, number, select, boolean-toggle, textarea) with add/remove controls.
 */
export function NestedGroupListField({
  subField,
  nestedItems,
  yamlContent,
  onNestedItemsChange,
}: NestedGroupListFieldProps): React.ReactElement {
  // Disable adding nested items when a dynamic-options field has no available options.
  const dynamicField = subField.fields?.find((f) => f.dynamicOptionsPath);
  const disableAdd =
    dynamicField !== undefined &&
    resolveDynamicOptions(dynamicField, '', yamlContent).length <= 1;
  const leftAlignNestedEmptyActions = subField.leftAlignEmptyActions === true;
  const nestedAddGhostText = disableAdd
    ? (subField.disabledGhostText ?? null)
    : (subField.addGhostText ?? null);

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
    onNestedItemsChange(updated);
  };

  /** Remove a nested row. */
  const handleNestedRemove = (nestedIndex: number) => {
    onNestedItemsChange(nestedItems.filter((_, i) => i !== nestedIndex));
  };

  /** Add a nested row using the nested defaultValue. */
  const handleNestedAdd = () => {
    if (disableAdd) return;
    const defaultItem = (subField.defaultValue ?? {}) as Record<string, unknown>;
    onNestedItemsChange([...nestedItems, { ...defaultItem }]);
  };

  /** Update a single nested item via an updater function. */
  const updateNestedItem = (
    nestedIndex: number,
    updater: (nestedItem: Record<string, unknown>) => Record<string, unknown>
  ) => {
    const updated = nestedItems.map((nestedItem, i) =>
      i === nestedIndex ? updater(nestedItem) : nestedItem
    );
    onNestedItemsChange(updated);
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
              const currentPrimary = String(
                getNestedValue(currentNestedItem, nestedField.path) ?? ''
              );
              const currentAlternate = String(getNestedValue(currentNestedItem, altPath) ?? '');
              const nextValue = nextUsesAlternate ? currentPrimary : currentAlternate;
              let next = unsetNestedValue(currentNestedItem, nestedField.path);
              next = unsetNestedValue(next, altPath);
              if (nextValue.trim() === '') return next;
              return setNestedValue(
                next,
                [nextUsesAlternate ? altPath[0] : nestedField.path[0]],
                nextValue
              );
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
            onChange={(e) => handleNestedFieldChange(nestedIndex, nestedField, e.target.value)}
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
        const options = resolveDynamicOptions(nestedField, nestedStringValue, yamlContent);
        return (
          <div
            data-field-key={nestedField.key}
            className="resource-form-dropdown"
            style={fixedWidthStyle(nestedField)}
          >
            <Dropdown
              options={options}
              value={
                nestedField.dynamicOptionsPath
                  ? nestedStringValue
                  : getSelectFieldValue(nestedField, nestedStringValue)
              }
              onChange={(nextValue) => {
                const normalized = Array.isArray(nextValue) ? (nextValue[0] ?? '') : nextValue;
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
            onChange={(e) => handleNestedFieldChange(nestedIndex, nestedField, e.target.value)}
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
                    style={
                      nestedField.labelWidth
                        ? { minWidth: nestedField.labelWidth }
                        : undefined
                    }
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
