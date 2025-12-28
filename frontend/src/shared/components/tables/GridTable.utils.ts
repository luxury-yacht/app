/**
 * frontend/src/shared/components/tables/GridTable.utils.ts
 *
 * Utility helpers for GridTable.utils.
 * Provides shared helper functions for the shared components.
 */

import React from 'react';
import type { ColumnWidthInput, ColumnWidthUnit } from '@shared/components/tables/GridTable.types';

export const DEFAULT_COLUMN_WIDTH = 150;
export const DEFAULT_COLUMN_MIN_WIDTH = 72;
export const DEFAULT_FONT_SIZE = 16;

const FIXED_KIND_KEYS = new Set(['kind', 'type']);

export const isKindColumnKey = (key: string) => FIXED_KIND_KEYS.has(key);
export const isFixedColumnKey = (key: string) => isKindColumnKey(key);

export const normalizeKindClass = (value: string) => {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.length > 0 ? normalized : 'kind';
};

export const defaultGetKind = (row: any): string | null => {
  if (!row || typeof row !== 'object') {
    return null;
  }
  if (typeof row.kindDisplay === 'string') {
    return row.kindDisplay;
  }
  if (typeof row.kind === 'string') {
    return row.kind;
  }
  if (row.item && typeof row.item.kind === 'string') {
    return row.item.kind;
  }
  return null;
};

export const defaultGetNamespace = (row: any): string | null => {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const value =
    typeof row.namespaceDisplay === 'string'
      ? row.namespaceDisplay
      : typeof row.namespace === 'string'
        ? row.namespace
        : row.item && typeof row.item.namespace === 'string'
          ? row.item.namespace
          : null;
  if (value === '—') {
    return '';
  }
  return value;
};

export const defaultGetClusterId = (row: any): string | null => {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const value =
    typeof row.clusterId === 'string'
      ? row.clusterId
      : row.item && typeof row.item.clusterId === 'string'
        ? row.item.clusterId
        : typeof row.clusterName === 'string'
          ? row.clusterName
          : row.item && typeof row.item.clusterName === 'string'
            ? row.item.clusterName
            : null;
  return value ?? null;
};

export const defaultGetClusterName = (row: any): string | null => {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const value =
    typeof row.clusterName === 'string'
      ? row.clusterName
      : row.item && typeof row.item.clusterName === 'string'
        ? row.item.clusterName
        : null;
  return value ?? null;
};

// Prefix row keys with cluster identity to keep multi-cluster rows stable.
export const buildClusterScopedKey = (row: any, baseKey: string): string => {
  const clusterId = defaultGetClusterId(row);
  const trimmed = typeof clusterId === 'string' ? clusterId.trim() : '';
  return trimmed ? `${trimmed}|${baseKey}` : baseKey;
};

export const defaultGetSearchText = (row: any): string[] => {
  if (!row || typeof row !== 'object') {
    return [];
  }
  const values = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      values.add(value.trim());
    }
  };
  add(row.name);
  add(row.title);
  add(row.namespace);
  add(row.namespaceDisplay);
  add(row.kind);
  add(row.kindDisplay);
  if (row.item && typeof row.item === 'object') {
    add(row.item.name);
    add(row.item.namespace);
    add(row.item.kind);
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
  if (React.isValidElement(node)) {
    const props = node.props as any;
    if (props.children) {
      return getTextContent(props.children);
    }
    if (props.title) {
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
  if (input == null) {
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
