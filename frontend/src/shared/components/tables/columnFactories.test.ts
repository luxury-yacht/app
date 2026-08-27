/**
 * frontend/src/shared/components/tables/columnFactories.test.ts
 *
 * Test suite for columnFactories.
 * Covers key behaviors and edge cases for columnFactories.
 */

import {
  type ColumnSizingMap,
  createAgeColumn,
  createKindColumn,
  createResourceBarColumn,
  createResourceNameColumn,
  createTextColumn,
  withAutoWidthColumns,
  withColumnSizing,
  withNamespaceColumn,
} from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { getTextContent } from '@shared/components/tables/GridTable.utils';
import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
        expect(column.measurementText?.(row)).toBe('10s');
        expect(column.sortValue?.(row)).toBe(-createdAt);

        await act(async () => {
          vi.advanceTimersByTime(1000);
          await Promise.resolve();
        });

        expect(container.textContent).toBe('11s');
        expect(column.measurementText?.(row)).toBe('11s');
      } finally {
        act(() => root.unmount());
        container.remove();
      }
    });

    it('falls back to the existing age string when no timestamp is available', () => {
      const column = createAgeColumn<{ age?: string; ageTimestamp?: number }>();

      expect(column.render({ age: '5m' })).toBe('5m');
      expect(column.measurementText?.({ age: '5m' })).toBe('5m');
      expect(column.sortValue?.({ age: '5m' })).toBe(300);
    });
  });

  describe('createTextColumn', () => {
    it('preserves independent header and data alignment', () => {
      const column = createTextColumn<RowSample>('name', 'Name', {
        alignHeader: 'center',
        alignData: 'right',
      });

      expect(column.alignHeader).toBe('center');
      expect(column.alignData).toBe('right');
    });

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

    it('renders interactive values as native buttons and triggers click handlers', () => {
      const onClick = vi.fn();
      const column = createTextColumn<RowSample>('name', 'Name', {
        onClick,
        getClassName: () => 'dynamic',
        getTitle: (row) => `Title for ${row.id}`,
        isInteractive: () => true,
      });

      const element = column.render({ id: '1', name: 'Row' });
      expect(React.isValidElement(element)).toBe(true);
      expect((element as React.ReactElement).type).toBe('button');
      const button = element as React.ReactElement<{
        className: string;
        title?: string;
        onClick?: (event: unknown) => void;
        onKeyDown?: (event: unknown) => void;
        'data-gridtable-shortcut-optout'?: string;
        'data-gridtable-rowclick'?: string;
      }>;

      expect(button.props.className.includes('gridtable-link')).toBe(true);
      expect(button.props.className.includes('dynamic')).toBe(true);
      expect(button.props.title).toBe('Title for 1');
      expect(button.props['data-gridtable-shortcut-optout']).toBe('true');
      expect(button.props['data-gridtable-rowclick']).toBe('allow');

      button.props.onClick?.({ stopPropagation: () => undefined } as unknown);

      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('createResourceNameColumn', () => {
    it('declares resource identity as required and gives it a useful default width', () => {
      const column = createResourceNameColumn<RowSample>((row) => row.name);

      expect(column.key).toBe('name');
      expect(column.hideable).toBe(false);
      expect(column.width).toBe(250);
      expect(column.resizable).not.toBe(false);
    });
  });

  describe('withNamespaceColumn', () => {
    it('immutably inserts namespace after the declared anchor and removes duplicates', () => {
      const columns: GridColumnDefinition<RowSample>[] = [
        { key: 'kind', header: 'Kind', render: () => null },
        { key: 'name', header: 'Name', render: () => null },
        { key: 'status', header: 'Status', render: () => null },
      ];

      const firstInsert = withNamespaceColumn(columns, {
        afterColumnKey: 'name',
        onClick: vi.fn(),
      });

      expect(columns.map((column) => column.key)).toEqual(['kind', 'name', 'status']);
      expect(firstInsert.map((column) => column.key)).toEqual([
        'kind',
        'name',
        'namespace',
        'status',
      ]);

      const secondInsert = withNamespaceColumn(firstInsert, {
        afterColumnKey: 'name',
        onClick: vi.fn(),
      });
      expect(secondInsert.map((column) => column.key)).toEqual([
        'kind',
        'name',
        'namespace',
        'status',
      ]);
    });

    it('rejects a missing anchor instead of silently changing the layout', () => {
      const columns: GridColumnDefinition<RowSample>[] = [
        { key: 'kind', header: 'Kind', render: () => null },
      ];

      expect(() =>
        withNamespaceColumn(columns, {
          afterColumnKey: 'name',
          onClick: vi.fn(),
        })
      ).toThrow('GridTable namespace column anchor not found: "name"');
    });
  });

  describe('createKindColumn', () => {
    it('owns badge rendering and ordinary column capabilities', () => {
      const column = createKindColumn<RowSample>({ getKind: (row) => row.kind ?? '' });
      const badge = column.render({ id: 'deployment', kind: 'Deployment' }) as React.ReactElement<{
        className?: string;
      }>;

      expect(badge.props.className?.split(' ')).toEqual(
        expect.arrayContaining(['kind-badge', 'hash-color-11'])
      );
      expect(column.hideable).not.toBe(false);
      expect(column.resizable).not.toBe(false);
    });

    it('preserves independent header and data alignment', () => {
      const column = createKindColumn<RowSample>({
        getKind: (row) => row.kind ?? '',
        alignHeader: 'right',
        alignData: 'center',
      });

      expect(column.alignHeader).toBe('right');
      expect(column.alignData).toBe('center');
    });

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
      expect((element as React.ReactElement).type).toBe('button');
      const badge = element as React.ReactElement<{
        className?: string;
        'data-kind-value': string;
        children: React.ReactNode;
        onClick?: (event: unknown) => void;
        onKeyDown?: (event: unknown) => void;
        'data-gridtable-shortcut-optout'?: string;
        'data-gridtable-rowclick'?: string;
      }>;
      expect(badge.props['data-kind-value']).toBe('Pod');
      expect(badge.props.children).toBe('P');
      expect(badge.props.className?.split(' ')).not.toContain('gridtable-cell-button');
      expect(badge.props['data-gridtable-shortcut-optout']).toBe('true');
      expect(badge.props['data-gridtable-rowclick']).toBe('allow');

      badge.props.onClick?.({ stopPropagation: () => undefined } as unknown);
      expect(onKindClick).toHaveBeenCalledTimes(1);
    });

    it('can suppress the row action for an interactive kind badge', () => {
      const column = createKindColumn<RowSample>({
        getKind: (row) => row.kind ?? '',
        onClick: vi.fn(),
        allowRowClick: false,
      });

      const badge = column.render({ id: 'namespace', kind: 'Namespace' }) as React.ReactElement<{
        'data-gridtable-rowclick'?: string;
      }>;

      expect(badge.props['data-gridtable-rowclick']).toBe('suppress');
    });
  });

  describe('createTextColumn', () => {
    it('can suppress the row action for an independent interactive target', () => {
      const column = createTextColumn<RowSample>('name', 'Name', (row) => row.name ?? '', {
        onClick: vi.fn(),
        allowRowClick: false,
      });

      const button = column.render({ id: 'pod', name: 'api' }) as React.ReactElement<{
        'data-gridtable-rowclick'?: string;
      }>;

      expect(button.props['data-gridtable-rowclick']).toBe('suppress');
    });
  });

  describe('createResourceBarColumn', () => {
    it('preserves independent header and data alignment', () => {
      const column = createResourceBarColumn<RowSample>({
        header: 'CPU',
        type: 'cpu',
        getUsage: () => '200m',
        alignHeader: 'center',
        alignData: 'right',
      });

      expect(column.alignHeader).toBe('center');
      expect(column.alignData).toBe('right');
    });

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

    it('exports tebibyte memory usage with the same value shown by ResourceBar', () => {
      const column = createResourceBarColumn<RowSample>({
        header: 'Memory',
        type: 'memory',
        getUsage: () => '1.5Ti',
      });

      const element = column.render({ id: 'node' }) as React.ReactElement<Record<string, unknown>>;

      expect(element.props['data-gridtable-export-text']).toBe('1.5Ti');
    });

    it('exports explicit zero memory usage instead of treating it as absent', () => {
      const column = createResourceBarColumn<RowSample>({
        header: 'Memory',
        type: 'memory',
        getUsage: () => '0Mi',
      });

      const element = column.render({ id: 'node' }) as React.ReactElement<Record<string, unknown>>;

      expect(element.props['data-gridtable-export-text']).toBe('0');
    });
  });

  describe('withColumnSizing', () => {
    it('immutably applies width hints onto columns', () => {
      const columns: GridColumnDefinition<RowSample>[] = [
        { key: 'name', header: 'Name', render: () => null },
        { key: 'age', header: 'Age', render: () => null },
      ];
      const sizing: ColumnSizingMap = {
        name: { width: 120, minWidth: 100, maxWidth: 180, autoWidth: true },
      };
      const sized = withColumnSizing(columns, sizing);
      expect(columns[0].width).toBeUndefined();
      expect(sized[0]).toMatchObject({
        width: 120,
        minWidth: 100,
        maxWidth: 180,
        autoWidth: true,
      });
      expect(sized[1].width).toBeUndefined();
    });

    it('enables automatic sizing without replacing existing column defaults', () => {
      const columns: GridColumnDefinition<RowSample>[] = [
        { key: 'name', header: 'Name', width: 250, render: () => null },
        { key: 'kind', header: 'Kind', width: 100, autoWidth: true, render: () => null },
      ];

      const sized = withAutoWidthColumns(columns);

      expect(sized).toMatchObject([
        { key: 'name', width: 250, autoWidth: true },
        { key: 'kind', width: 100, autoWidth: true },
      ]);
      expect(columns[0].autoWidth).toBeUndefined();
      expect(sized[1]).toBe(columns[1]);
    });
  });
});
