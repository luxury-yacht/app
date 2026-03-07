import React from 'react';
import { FormEmptyActionRow, FormIconActionButton } from './FormActionPrimitives';
import { INPUT_BEHAVIOR_PROPS } from './formUtils';

interface FormKeyValueListFieldProps {
  dataFieldKey: string;
  entries: [string, string][];
  onKeyChange: (index: number, nextKey: string) => void;
  onValueChange: (index: number, nextValue: string) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  addButtonLabel: string;
  removeButtonLabel: string;
  canRemoveEntry?: (index: number) => boolean;
  showInlineKeyValueLabels?: boolean;
  leftAlignEmptyStateActions?: boolean;
  addGhostText?: string | null;
}

/**
 * Reusable key-value list editor used by metadata maps and nested map fields.
 */
export function FormKeyValueListField({
  dataFieldKey,
  entries,
  onKeyChange,
  onValueChange,
  onRemove,
  onAdd,
  addButtonLabel,
  removeButtonLabel,
  canRemoveEntry,
  showInlineKeyValueLabels = false,
  leftAlignEmptyStateActions = false,
  addGhostText = null,
}: FormKeyValueListFieldProps): React.ReactElement {
  return (
    <div data-field-key={dataFieldKey} className="resource-form-kv-container">
      {entries.map(([keyValue, value], index) => {
        const removable = canRemoveEntry ? canRemoveEntry(index) : true;
        return (
          <div
            key={index}
            className={`resource-form-kv-row${showInlineKeyValueLabels ? ' resource-form-kv-row--labeled' : ''}`}
          >
            {showInlineKeyValueLabels ? (
              <div className="resource-form-kv-labeled-pairs">
                <div className="resource-form-kv-pair">
                  <span className="resource-form-field-label">Key</span>
                  <input
                    type="text"
                    className="resource-form-input resource-form-kv-input--25ch"
                    value={keyValue}
                    placeholder="key"
                    size={25}
                    {...INPUT_BEHAVIOR_PROPS}
                    onChange={(event) => onKeyChange(index, event.target.value)}
                  />
                </div>
                <div className="resource-form-kv-pair">
                  <span className="resource-form-field-label">Value</span>
                  <input
                    type="text"
                    className="resource-form-input resource-form-kv-input--25ch"
                    value={value}
                    placeholder="value"
                    size={25}
                    {...INPUT_BEHAVIOR_PROPS}
                    onChange={(event) => onValueChange(index, event.target.value)}
                  />
                </div>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  className="resource-form-input"
                  value={keyValue}
                  placeholder="key"
                  {...INPUT_BEHAVIOR_PROPS}
                  onChange={(event) => onKeyChange(index, event.target.value)}
                />
                <input
                  type="text"
                  className="resource-form-input"
                  value={value}
                  placeholder="value"
                  {...INPUT_BEHAVIOR_PROPS}
                  onChange={(event) => onValueChange(index, event.target.value)}
                />
              </>
            )}
            <div className="resource-form-actions-inline">
              <FormIconActionButton
                variant="add"
                hidden={index !== entries.length - 1}
                label={index === entries.length - 1 ? addButtonLabel : undefined}
                onClick={index === entries.length - 1 ? onAdd : undefined}
              />
              <FormIconActionButton
                variant="remove"
                label={removeButtonLabel}
                onClick={removable ? () => onRemove(index) : undefined}
                hidden={!removable}
                placeholder={!removable}
              />
            </div>
          </div>
        );
      })}
      {entries.length === 0 && (
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
          onAdd={onAdd}
          ghostText={addGhostText}
        />
      )}
    </div>
  );
}
