/**
 * frontend/src/shared/components/tables/columnFactories.test.ts
 *
 * Test suite for columnFactories.
 * Covers key behaviors and edge cases for columnFactories.
 */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import {
  applyColumnSizing,
  createKindColumn,
  createResourceBarColumn,
  createTextColumn,
  upsertNamespaceColumn,
  type ColumnSizingMap,
} from '@shared/components/tables/columnFactories';
import { resetAppPreferencesCacheForTesting } from '@/core/settings/appPreferences';

interface RowSample {
  id: string;
  name?: string;
  title?: string;
  kind?: string;
  alias?: string;
}

describe('columnFactories', () => {
  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
    localStorage.clear();
  });

  describe('createTextColumn', () => {
    it('renders interactive spans and triggers click handlers', () => {
      const onClick = vi.fn();
      const column = createTextColumn<RowSample>('name', 'Name', {
        onClick,
        getClassName: () => 'dynamic',
        getTitle: (row) => `Title for ${row.id}`,
        isInteractive: () => true,
      });

      const element = column.render({ id: '1', name: 'Row' });
      expect(React.isValidElement(element)).toBe(true);
      const span = element as React.ReactElement<{
        className: string;
        title?: string;
        onClick?: (event: unknown) => void;
        onKeyDown?: (event: unknown) => void;
        ['data-gridtable-shortcut-optout']?: string;
        ['data-gridtable-rowclick']?: string;
      }>;

      expect(span.props.className.includes('gridtable-link')).toBe(true);
      expect(span.props.className.includes('dynamic')).toBe(true);
      expect(span.props.title).toBe('Title for 1');
      expect(span.props['data-gridtable-shortcut-optout']).toBe('true');
      expect(span.props['data-gridtable-rowclick']).toBe('allow');

      span.props.onClick?.({ stopPropagation() {} } as any);
      span.props.onKeyDown?.({
        key: 'Enter',
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as any);

      expect(onClick).toHaveBeenCalledTimes(2);
    });
  });

  describe('upsertNamespaceColumn', () => {
    it('inserts namespace column immediately after name and removes duplicates', () => {
      const columns: GridColumnDefinition<RowSample>[] = [
        { key: 'kind', header: 'Kind', render: () => null },
        { key: 'name', header: 'Name', render: () => null },
        { key: 'status', header: 'Status', render: () => null },
      ];

      upsertNamespaceColumn(columns, {
        onClick: vi.fn(),
      });

      expect(columns.map((column) => column.key)).toEqual(['kind', 'name', 'namespace', 'status']);

      const secondInsert = [...columns];
      upsertNamespaceColumn(secondInsert, {
        onClick: vi.fn(),
      });
      expect(secondInsert.map((column) => column.key)).toEqual([
        'kind',
        'name',
        'namespace',
        'status',
      ]);
    });
  });

  describe('createKindColumn', () => {
    it('prefers aliases when short names are enabled and handles interactions', () => {
      localStorage.setItem('useShortResourceNames', 'true');
      const onKindClick = vi.fn();
      const column = createKindColumn<RowSample>({
        getKind: (row) => row.kind ?? '',
        getAlias: (row) => row.alias,
        onClick: onKindClick,
        isInteractive: () => true,
      });

      const element = column.render({ id: 'pod', kind: 'Pod', alias: 'P' });
      expect(React.isValidElement(element)).toBe(true);
      const badge = element as React.ReactElement<{
        ['data-kind-value']: string;
        children: React.ReactNode;
        onClick?: (event: unknown) => void;
        onKeyDown?: (event: unknown) => void;
        ['data-gridtable-shortcut-optout']?: string;
        ['data-gridtable-rowclick']?: string;
      }>;
      expect(badge.props['data-kind-value']).toBe('Pod');
      expect(badge.props.children).toBe('P');
      expect(badge.props['data-gridtable-shortcut-optout']).toBe('true');
      expect(badge.props['data-gridtable-rowclick']).toBe('allow');

      badge.props.onClick?.({ stopPropagation() {} } as any);
      badge.props.onKeyDown?.({
        key: ' ',
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as any);
      expect(onKindClick).toHaveBeenCalledTimes(2);
    });
  });

  describe('createResourceBarColumn', () => {
    it('returns a ResourceBar element even when values are missing', () => {
      const usageColumn = createResourceBarColumn<RowSample>({
        header: 'CPU',
        key: 'cpu',
        type: 'cpu',
        getUsage: () => '200m',
        getLimit: () => '500m',
        getVariant: () => 'compact',
      });

      const element = usageColumn.render({ id: 'row' });
      expect(React.isValidElement(element)).toBe(true);
      const resourceElement = element as React.ReactElement<Record<string, unknown>>;
      expect(resourceElement.props).toMatchObject({
        usage: '200m',
        limit: '500m',
        variant: 'compact',
        type: 'cpu',
      });

      const fallbackColumn = createResourceBarColumn<RowSample>({
        header: 'Memory',
        key: 'memory',
        type: 'memory',
        getUsage: () => undefined,
        getShowEmptyState: () => false,
      });

      const fallbackElement = fallbackColumn.render({ id: 'row-2' });
      expect(React.isValidElement(fallbackElement)).toBe(true);
      const fallbackProps = (fallbackElement as React.ReactElement<Record<string, unknown>>).props;
      expect(fallbackProps.showEmptyState).toBe(false);
    });
  });

  describe('applyColumnSizing', () => {
    it('applies width hints onto columns', () => {
      const columns: GridColumnDefinition<RowSample>[] = [
        { key: 'name', header: 'Name', render: () => null },
        { key: 'age', header: 'Age', render: () => null },
      ];
      const sizing: ColumnSizingMap = {
        name: { width: 120, minWidth: 100, maxWidth: 180, autoWidth: true },
      };
      applyColumnSizing(columns, sizing);
      expect(columns[0]).toMatchObject({
        width: 120,
        minWidth: 100,
        maxWidth: 180,
        autoWidth: true,
      });
      expect(columns[1].width).toBeUndefined();
    });
  });
});
