/**
 * EnvFrom field editor.
 *
 * Renders a list of envFrom items, each with a source type dropdown
 * (ConfigMap/Secret), a name input, an optional prefix input, and
 * a remove button. Handles the YAML mapping between the flat UI model
 * and the nested configMapRef/secretRef structure.
 */

import React from 'react';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import { INPUT_BEHAVIOR_PROPS } from './formUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One item in the envFrom array.
 * Uses Record<string, unknown> for the public API to match the dispatch layer's
 * untyped item model. Internally we type-narrow via getSourceType/getName.
 */
type EnvFromItem = Record<string, unknown>;

interface FormEnvFromFieldProps {
  /** data-field-key for the wrapper element. */
  dataFieldKey: string;
  /** Current envFrom items from YAML. */
  items: EnvFromItem[];
  /** Callback when items change. */
  onChange: (newItems: EnvFromItem[]) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SourceType = 'configMap' | 'secret';

const sourceTypeOptions = [
  { value: 'configMap', label: 'ConfigMap' },
  { value: 'secret', label: 'Secret' },
];

/** Detect the source type of an envFrom item. */
function getSourceType(item: EnvFromItem): SourceType {
  if (item.secretRef) return 'secret';
  return 'configMap';
}

/** Get the name value from an envFrom item. */
function getName(item: EnvFromItem): string {
  const ref = (item.secretRef ?? item.configMapRef) as { name?: string } | undefined;
  return ref?.name ?? '';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FormEnvFromField({
  dataFieldKey,
  items,
  onChange,
}: FormEnvFromFieldProps): React.ReactElement {
  /** Update a single item in the list. */
  const updateItem = (index: number, updater: (item: EnvFromItem) => EnvFromItem) => {
    const newItems = items.map((it, i) => (i === index ? updater(it) : it));
    onChange(newItems);
  };

  /** Handle source type change — swap configMapRef ↔ secretRef, preserve name and prefix. */
  const handleSourceTypeChange = (index: number, newType: SourceType) => {
    updateItem(index, (item) => {
      const name = getName(item);
      const prefix = item.prefix;
      const next: EnvFromItem = {};
      if (newType === 'configMap') {
        next.configMapRef = { name };
      } else {
        next.secretRef = { name };
      }
      if (prefix) next.prefix = prefix;
      return next;
    });
  };

  /** Handle name input change. */
  const handleNameChange = (index: number, newName: string) => {
    updateItem(index, (item) => {
      const sourceType = getSourceType(item);
      const next = { ...item };
      if (sourceType === 'configMap') {
        next.configMapRef = { name: newName };
      } else {
        next.secretRef = { name: newName };
      }
      return next;
    });
  };

  /** Handle prefix input change. */
  const handlePrefixChange = (index: number, newPrefix: string) => {
    updateItem(index, (item) => {
      const next = { ...item };
      if (newPrefix) {
        next.prefix = newPrefix;
      } else {
        delete next.prefix;
      }
      return next;
    });
  };

  /** Add a new envFrom item defaulting to ConfigMap. */
  const handleAdd = () => {
    onChange([...items, { configMapRef: { name: '' } }]);
  };

  /** Remove an item by index. */
  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div data-field-key={dataFieldKey} className="resource-form-env-from">
      {items.map((item, index) => {
        const sourceType = getSourceType(item);
        const name = getName(item);
        const prefix = (item.prefix as string) ?? '';
        // 1-based label for accessibility (e.g., "Env source type 1").
        const rowLabel = index + 1;

        return (
          <div key={index} className="resource-form-env-from-row">
            {/* Source type dropdown */}
            <div className="resource-form-env-from-source">
              <Dropdown
                options={sourceTypeOptions}
                value={sourceType}
                onChange={(val) => handleSourceTypeChange(index, val as SourceType)}
                ariaLabel={`Env source type ${rowLabel}`}
              />
            </div>

            {/* Name input */}
            <div data-field-key={`envFromName-${index}`} className="resource-form-env-from-name">
              <input
                {...INPUT_BEHAVIOR_PROPS}
                className="resource-form-input"
                type="text"
                value={name}
                onChange={(e) => handleNameChange(index, e.target.value)}
                placeholder="name"
                aria-label={`Env source name ${rowLabel}`}
              />
            </div>

            {/* Prefix input */}
            <div
              data-field-key={`envFromPrefix-${index}`}
              className="resource-form-env-from-prefix"
            >
              <input
                {...INPUT_BEHAVIOR_PROPS}
                className="resource-form-input"
                type="text"
                value={prefix}
                onChange={(e) => handlePrefixChange(index, e.target.value)}
                placeholder="prefix (optional)"
                aria-label={`Env source prefix ${rowLabel}`}
              />
            </div>

            {/* Remove button */}
            <button
              data-field-key={`envFromRemove-${index}`}
              type="button"
              className="resource-form-icon-btn"
              onClick={() => handleRemove(index)}
              aria-label={`Remove env source ${rowLabel}`}
            >
              ✕
            </button>
          </div>
        );
      })}

      {/* Add button */}
      <button type="button" className="resource-form-add-btn" onClick={handleAdd}>
        Add env source
      </button>
    </div>
  );
}
