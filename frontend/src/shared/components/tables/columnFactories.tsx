/**
 * frontend/src/shared/components/tables/columnFactories.tsx
 *
 * UI component for columnFactories.
 * Handles rendering and interactions for the shared components.
 */

import { formatLiveAgeText, LiveAgeText } from '@shared/components/LiveAgeText';
import ResourceBar from '@shared/components/ResourceBar';
import type {
  ColumnWidthInput,
  GridColumnAlignmentOptions,
  GridColumnDefinition,
} from '@shared/components/tables/GridTable';
import { getKindBadgeClassName } from '@shared/utils/kindBadgeColors';
import { formatResourceValue, parseResourceValue } from '@shared/utils/resourceCalculations';
import type React from 'react';
import { getUseShortResourceNames } from '@/core/settings/appPreferences';
import { parseCompactAgeToSeconds } from '@/utils/ageFormatter';

/**
 * Column factory functions for GridTable
 * Analogous to the HTML table columnFactories but for CSS Grid tables
 */

type AgeColumnRow = { age?: string; ageTimestamp?: number };

/**
 * Creates an age column for resources with an age property.
 */
export const createAgeColumn = <T extends AgeColumnRow>(
  key: string = 'age',
  header: string = 'Age',
  getValue: (item: T) => string | undefined = (item) => item.age
): GridColumnDefinition<T> => ({
  key,
  header,
  alignHeader: 'right',
  alignData: 'right',
  render: (item) => {
    const fallback = getValue(item) || '-';
    if (typeof item.ageTimestamp === 'number' && Number.isFinite(item.ageTimestamp)) {
      return (
        <LiveAgeText
          timestamp={item.ageTimestamp}
          fallback={fallback}
          data-gridtable-export-text={formatLiveAgeText(item.ageTimestamp, Date.now(), fallback)}
        />
      );
    }
    return fallback;
  },
  sortable: true,
  sortValue: (item) =>
    typeof item.ageTimestamp === 'number' && Number.isFinite(item.ageTimestamp)
      ? -item.ageTimestamp
      : parseCompactAgeToSeconds(getValue(item)),
});

export interface CreateResourceBarColumnOptions<T> extends GridColumnAlignmentOptions {
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
  getAnimationKey?: (item: T) => string | undefined;
  getShowEmptyState?: (item: T) => boolean;
  className?: string;
  sortable?: boolean;
  sortValue?: (item: T) => unknown;
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
    getAnimationKey,
    getShowEmptyState,
    className,
    alignHeader,
    alignData,
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

  const formatResourceForExport = (value: string | undefined): string => {
    const parsedValue = parseResourceValue(value, type);
    return formatResourceValue(value, parsedValue, type);
  };

