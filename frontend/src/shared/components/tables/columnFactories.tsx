/**
 * frontend/src/shared/components/tables/columnFactories.tsx
 *
 * UI component for columnFactories.
 * Handles rendering and interactions for the shared components.
 */

import React from 'react';
import {
  type ColumnWidthInput,
  type GridColumnDefinition,
} from '@shared/components/tables/GridTable';
import ResourceBar from '@shared/components/ResourceBar';

/**
 * Column factory functions for GridTable
 * Analogous to the HTML table columnFactories but for CSS Grid tables
 */

/**
 * Creates an age column for resources with an age property
 */
export const createAgeColumn = <T extends { age?: string }>(
  key: string = 'age',
  header: string = 'Age',
  getValue: (item: T) => string | undefined = (item) => item.age
): GridColumnDefinition<T> => ({
  key,
  header,
  render: (item) => getValue(item) || '-',
  sortable: true,
});

export interface CreateResourceBarColumnOptions<T> {
  key?: string;
  header: string;
  type: 'cpu' | 'memory';
  getUsage: (item: T) => string | number | undefined | null;
  getRequest?: (item: T) => string | number | undefined | null;
  getLimit?: (item: T) => string | number | undefined | null;
  getAllocatable?: (item: T) => string | number | undefined | null;
  getOvercommitPercent?: (item: T) => number | undefined;
  getVariant?: (item: T) => 'default' | 'compact' | undefined;
  getShowTooltip?: (item: T) => boolean | undefined;
  getMetricsStale?: (item: T) => boolean | undefined;
  getMetricsError?: (item: T) => string | undefined;
  getMetricsLastUpdated?: (item: T) => Date | undefined;
  getAnimationKey?: (item: T) => string | undefined;
  getShowEmptyState?: (item: T) => boolean;
  className?: string;
  sortable?: boolean;
  sortValue?: (item: T) => any;
}

export function createResourceBarColumn<T>(
  options: CreateResourceBarColumnOptions<T>
): GridColumnDefinition<T> {
  const {
    key = options.key ?? options.header.toLowerCase(),
    header,
    type,
    getUsage,
    getRequest,
    getLimit,
    getAllocatable,
    getOvercommitPercent,
    getVariant,
    getShowTooltip,
    getMetricsStale,
    getMetricsError,
    getMetricsLastUpdated,
    getAnimationKey,
    getShowEmptyState,
    className,
    sortable,
    sortValue,
  } = options;

  const coerce = (value: string | number | undefined | null): string | undefined => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return undefined;
      }
      return value.toString();
    }
    const str = value.toString();
    return str.length > 0 ? str : undefined;
  };

  return {
    key,
    header,
    className,
    sortable: sortable ?? false,
    sortValue,
    render: (item: T) => {
      const usage = coerce(getUsage(item));
      const request = coerce(getRequest?.(item));
      const limit = coerce(getLimit?.(item));
      const allocatable = coerce(getAllocatable?.(item));
      const showEmptyState = getShowEmptyState?.(item);

      return (
        <ResourceBar
          usage={usage}
          request={request}
          limit={limit}
          allocatable={allocatable}
          type={type}
          variant={getVariant?.(item) ?? 'compact'}
          showTooltip={getShowTooltip?.(item)}
          overcommitPercent={getOvercommitPercent?.(item)}
          metricsStale={getMetricsStale?.(item)}
          metricsError={getMetricsError?.(item)}
          metricsLastUpdated={getMetricsLastUpdated?.(item)}
          animationScopeKey={getAnimationKey?.(item)}
          showEmptyState={showEmptyState ?? true}
        />
      );
    },
  };
}

/**
 * Creates a simple text column (optionally interactive)
 */

export interface ColumnSizingHint {
  width?: ColumnWidthInput;
  minWidth?: ColumnWidthInput;
  maxWidth?: ColumnWidthInput;
  autoWidth?: boolean;
}

export type ColumnSizingMap = Record<string, ColumnSizingHint>;

export const applyColumnSizing = <T,>(
  columns: GridColumnDefinition<T>[],
  sizing: ColumnSizingMap
): void => {
  columns.forEach((column) => {
    const hint = sizing[column.key];
    if (!hint) {
      return;
    }
    if (hint.width !== undefined) {
      column.width = hint.width;
    }
    if (hint.minWidth !== undefined) {
      column.minWidth = hint.minWidth;
    } else if (hint.width !== undefined) {
      column.minWidth = hint.width;
    }
    if (hint.maxWidth !== undefined) {
      column.maxWidth = hint.maxWidth;
    }
    if (hint.autoWidth !== undefined) {
      column.autoWidth = hint.autoWidth;
    }
  });
};

/**
 * Creates a simple text column (optionally interactive)
 */
export interface CreateTextColumnOptions<T> {
  className?: string;
  sortable?: boolean;
  onClick?: (item: T) => void;
  getTitle?: (item: T) => string | undefined;
  getClassName?: (item: T) => string | undefined;
  isInteractive?: (item: T) => boolean;
  disableShortcuts?: boolean | ((item: T) => boolean);
}

export function createTextColumn<T extends { name?: string }>(
  key: string,
  header: string,
  options?: CreateTextColumnOptions<T>
): GridColumnDefinition<T>;

export function createTextColumn<T>(
  key: string,
  header: string,
  accessor: (item: T) => string | number | undefined,
  options?: CreateTextColumnOptions<T>
): GridColumnDefinition<T>;

