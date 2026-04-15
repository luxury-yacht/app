/**
 * Env var field editor.
 *
 * Renders a list of env var items, each with a name input, a source type
 * dropdown (Value/ConfigMap/Secret/Field), and dynamic fields depending on the
 * source. Handles the YAML mapping between the flat UI model and the nested
 * valueFrom.configMapKeyRef / valueFrom.secretKeyRef / valueFrom.fieldRef
 * structure.
 *
 * Uses the same FormIconActionButton add/remove pattern as every other
 * nested list field (ports, envFrom, volume mounts, etc.).
 */

import React from 'react';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import { FormEmptyActionRow, FormIconActionButton } from './FormActionPrimitives';
import { INPUT_BEHAVIOR_PROPS } from './formUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One item in the env array.
 * Uses Record<string, unknown> for the public API to match the dispatch layer's
 * untyped item model. Internally we type-narrow via getSourceType helpers.
 */
type EnvVarItem = Record<string, unknown>;

interface FormEnvVarFieldProps {
  /** data-field-key for the wrapper element. */
  dataFieldKey: string;
  /** Current env items from YAML. */
  items: EnvVarItem[];
  /** Callback when items change. */
  onChange: (newItems: EnvVarItem[]) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SourceType = 'value' | 'configMap' | 'secret' | 'fieldRef';

const sourceTypeOptions = [
  { value: 'value', label: 'Value' },
  { value: 'configMap', label: 'ConfigMap' },
  { value: 'secret', label: 'Secret' },
  { value: 'fieldRef', label: 'Field' },
];

/** Detect the source type of an env var item from its YAML structure. */
function getSourceType(item: EnvVarItem): SourceType {
  const valueFrom = item.valueFrom as Record<string, unknown> | undefined;
  if (valueFrom?.configMapKeyRef) return 'configMap';
  if (valueFrom?.secretKeyRef) return 'secret';
  if (valueFrom?.fieldRef) return 'fieldRef';
  return 'value';
}

/** Get the ref name from a configMapKeyRef or secretKeyRef. */
function getRefName(item: EnvVarItem): string {
  const valueFrom = item.valueFrom as Record<string, unknown> | undefined;
  const ref = (valueFrom?.configMapKeyRef ?? valueFrom?.secretKeyRef) as
    | { name?: string }
    | undefined;
  return ref?.name ?? '';
}

/** Get the ref key from a configMapKeyRef or secretKeyRef. */
function getRefKey(item: EnvVarItem): string {
  const valueFrom = item.valueFrom as Record<string, unknown> | undefined;
  const ref = (valueFrom?.configMapKeyRef ?? valueFrom?.secretKeyRef) as
    | { key?: string }
    | undefined;
  return ref?.key ?? '';
}

/** Get the fieldPath from a fieldRef. */
function getFieldPath(item: EnvVarItem): string {
  const valueFrom = item.valueFrom as Record<string, unknown> | undefined;
  const ref = valueFrom?.fieldRef as { fieldPath?: string } | undefined;
  return ref?.fieldPath ?? '';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FormEnvVarField({
  dataFieldKey,
  items,
  onChange,
}: FormEnvVarFieldProps): React.ReactElement {
  /** Update a single item in the list. */
  const updateItem = (index: number, updater: (item: EnvVarItem) => EnvVarItem) => {
    const newItems = items.map((it, i) => (i === index ? updater(it) : it));
    onChange(newItems);
  };

  /** Handle source type change — swap between value / configMapKeyRef / secretKeyRef / fieldRef. */
  const handleSourceTypeChange = (index: number, newType: SourceType) => {
    updateItem(index, (item) => {
      const name = (item.name as string) ?? '';
      if (newType === 'value') {
        return { name, value: '' };
      }
      if (newType === 'configMap') {
        return { name, valueFrom: { configMapKeyRef: { name: '', key: '' } } };
      }
      if (newType === 'fieldRef') {
        return { name, valueFrom: { fieldRef: { fieldPath: '' } } };
      }
      // secret
      return { name, valueFrom: { secretKeyRef: { name: '', key: '' } } };
    });
  };

  /** Handle env var name input change. */
  const handleNameChange = (index: number, newName: string) => {
    updateItem(index, (item) => ({ ...item, name: newName }));
  };

  /** Handle plain value input change. */
  const handleValueChange = (index: number, newValue: string) => {
    updateItem(index, (item) => ({ ...item, value: newValue }));
  };

  /** Handle ref name input change (ConfigMap name or Secret name). */
  const handleRefNameChange = (index: number, newRefName: string) => {
    updateItem(index, (item) => {
      const sourceType = getSourceType(item);
      const refKey = getRefKey(item);
      if (sourceType === 'configMap') {
        return { ...item, valueFrom: { configMapKeyRef: { name: newRefName, key: refKey } } };
      }
      return { ...item, valueFrom: { secretKeyRef: { name: newRefName, key: refKey } } };
    });
  };

  /** Handle ref key input change. */
  const handleRefKeyChange = (index: number, newRefKey: string) => {
    updateItem(index, (item) => {
      const sourceType = getSourceType(item);
      const refName = getRefName(item);
      if (sourceType === 'configMap') {
        return { ...item, valueFrom: { configMapKeyRef: { name: refName, key: newRefKey } } };
      }
      return { ...item, valueFrom: { secretKeyRef: { name: refName, key: newRefKey } } };
    });
  };

  /** Handle fieldPath input change (for fieldRef source type). */
  const handleFieldPathChange = (index: number, newFieldPath: string) => {
    updateItem(index, (item) => ({
      ...item,
      valueFrom: { fieldRef: { fieldPath: newFieldPath } },
    }));
  };

  /** Add a new env var item defaulting to plain value. */
  const handleAdd = () => {
    onChange([...items, { name: '', value: '' }]);
  };

  /** Remove an item by index. */
  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div data-field-key={dataFieldKey} className="resource-form-env-var">
      {items.map((item, index) => {
        const sourceType = getSourceType(item);
        const envName = (item.name as string) ?? '';
        // 1-based label for accessibility (e.g., "Env var source 1").
        const rowLabel = index + 1;
        const isLast = index === items.length - 1;

        return (
          <div key={index} className="resource-form-env-var-row">
            {/* Env var name input */}
            <div data-field-key={`envVarName-${index}`} className="resource-form-env-var-name">
              <input
                {...INPUT_BEHAVIOR_PROPS}
                className="resource-form-input"
                type="text"
                value={envName}
                onChange={(e) => handleNameChange(index, e.target.value)}
                placeholder="name"
                aria-label={`Env var name ${rowLabel}`}
              />
            </div>

            {/* Source type dropdown */}
            <div className="resource-form-env-var-source">
              <Dropdown
                options={sourceTypeOptions}
                value={sourceType}
                onChange={(val) => handleSourceTypeChange(index, val as SourceType)}
                ariaLabel={`Env var source ${rowLabel}`}
              />
            </div>

            {/* Dynamic fields based on source type */}
            {sourceType === 'value' && (
              <div data-field-key={`envVarValue-${index}`} className="resource-form-env-var-value">
                <input
                  {...INPUT_BEHAVIOR_PROPS}
                  className="resource-form-input"
                  type="text"
                  value={(item.value as string) ?? ''}
                  onChange={(e) => handleValueChange(index, e.target.value)}
                  placeholder="value"
                  aria-label={`Env var value ${rowLabel}`}
                />
              </div>
            )}

            {(sourceType === 'configMap' || sourceType === 'secret') && (
              <>
                <div
                  data-field-key={`envVarRefName-${index}`}
                  className="resource-form-env-var-ref-name"
                >
                  <input
                    {...INPUT_BEHAVIOR_PROPS}
                    className="resource-form-input"
                    type="text"
                    value={getRefName(item)}
                    onChange={(e) => handleRefNameChange(index, e.target.value)}
                    placeholder={sourceType === 'configMap' ? 'configmap name' : 'secret name'}
                    aria-label={`Env var ref name ${rowLabel}`}
                  />
                </div>
                <div
                  data-field-key={`envVarRefKey-${index}`}
                  className="resource-form-env-var-ref-key"
                >
                  <input
                    {...INPUT_BEHAVIOR_PROPS}
                    className="resource-form-input"
                    type="text"
                    value={getRefKey(item)}
                    onChange={(e) => handleRefKeyChange(index, e.target.value)}
                    placeholder="key"
                    aria-label={`Env var ref key ${rowLabel}`}
                  />
                </div>
              </>
            )}

            {sourceType === 'fieldRef' && (
              <div
                data-field-key={`envVarFieldPath-${index}`}
                className="resource-form-env-var-value"
              >
                <input
                  {...INPUT_BEHAVIOR_PROPS}
                  className="resource-form-input"
                  type="text"
                  value={getFieldPath(item)}
                  onChange={(e) => handleFieldPathChange(index, e.target.value)}
                  placeholder="status.podIP"
                  aria-label={`Env var field path ${rowLabel}`}
                />
              </div>
            )}

            {/* Add/remove buttons — same pattern as FormNestedListField */}
            <div className="resource-form-nested-group-row-actions">
              <FormIconActionButton
                variant="add"
                hidden={!isLast}
                label={isLast ? 'Add Env Var' : undefined}
                onClick={isLast ? handleAdd : undefined}
              />
              <FormIconActionButton
                variant="remove"
                label={`Remove env var ${rowLabel}`}
                onClick={() => handleRemove(index)}
              />
            </div>
          </div>
        );
      })}

      {/* Empty state — same pattern as FormNestedListField */}
      {items.length === 0 && (
        <FormEmptyActionRow
          rowClassName="resource-form-nested-group-row"
          actionsClassName="resource-form-nested-group-row-actions"
          alignLeft
          alignLeftClassName="resource-form-nested-group-row-actions--left"
          addLabel="Add Env Var"
          removeLabel="Remove Env Var"
          onAdd={handleAdd}
          ghostText="Add env var"
        />
      )}
    </div>
  );
}