  return {
    key,
    header,
    className,
    alignHeader,
    alignData,
    sortable: sortable ?? false,
    sortValue,
    render: (item: T) => {
      const usage = coerce(getUsage(item));
      const request = coerce(getRequest?.(item));
      const limit = coerce(getLimit?.(item));
      const allocatable = coerce(getAllocatable?.(item));
      const showEmptyState = getShowEmptyState?.(item);
      const exportText = getMetricsError?.(item) ? '—' : formatResourceForExport(usage);

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
          animationScopeKey={getAnimationKey?.(item)}
          showEmptyState={showEmptyState ?? true}
          data-gridtable-export-text={exportText}
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

export const withColumnSizing = <T,>(
  columns: GridColumnDefinition<T>[],
  sizing: ColumnSizingMap
): GridColumnDefinition<T>[] =>
  columns.map((column) => {
    const hint = sizing[column.key];
    if (!hint) {
      return column;
    }
    return {
      ...column,
      ...(hint.width !== undefined ? { width: hint.width } : {}),
      ...(hint.minWidth !== undefined
        ? { minWidth: hint.minWidth }
        : hint.width !== undefined
          ? { minWidth: hint.width }
          : {}),
      ...(hint.maxWidth !== undefined ? { maxWidth: hint.maxWidth } : {}),
      ...(hint.autoWidth !== undefined ? { autoWidth: hint.autoWidth } : {}),
    };
  });

export const withAutoWidthColumns = <T,>(
  columns: GridColumnDefinition<T>[]
): GridColumnDefinition<T>[] =>
  columns.map((column) => (column.autoWidth ? column : { ...column, autoWidth: true }));

/**
 * Creates a simple text column (optionally interactive)
 */
export interface CreateTextColumnOptions<T> extends GridColumnAlignmentOptions, ColumnSizingHint {
  className?: string;
  hideable?: boolean;
  resizable?: boolean;
  sortable?: boolean;
  sortValue?: (item: T) => string | number | undefined;
  onClick?: (item: T) => void;
  /** Alt+click handler — navigates to the item's view and focuses it. */
  onAltClick?: (item: T) => void;
  getTitle?: (item: T) => string | undefined;
  getClassName?: (item: T) => string | undefined;
  isInteractive?: (item: T) => boolean;
  disableShortcuts?: boolean | ((item: T) => boolean);
  /** Whether activating the interactive cell may also activate its row. Defaults to true. */
  allowRowClick?: boolean;
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
    alignHeader: options?.alignHeader,
    alignData: options?.alignData,
    hideable: options?.hideable,
    resizable: options?.resizable,
    width: options?.width,
    minWidth: options?.minWidth,
    maxWidth: options?.maxWidth,
    autoWidth: options?.autoWidth,
    sortable: options?.sortable ?? true,
    sortValue: options?.sortValue ?? accessor,
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

      const className = ['gridtable-cell-button', 'gridtable-link', dynamicClass]
        .filter(Boolean)
        .join(' ');

      return (
        <button
          type="button"
          className={className}
          title={title}
          data-gridtable-shortcut-optout="true"
          data-gridtable-rowclick={options?.allowRowClick === false ? 'suppress' : 'allow'}
          onClick={(event) => {
            if (event.altKey && options?.onAltClick) {
              event.preventDefault();
              event.stopPropagation();
              options.onAltClick(item);
            } else {
              options?.onClick?.(item);
            }
          }}
        >
          {display}
        </button>
      );
    },
  };
}

type CreateResourceNameColumnOptions<T> = Omit<CreateTextColumnOptions<T>, 'hideable'>;

export function createResourceNameColumn<T extends { name?: string }>(
  options?: CreateResourceNameColumnOptions<T>
): GridColumnDefinition<T>;

export function createResourceNameColumn<T>(
  accessor: (item: T) => string | number | undefined,
  options?: CreateResourceNameColumnOptions<T>
): GridColumnDefinition<T>;

export function createResourceNameColumn<T>(
  accessorOrOptions?:
    | ((item: T) => string | number | undefined)
    | CreateResourceNameColumnOptions<T>,
  maybeOptions?: CreateResourceNameColumnOptions<T>
): GridColumnDefinition<T> {
  const options = typeof accessorOrOptions === 'function' ? maybeOptions : accessorOrOptions;
  const requiredOptions = {
    ...options,
    hideable: false,
    width: options?.width ?? 250,
  };
  return typeof accessorOrOptions === 'function'
    ? createTextColumn('name', 'Name', accessorOrOptions, requiredOptions)
    : createTextColumn(
        'name',
        'Name',
        (item: T) => {
          const named = item as { name?: string; title?: string };
          return named.name || named.title;
        },
        requiredOptions
      );
}

interface NamespaceColumnOptions<T> extends CreateTextColumnOptions<T> {
  afterColumnKey: string;
  accessor?: (item: T) => string | undefined;
  sortValue?: (item: T) => string | number | undefined;
}

export function withNamespaceColumn<T>(
  columns: GridColumnDefinition<T>[],
  options: NamespaceColumnOptions<T>
): GridColumnDefinition<T>[] {
  const withoutNamespace = columns.filter((column) => column.key !== 'namespace');
  const anchorIndex = withoutNamespace.findIndex((column) => column.key === options.afterColumnKey);
  if (anchorIndex === -1) {
    throw new Error(`GridTable namespace column anchor not found: "${options.afterColumnKey}"`);
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
  return [
    ...withoutNamespace.slice(0, anchorIndex + 1),
    namespaceColumn,
    ...withoutNamespace.slice(anchorIndex + 1),
  ];
}

/**
 * Creates a kind column with badge styling
 */
type KindColumnClickHandler<T> = (item: T) => void;

export interface CreateKindColumnOptions<T> extends GridColumnAlignmentOptions {
  key?: string;
  header?: string;
  getKind: (item: T) => string;
  getAlias?: (item: T) => string | undefined;
  getDisplayText?: (item: T) => string;
  onClick?: KindColumnClickHandler<T>;
  /** Alt+click handler — navigates to the item's view and focuses it. */
  onAltClick?: (item: T) => void;
  isInteractive?: (item: T) => boolean;
  sortable?: boolean;
  sortValue?: (item: T) => string | number;
  className?: string;
  disableShortcuts?: boolean | ((item: T) => boolean);
  /** Whether activating the Kind badge may also activate its row. Defaults to true. */
  allowRowClick?: boolean;
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
    alignHeader,
    alignData,
    disableShortcuts,
    allowRowClick = true,
  } = options;
  const resolveDisplayText = (item: T) => {
    if (getDisplayText) {
      return getDisplayText(item);
    }
    const baseKind = getKind(item);
    const alias = getAlias?.(item);
    const useShortNames = getUseShortResourceNames();
    return useShortNames && alias ? alias : baseKind;
  };

  return {
    key,
    header,
    width: 100,
    autoWidth: true,
    sortable,
    className: ['gridtable-kind-column', className].filter(Boolean).join(' '),
    alignHeader,
    alignData,
    disableShortcuts,
    measurementSampleKey: (item: T) => {
      const displayText = resolveDisplayText(item);
      const interactive = Boolean(
        onClick && (isInteractive ? isInteractive(item) : true) && displayText.trim().length > 0
      );
      return JSON.stringify([getKind(item), displayText, interactive]);
    },
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
        return (
          <span className={getKindBadgeClassName(kindValue)} data-kind-value={kindValue}>
            {displayText}
          </span>
        );
      }

      const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        if (event.altKey && options.onAltClick) {
          event.preventDefault();
          event.stopPropagation();
          options.onAltClick(item);
        } else {
          onClick?.(item);
        }
      };

      return (
        <button
          type="button"
          className={`${getKindBadgeClassName(kindValue)} clickable`}
          data-kind-value={kindValue}
          data-kind-interactive="true"
          data-gridtable-shortcut-optout="true"
          data-gridtable-rowclick={allowRowClick ? 'allow' : 'suppress'}
          onClick={handleClick}
        >
          {displayText}
        </button>
      );
    },
  };
};
