/**
 * frontend/src/modules/resource-grid/useResourceGridTable.test.tsx
 *
 * Verifies resource-grid hooks publish the canonical row key through the
 * shared GridTable binding instead of requiring each view to thread it again.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { useObjectPanelResourceGridTable } from './useResourceGridTable';
import type { ResourceGridTableResult, ResourceGridTableRow } from './resourceGridTableTypes';

interface TestRow extends ResourceGridTableRow {
  kind: string;
  name: string;
  namespace: string;
  clusterId: string;
}

const columns: GridColumnDefinition<TestRow>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (row) => row.name,
  },
];

const row: TestRow = {
  kind: 'Pod',
  name: 'api',
  namespace: 'team-a',
  clusterId: 'alpha:ctx',
};

const renderObjectPanelGrid = (
  props: Partial<Parameters<typeof useObjectPanelResourceGridTable<TestRow>>[0]> = {}
) => {
  const result: { current: ResourceGridTableResult<TestRow> | undefined } = { current: undefined };

  const Probe: React.FC = () => {
    result.current = useObjectPanelResourceGridTable<TestRow>({
      viewId: 'test-grid',
      tableMode: 'Local Complete',
      clusterIdentity: 'alpha:ctx',
      data: [row],
      columns,
      ...props,
    });
    return null;
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  act(() => {
    root.render(<Probe />);
  });

  if (!result.current) {
    throw new Error('resource grid hook did not render');
  }
  act(() => {
    root.unmount();
  });
  container.remove();
  return result.current;
};

describe('useObjectPanelResourceGridTable', () => {
  it('publishes the default canonical object key on gridTableProps', () => {
    const result = renderObjectPanelGrid();

    expect(result.gridTableProps.keyExtractor(row, 0)).toBe('alpha:ctx|/v1/Pod/team-a/api');
  });

  it('publishes a supplied key extractor on gridTableProps', () => {
    const keyExtractor = vi.fn((item: TestRow) => `custom:${item.name}`);
    const result = renderObjectPanelGrid({ keyExtractor });

    expect(result.gridTableProps.keyExtractor(row, 0)).toBe('custom:api');
    expect(keyExtractor).toHaveBeenCalledWith(row, 0);
  });
});
