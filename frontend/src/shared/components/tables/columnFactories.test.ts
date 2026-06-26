/**
 * frontend/src/shared/components/tables/columnFactories.test.ts
 *
 * Test suite for columnFactories.
 * Covers key behaviors and edge cases for columnFactories.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import {
  applyColumnSizing,
  createAgeColumn,
  createKindColumn,
  createResourceBarColumn,
  createTextColumn,
  upsertNamespaceColumn,
  type ColumnSizingMap,
} from '@shared/components/tables/columnFactories';
import { getTextContent } from '@shared/components/tables/GridTable.utils';
import {
  resetAppPreferencesCacheForTesting,
  setAppPreferencesForTesting,
} from '@/core/settings/appPreferences';

interface RowSample {
  id: string;
  name?: string;
  title?: string;
  kind?: string;
  alias?: string;
}

describe('columnFactories', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createAgeColumn', () => {
    it('renders from ageTimestamp and repaints while the row object is unchanged', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = ReactDOM.createRoot(container);
      const createdAt = Date.parse('2026-01-01T00:00:00Z');
      const row = { id: 'row-1', age: 'stale', ageTimestamp: createdAt };
      const column = createAgeColumn<typeof row>();

      try {
        await act(async () => {
          root.render(React.createElement(React.Fragment, null, column.render(row)));
          await Promise.resolve();
        });

        expect(container.textContent).toBe('10s');
        expect(getTextContent(column.render(row))).toBe('10s');
        expect(column.sortValue?.(row)).toBe(-createdAt);

        await act(async () => {
          vi.advanceTimersByTime(1000);
          await Promise.resolve();
        });

        expect(container.textContent).toBe('11s');
      } finally {
        act(() => root.unmount());
        container.remove();
      }
    });

    it('falls back to the existing age string when no timestamp is available', () => {
      const column = createAgeColumn<{ age?: string; ageTimestamp?: number }>();

      expect(column.render({ age: '5m' })).toBe('5m');
      expect(column.sortValue?.({ age: '5m' })).toBe('5m');
    });
  });

  describe('createTextColumn', () => {
    it('uses the display accessor as the default local sort value', () => {
      const column = createTextColumn<RowSample>('owner', 'Owner', (row) => row.title ?? row.name, {
        getClassName: () => 'owner-cell',
      });

      expect(column.sortValue?.({ id: '1', name: 'api', title: 'Deployment/api' })).toBe(
        'Deployment/api'
      );
    });

    it('allows an explicit local sort value to override display text', () => {
      const column = createTextColumn<RowSample>('updated', 'Updated', () => '6/2/2026 10:30 AM', {
        sortValue: (row) => row.title,
      });

      expect(column.sortValue?.({ id: '1', title: '2026-06-02T16:30:00Z' })).toBe(
        '2026-06-02T16:30:00Z'
      );
    });

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
      setAppPreferencesForTesting({ useShortResourceNames: true });
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
      expect(resourceElement.props['data-gridtable-export-text']).toBe('200m');
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
      expect(fallbackProps['data-gridtable-export-text']).toBe('-');
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
