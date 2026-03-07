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
  addDisabled?: boolean;
  /** Use wide gap between fields (var(--spacing-xl)). */
  fieldGap?: 'wide';
  /** Wrap fields to multiple lines. */
  wrapFields?: boolean;
  /** Align rows to the start (top) instead of center. */
  rowAlign?: 'start';
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
  addDisabled = false,
  fieldGap,
  wrapFields,
  rowAlign,
}: FormNestedListFieldProps<TItem>): React.ReactElement {
  // Build inline styles for layout overrides driven by form definitions.
  const fieldsStyle: React.CSSProperties | undefined =
    fieldGap || wrapFields
      ? {
          ...(fieldGap === 'wide' ? { gap: 'var(--spacing-xl)' } : undefined),
          ...(wrapFields ? { flexWrap: 'wrap', rowGap: 'var(--spacing-xs)' } : undefined),
        }
      : undefined;
  const rowStyle: React.CSSProperties | undefined = rowAlign === 'start'
    ? { alignItems: 'flex-start' }
    : undefined;

  return (
    <div data-field-key={dataFieldKey} className="resource-form-nested-group-list">
      {items.map((item, index) => (
        <div key={index} className="resource-form-nested-group-row" style={rowStyle}>
          <div className="resource-form-nested-group-fields" style={fieldsStyle}>
            {renderFields(item, index)}
          </div>
          <div className="resource-form-nested-group-row-actions">
            <FormIconActionButton
              variant="add"
              hidden={index !== items.length - 1}
              label={index === items.length - 1 ? addLabel : undefined}
              onClick={index === items.length - 1 ? onAdd : undefined}
              disabled={index === items.length - 1 ? addDisabled : false}
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
          addDisabled={addDisabled}
          ghostText={addGhostText}
        />
      )}
    </div>
  );
}
