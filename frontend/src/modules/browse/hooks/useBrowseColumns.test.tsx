import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { CatalogItem } from '@/core/refresh/types';
import { makeResourceRef } from '@/test-utils/makeResourceRef';
import { requireReactElement } from '@/test-utils/requireReactElement';
import type { BrowseTableRow } from './useBrowseColumns';
import { toTableRows, useBrowseColumns } from './useBrowseColumns';

const navigateToView = vi.hoisted(() => vi.fn());

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView }),
}));

const renderHook = <T,>(hook: () => T) => {
  const result: { current: T | undefined } = { current: undefined };

  const TestComponent: React.FC = () => {
    result.current = hook();
    return null;
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  act(() => {
    root.render(<TestComponent />);
  });

  return {
    get() {
      if (result.current === undefined) {
        throw new Error('Hook result not set');
      }
      return result.current;
    },
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const catalogItem = (namespace: string): CatalogItem => ({
  ref: makeResourceRef({
    clusterId: 'cluster-a',
    group: 'batch',
    version: 'v1',
    kind: 'CronJob',
    resource: 'cronjobs',
    namespace,
    name: 'nightly',
  }),
  resourceVersion: '7',
  creationTimestamp: '2026-08-04T12:00:00Z',
  scope: 'Namespace',
  actionFacts: { status: 'Suspended' },
});

describe('useBrowseColumns', () => {
  it('covers useBrowseColumns scenarios', async () => {
    // Scenario: declares catalog metadata on Browse rows
    expectTypeOf<BrowseTableRow['metadata']>().toEqualTypeOf<CatalogItem['metadata']>();

    {
      // Scenario: preserves action facts without projecting a display-only Status field
      const [row] = toTableRows([catalogItem('team-a')], false);

      expect(row).toEqual(
        expect.objectContaining({
          apiDisplay: 'batch/v1',
          namespaceDisplay: 'team-a',
          ageTimestamp: Date.parse('2026-08-04T12:00:00Z'),
          actionFacts: { status: 'Suspended' },
        })
      );
      expect(row).not.toHaveProperty('statusDisplay');
    }

    {
      // Scenario: omits Status from namespace and cross-namespace column sets
      const onRowClick = vi.fn();
      const onNamespaceClick = vi.fn();
      const namespaceHook = renderHook(() =>
        useBrowseColumns({ showNamespaceColumn: false, onRowClick, onNamespaceClick })
      );
      const namespaceColumns = namespaceHook.get();
      expect(namespaceColumns.map((column) => column.key)).toEqual(['kind', 'name', 'api', 'age']);

      const crossNamespaceHook = renderHook(() =>
        useBrowseColumns({ showNamespaceColumn: true, onRowClick, onNamespaceClick })
      );
      const crossNamespaceColumns = crossNamespaceHook.get();
      expect(crossNamespaceColumns.map((column) => column.key)).toEqual([
        'kind',
        'name',
        'api',
        'namespace',
        'age',
      ]);

      const [row] = toTableRows([catalogItem('team-a')], false);
      for (const column of crossNamespaceColumns) {
        column.render(row);
        column.sortValue?.(row);
      }

      const namespaceColumn = crossNamespaceColumns.find((column) => column.key === 'namespace');
      const namespaceCell = requireReactElement<{
        onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
      }>(namespaceColumn?.render(row), 'expected interactive namespace cell');
      namespaceCell.props.onClick?.({ altKey: false } as React.MouseEvent<HTMLButtonElement>);
      expect(onNamespaceClick).toHaveBeenCalledWith('team-a', 'cluster-a');

      const nameColumn = crossNamespaceColumns.find((column) => column.key === 'name');
      const nameCell = requireReactElement<{
        onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
      }>(nameColumn?.render(row), 'expected interactive name cell');
      nameCell.props.onClick?.({
        altKey: true,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLButtonElement>);
      expect(navigateToView).toHaveBeenCalledWith(expect.objectContaining({ name: 'nightly' }));

      namespaceHook.cleanup();
      crossNamespaceHook.cleanup();
    }

    {
      // Scenario: lets every Browse column size itself from the current page content
      const hook = renderHook(() =>
        useBrowseColumns({
          showNamespaceColumn: true,
          onRowClick: vi.fn(),
          onNamespaceClick: vi.fn(),
        })
      );

      expect(hook.get().map((column) => [column.key, column.autoWidth])).toEqual([
        ['kind', true],
        ['name', true],
        ['api', true],
        ['namespace', true],
        ['age', true],
      ]);

      hook.cleanup();
    }
  });
});
