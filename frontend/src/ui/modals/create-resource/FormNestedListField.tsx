import React from 'react';
import { FormEmptyActionRow, FormIconActionButton } from './FormActionPrimitives';

interface FormNestedListFieldProps<TItem> {
  dataFieldKey: string;
  items: TItem[];
  renderFields: (item: TItem, index: number) => React.ReactNode;
  addLabel: string;
  removeLabel: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  leftAlignEmptyStateActions?: boolean;
  addGhostText?: string | null;
}

/**
 * Reusable nested list row editor used by ports/env lists and ConfigMap items.
 */
export function FormNestedListField<TItem>({
  dataFieldKey,
  items,
  renderFields,
  addLabel,
  removeLabel,
  onAdd,
  onRemove,
  leftAlignEmptyStateActions = false,
  addGhostText = null,
}: FormNestedListFieldProps<TItem>): React.ReactElement {
  return (
    <div data-field-key={dataFieldKey} className="resource-form-nested-group-list">
      {items.map((item, index) => (
        <div key={index} className="resource-form-nested-group-row">
          <div className="resource-form-nested-group-fields">{renderFields(item, index)}</div>
          <div className="resource-form-nested-group-row-actions">
            <FormIconActionButton
              variant="add"
              hidden={index !== items.length - 1}
              label={index === items.length - 1 ? addLabel : undefined}
              onClick={index === items.length - 1 ? onAdd : undefined}
            />
            <FormIconActionButton
              variant="remove"
              label={removeLabel}
              onClick={() => onRemove(index)}
            />
          </div>
        </div>
      ))}
      {items.length === 0 && (
        <FormEmptyActionRow
          rowClassName="resource-form-nested-group-row"
          spacerClassName={
            !leftAlignEmptyStateActions ? 'resource-form-nested-group-fields' : undefined
          }
          actionsClassName="resource-form-nested-group-row-actions"
          alignLeft={leftAlignEmptyStateActions}
          alignLeftClassName="resource-form-nested-group-row-actions--left"
          addLabel={addLabel}
          removeLabel={removeLabel}
          onAdd={onAdd}
          ghostText={addGhostText}
        />
      )}
    </div>
  );
}