export function createTextColumn<T>(
  key: string,
  header: string,
  accessorOrOptions?: ((item: T) => string | number | undefined) | CreateTextColumnOptions<T>,
  maybeOptions?: CreateTextColumnOptions<T>
): GridColumnDefinition<T> {
  let accessor: (item: T) => string | number | undefined;
  let options: CreateTextColumnOptions<T> | undefined;

  if (typeof accessorOrOptions === 'function') {
    accessor = accessorOrOptions;
    options = maybeOptions;
  } else {
    options = accessorOrOptions;
    accessor = (item: T) => {
      const candidate = (item as unknown as { name?: string; title?: string }).name;
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
      }
      const titleValue = (item as unknown as { title?: string }).title;
      if (typeof titleValue === 'string' && titleValue.length > 0) {
        return titleValue;
      }
      return undefined;
    };
  }

  const renderValue = (item: T): string => {
    const value = accessor(item);
    return value !== undefined && value !== null ? String(value) : '-';
  };

  return {
    key,
    header,
    className: options?.className,
    sortable: options?.sortable ?? true,
    disableShortcuts: options?.disableShortcuts,
    render: (item: T) => {
      const display = renderValue(item);
      const dynamicClass = options?.getClassName?.(item);
      const title = options?.getTitle?.(item);

      const interactive = Boolean(options?.onClick) && (options?.isInteractive?.(item) ?? true);

      if (!interactive) {
        if (dynamicClass || title) {
          return (
            <span className={dynamicClass} title={title}>
              {display}
            </span>
          );
        }
        return display;
      }

      const className = ['gridtable-link', dynamicClass].filter(Boolean).join(' ');

      return (
        <span
          className={className}
          style={{ cursor: 'pointer' }}
          role="button"
          tabIndex={0}
          title={title}
          data-gridtable-shortcut-optout="true"
          data-gridtable-rowclick="allow"
          onClick={() => {
            options?.onClick?.(item);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              options?.onClick?.(item);
            }
          }}
        >
          {display}
        </span>
      );
    },
  };
}

interface NamespaceColumnOptions<T> extends CreateTextColumnOptions<T> {
  accessor?: (item: T) => string | undefined;
  sortValue?: (item: T) => string | number | undefined;
}

export function upsertNamespaceColumn<T>(
  columns: GridColumnDefinition<T>[],
  options: NamespaceColumnOptions<T>
): void {
  const nameIndex = columns.findIndex((column) => column.key === 'name');
  if (nameIndex === -1) {
    return;
  }

  const namespaceAccessor =
    options.accessor ??
    ((item: T) => {
      const value = (item as unknown as { namespace?: string }).namespace;
      return value ?? '—';
    });

  const namespaceColumn = createTextColumn<T>('namespace', 'Namespace', namespaceAccessor, options);

  if (options.sortValue) {
    namespaceColumn.sortValue = options.sortValue;
  }
  const existingIndex = columns.findIndex((column) => column.key === 'namespace');

  if (existingIndex >= 0) {
    columns.splice(existingIndex, 1);
  }

  columns.splice(nameIndex + 1, 0, namespaceColumn);
}

/**
 * Creates a kind column with badge styling
 */
type KindColumnClickHandler<T> = (item: T) => void;

export interface CreateKindColumnOptions<T> {
  key?: string;
  header?: string;
  getKind: (item: T) => string;
  getAlias?: (item: T) => string | undefined;
  getDisplayText?: (item: T) => string;
  onClick?: KindColumnClickHandler<T>;
  isInteractive?: (item: T) => boolean;
  sortable?: boolean;
  sortValue?: (item: T) => string | number;
  className?: string;
  disableShortcuts?: boolean | ((item: T) => boolean);
}

export const createKindColumn = <T,>(
  options: CreateKindColumnOptions<T>
): GridColumnDefinition<T> => {
  const {
    key = 'kind',
    header = 'Kind',
    getKind,
    getAlias,
    getDisplayText,
    onClick,
    isInteractive,
    sortable = true,
    sortValue,
    className,
    disableShortcuts,
  } = options;
  const resolveDisplayText = (item: T) => {
    if (getDisplayText) {
      return getDisplayText(item);
    }
    const baseKind = getKind(item);
    const alias = getAlias?.(item);
    const useShortNames =
      typeof window !== 'undefined' &&
      window.localStorage?.getItem('useShortResourceNames') === 'true';
    return useShortNames && alias ? alias : baseKind;
  };

  return {
    key,
    header,
    sortable,
    className,
    disableShortcuts,
    sortValue:
      sortValue ??
      ((item: T) => {
        const kind = getKind(item);
        return typeof kind === 'string' ? kind.toLowerCase() : kind;
      }),
    render: (item: T) => {
      const displayText = resolveDisplayText(item);
      const kindValue = getKind(item);
      const interactive =
        onClick && (isInteractive ? isInteractive(item) : true) && displayText.trim().length > 0;

      if (!interactive) {
        return <span data-kind-value={kindValue}>{displayText}</span>;
      }

      const handleClick = () => {
        onClick?.(item);
      };

      const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.(item);
        }
      };

      return (
        <span
          data-kind-value={kindValue}
          data-kind-interactive="true"
          data-gridtable-shortcut-optout="true"
          data-gridtable-rowclick="allow"
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          role="button"
          tabIndex={0}
          style={{ cursor: 'pointer' }}
        >
          {displayText}
        </span>
      );
    },
  };
};
