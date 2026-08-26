import type { DropdownOption, DropdownProps } from '@shared/components/dropdowns/Dropdown';
import {
  DropdownFilterOption,
  dropdownFilterOptionState,
} from '@shared/components/dropdowns/Dropdown/DropdownFilterOption';
import { CloseIcon, EditIcon } from '@shared/components/icons/SharedIcons';
import type React from 'react';
import { useEffect, useState } from 'react';

type ColumnDropTarget = {
  key: string;
  position: 'before' | 'after';
};

interface GridTableColumnOptionRowsOptions {
  columnOptions?: DropdownOption[];
  onMoveColumn?: (key: string, offset: -1 | 1) => void;
  onReorderColumn?: (key: string, targetIndex: number) => void;
  customMetadataColumnKeys?: Set<string>;
  onEditCustomMetadataColumn?: (key: string) => void;
  onRemoveCustomMetadataColumn?: (key: string) => void;
}

interface GridTableColumnOptionRows {
  renderColumnOption: NonNullable<DropdownProps['renderOption']>;
  renderColumnOrderActions: DropdownProps['renderOptionActions'];
  getColumnRowProps: DropdownProps['getOptionRowProps'];
}

/** Shared visibility and reorder row behavior for every Columns dropdown. */
export function useGridTableColumnOptionRows({
  columnOptions,
  onMoveColumn,
  onReorderColumn,
  customMetadataColumnKeys,
  onEditCustomMetadataColumn,
  onRemoveCustomMetadataColumn,
}: GridTableColumnOptionRowsOptions): GridTableColumnOptionRows {
  const [draggingColumnKey, setDraggingColumnKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ColumnDropTarget | null>(null);

  useEffect(() => {
    if (!draggingColumnKey || !onReorderColumn || !columnOptions) {
      return;
    }

    const getDropTarget = (event: DragEvent) => {
      const eventTarget = event.target;
      if (!(eventTarget instanceof Element)) {
        return null;
      }
      const row = eventTarget.closest<HTMLElement>('.dropdown-option-row');
      const key = row?.dataset.columnKey;
      if (!key || key === draggingColumnKey) {
        return null;
      }
      const index = columnOptions.findIndex((option) => option.value === key);
      const draggingIndex = columnOptions.findIndex((option) => option.value === draggingColumnKey);
      return index >= 0 && draggingIndex >= 0
        ? { key, index, position: draggingIndex < index ? ('after' as const) : ('before' as const) }
        : null;
    };

    const handleDragOver = (event: DragEvent) => {
      const target = getDropTarget(event);
      setDropTarget(target ? { key: target.key, position: target.position } : null);
      if (target) {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'move';
        }
      }
    };

    const handleDrop = (event: DragEvent) => {
      const target = getDropTarget(event);
      if (target) {
        event.preventDefault();
        onReorderColumn(draggingColumnKey, target.index);
      }
      setDraggingColumnKey(null);
      setDropTarget(null);
    };

    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
    };
  }, [columnOptions, draggingColumnKey, onReorderColumn]);

  const renderColumnOption = (option: DropdownOption, isSelected: boolean) => {
    const required = Boolean(option.disabled);
    return (
      <DropdownFilterOption
        label={option.label}
        state={dropdownFilterOptionState(isSelected, required)}
        dimWhenOff
        title={required ? 'Always shown' : undefined}
      />
    );
  };

  const getColumnRowProps = (option: DropdownOption) => {
    if (!onMoveColumn || !onReorderColumn || !columnOptions) {
      return {};
    }
    return {
      draggable: true,
      'data-column-key': option.value,
      'data-dragging': draggingColumnKey === option.value || undefined,
      'data-drop-position': dropTarget?.key === option.value ? dropTarget.position : undefined,
      onDragStart: (event: React.DragEvent<HTMLDivElement>) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', option.value);
        setDraggingColumnKey(option.value);
      },
      onDragEnd: () => {
        setDraggingColumnKey(null);
        setDropTarget(null);
      },
    };
  };

  const renderColumnOrderActions = (option: DropdownOption) => {
    if (!onMoveColumn || !onReorderColumn || !columnOptions) {
      return null;
    }
    return (
      <span className="gridtable-column-option-actions">
        {customMetadataColumnKeys?.has(option.value) && onEditCustomMetadataColumn && (
          <button
            type="button"
            className="gridtable-column-edit-action"
            aria-label={`Edit ${option.label}`}
            title={`Edit ${option.label}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onEditCustomMetadataColumn(option.value);
            }}
          >
            <EditIcon width={13} height={13} />
          </button>
        )}
        {customMetadataColumnKeys?.has(option.value) && onRemoveCustomMetadataColumn && (
          <button
            type="button"
            className="gridtable-column-delete-action"
            aria-label={`Delete ${option.label}`}
            title={`Delete ${option.label}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemoveCustomMetadataColumn(option.value);
            }}
          >
            <CloseIcon width={11} height={11} />
          </button>
        )}
        <button
          type="button"
          className="gridtable-column-drag-handle"
          data-column-key={option.value}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            onMoveColumn(option.value, event.key === 'ArrowUp' ? -1 : 1);
          }}
          aria-label={`Reorder ${option.label}. Drag the row, or use Up and Down Arrow keys.`}
          title="Drag the row, or use Up and Down Arrow keys to reorder"
        >
          ⠿
        </button>
      </span>
    );
  };

  return { renderColumnOption, renderColumnOrderActions, getColumnRowProps };
}
