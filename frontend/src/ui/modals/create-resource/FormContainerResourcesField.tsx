import React from 'react';
import { FormGhostAddText, FormIconActionButton } from './FormActionPrimitives';
import { getNestedValue, INPUT_BEHAVIOR_PROPS } from './formUtils';

interface ResourceMetricDefinition {
  key: string;
  label: string;
  path: readonly string[];
}

interface FormContainerResourcesFieldProps {
  dataFieldKey: string;
  resources?: Record<string, unknown>;
  showFields: boolean;
  onShowFields: () => void;
  onRemoveResources: (hasAnyValue: boolean) => void;
  onResourceValueChange: (resourcePath: readonly string[], rawValue: string) => void;
}

const REQUEST_FIELDS: readonly ResourceMetricDefinition[] = [
  { key: 'requestsCpu', label: 'CPU', path: ['requests', 'cpu'] },
  { key: 'requestsMemory', label: 'Memory', path: ['requests', 'memory'] },
] as const;

const LIMIT_FIELDS: readonly ResourceMetricDefinition[] = [
  { key: 'limitsCpu', label: 'CPU', path: ['limits', 'cpu'] },
  { key: 'limitsMemory', label: 'Memory', path: ['limits', 'memory'] },
] as const;

const RESOURCE_FIELD_ROWS = [
  { key: 'requests', label: 'Requests', fields: REQUEST_FIELDS },
  { key: 'limits', label: 'Limits', fields: LIMIT_FIELDS },
] as const;

const ALL_RESOURCE_FIELDS = [...REQUEST_FIELDS, ...LIMIT_FIELDS] as const;

/**
 * Returns true when any requests/limits field has a non-empty value.
 */
export function hasContainerResourceValues(resources?: Record<string, unknown>): boolean {
  return ALL_RESOURCE_FIELDS.some((resourceField) => {
    const value = resources ? getNestedValue(resources, resourceField.path) : undefined;
    return String(value ?? '').trim() !== '';
  });
}

/**
 * Reusable requests/limits resources field with compact row alignment and add/remove controls.
 */
export function FormContainerResourcesField({
  dataFieldKey,
  resources,
  showFields,
  onShowFields,
  onRemoveResources,
  onResourceValueChange,
}: FormContainerResourcesFieldProps): React.ReactElement {
  const hasAnyValue = hasContainerResourceValues(resources);

  if (!showFields) {
    return (
      <div className="resource-form-actions-row">
        <FormIconActionButton variant="add" label="Add Resources" onClick={onShowFields} />
        <FormGhostAddText text="Add resource requests/limits" />
      </div>
    );
  }

  return (
    <div data-field-key={dataFieldKey} className="resource-form-container-resources">
      {RESOURCE_FIELD_ROWS.map((row, rowIndex) => (
        <div key={row.key} className="resource-form-container-resources-row">
          <span className="resource-form-field-label resource-form-container-resources-row-label">{row.label}</span>
          {row.fields.map((resourceField) => {
            const value = resources
              ? getNestedValue(resources, resourceField.path)
              : undefined;
            return (
              <div key={resourceField.key} className="resource-form-container-resources-metric">
                <label className="resource-form-field-label">
                  {resourceField.label}
                </label>
                <input
                  type="text"
                  className="resource-form-input"
                  data-field-key={resourceField.key}
                  value={value != null ? String(value) : ''}
                  placeholder="optional"
                  {...INPUT_BEHAVIOR_PROPS}
                  onChange={(event) =>
                    onResourceValueChange(resourceField.path, event.target.value)
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
              onClick={rowIndex === 0 ? () => onRemoveResources(hasAnyValue) : undefined}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
