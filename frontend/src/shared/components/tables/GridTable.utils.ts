/**
 * frontend/src/shared/components/tables/GridTable.utils.ts
 *
 * Utility helpers for GridTable.utils.
 * Provides shared helper functions for the shared components.
 */

import type {
  ColumnWidthInput,
  ColumnWidthUnit,
  GridColumnDefinition,
} from '@shared/components/tables/GridTable.types';
import { getKindColorClass } from '@shared/utils/kindBadgeColors';
import React from 'react';

export const DEFAULT_COLUMN_WIDTH = 150;
export const DEFAULT_COLUMN_MIN_WIDTH = 72;
export const DEFAULT_FONT_SIZE = 16;

const FIXED_KIND_KEYS = new Set(['kind']);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;

interface TextElementProps {
  'data-gridtable-export-text'?: string;
  children?: React.ReactNode;
  title?: string;
}

export const isKindColumnKey = (key: string) => FIXED_KIND_KEYS.has(key);
export const isFixedColumnKey = (key: string) => isKindColumnKey(key);
export const isSortableColumn = <T>(column: GridColumnDefinition<T> | null | undefined) =>
  column !== null && column !== undefined && column.sortable !== false;

export const normalizeKindClass = (value: string) => getKindColorClass(value);

export const defaultGetKind = (row: unknown): string | null => {
  const record = asRecord(row);
  if (!record) {
    return null;
  }
  if (typeof record.kindDisplay === 'string') {
    return record.kindDisplay;
  }
  if (typeof record.kind === 'string') {
    return record.kind;
  }
  const item = asRecord(record.item);
  if (typeof item?.kind === 'string') {
    return item.kind;
  }
  return null;
};

export const defaultGetNamespace = (row: unknown): string | null => {
  const record = asRecord(row);
  if (!record) {
    return null;
  }
  const item = asRecord(record.item);
  const value =
    typeof record.namespaceDisplay === 'string'
      ? record.namespaceDisplay
      : typeof record.namespace === 'string'
        ? record.namespace
        : typeof item?.namespace === 'string'
          ? item.namespace
          : null;
  if (value === '—') {
    return '';
  }
  return value;
};

const defaultGetClusterId = (row: unknown): string | null => {
  const record = asRecord(row);
  if (!record) {
    return null;
  }
  if (typeof record.clusterId === 'string') {
    return record.clusterId;
  }
  const item = asRecord(record.item);
  if (typeof item?.clusterId === 'string') {
    return item.clusterId;
  }
  // Warn in development when clusterId is missing - this may indicate a payload issue.
  if (import.meta.env.DEV && (record.clusterName || item?.clusterName)) {
    console.warn('GridTable: row has clusterName but missing clusterId', row);
  }
  return null;
};

// Prefix row keys with cluster identity to keep multi-cluster rows stable.
// Throws when clusterId is missing — a key collision in a multi-cluster view
// is worse than a crash, so callers must ensure clusterId is always populated.
export const buildClusterScopedKey = (row: unknown, baseKey: string): string => {
  const clusterId = defaultGetClusterId(row);
  const trimmed = typeof clusterId === 'string' ? clusterId.trim() : '';
  if (trimmed) {
    return `${trimmed}|${baseKey}`;
  }
  throw new Error(
    'GridTable: buildClusterScopedKey requires clusterId on every row. ' +
      `Row with key "${baseKey}" has no clusterId — this will cause key ` +
      'collisions in multi-cluster views. Ensure the data source populates ' +
      'clusterId on all rows.'
  );
};

// Deterministic, collision-free DOM id from a row key.
// Hex-encodes characters outside [a-zA-Z0-9_-] so distinct keys always
// produce distinct IDs — unlike the old lossy replace-with-underscore approach.
export const getStableRowId = (rowKey: string): string => {
  const safe = rowKey.replace(/[^a-zA-Z0-9_-]/g, (ch) => `_x${ch.charCodeAt(0).toString(16)}_`);
  return `gridtable-row-${safe}`;
};

export const findGridTableRowByKey = (
  wrapper: HTMLElement | null | undefined,
  rowKey: string
): HTMLDivElement | null => {
  if (!wrapper) {
    return null;
  }
  const rows = wrapper.querySelectorAll<HTMLDivElement>('.gridtable-row[data-row-key]');
  for (const row of rows) {
    if (row.dataset.rowKey === rowKey) {
      return row;
    }
  }
  return null;
};

export const findGridTableCellByColumnKey = (
  row: HTMLElement | null | undefined,
  columnKey: string
): HTMLElement | null => {
  if (!row) {
    return null;
  }
  const cells = row.querySelectorAll<HTMLElement>('.grid-cell[data-column]');
  for (const cell of cells) {
    if (cell.dataset.column === columnKey) {
      return cell;
    }
  }
  return null;
};

export const defaultGetSearchText = (row: unknown): string[] => {
  const record = asRecord(row);
  if (!record) {
    return [];
  }
  const values = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      values.add(value.trim());
    }
  };
  add(record.name);
  add(record.title);
  add(record.namespace);
  add(record.namespaceDisplay);
  add(record.kind);
  add(record.kindDisplay);
  const item = asRecord(record.item);
  if (item) {
    add(item.name);
    add(item.namespace);
    add(item.kind);
  }
  return Array.from(values);
};

export const getTextContent = (node: React.ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(getTextContent).join('');
  }
  if (React.isValidElement<TextElementProps>(node)) {
    const props = node.props;
    const exportText = props['data-gridtable-export-text'];
    if (typeof exportText === 'string') {
      return exportText;
    }
    if (props.children) {
      return getTextContent(props.children);
    }
    if (typeof props.title === 'string') {
      return props.title;
    }
  }
  return '';
};

export const detectWidthUnit = (input: ColumnWidthInput | undefined | null): ColumnWidthUnit => {
  if (typeof input === 'number') {
    return 'px';
  }
  if (!input || input === 'auto') {
    return 'px';
  }
  const match = input.match(/[a-z%]+$/i);
  if (!match) {
    return 'px';
  }
  const unit = match[0].toLowerCase();
  if (unit === 'px' || unit === 'em' || unit === 'rem' || unit === '%') {
    return unit as ColumnWidthUnit;
  }
  return 'px';
};

export const parseWidthInputToNumber = (input: ColumnWidthInput | undefined): number | null => {
  if (input === null || input === undefined) {
    return null;
  }
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : null;
  }
  if (input === 'auto') {
    return null;
  }
  const match = /^(-?\d+(?:\.\d+)?)(px|em|rem|%)$/.exec(input);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return null;
  }
  const unit = match[2] as ColumnWidthUnit;
  switch (unit) {
    case 'px':
      return value;
    case 'em':
    case 'rem':
      return value * DEFAULT_FONT_SIZE;
    case '%':
      return null;
    default:
      return null;
  }
};
