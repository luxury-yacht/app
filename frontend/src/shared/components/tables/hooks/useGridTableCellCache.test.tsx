/**
 * frontend/src/shared/components/tables/hooks/useGridTableCellCache.test.tsx
 *
 * Test suite for useGridTableCellCache.
 * Covers key behaviors and edge cases for useGridTableCellCache.
 */

import React from 'react';
import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { useGridTableCellCache } from '@shared/components/tables/hooks/useGridTableCellCache';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SampleRow = { id: string; kind?: string };

const columns: GridColumnDefinition<SampleRow>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (row) => row.id,
  },
  {
    key: 'kind',
    header: 'Kind',
    render: (row) => <span data-kind-value={row.kind ?? ''}>{row.kind ?? ''}</span>,
  },
];

const renderHarness = async (renderedColumns: GridColumnDefinition<SampleRow>[]) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  let getter:
    | ((
        column: GridColumnDefinition<SampleRow>,
        row: SampleRow
      ) => {
        content: React.ReactNode;
        text: string;
      })
    | null = null;

  const Harness: React.FC = () => {
    const { getCachedCellContent } = useGridTableCellCache<SampleRow>({
      renderedColumns,
      isKindColumnKey: (key) => key === 'kind',
      getTextContent: (node) => {
        if (typeof node === 'string') return node;
        if (Array.isArray(node)) {
          return node.map((item) => (typeof item === 'string' ? item : '')).join('');
        }
        if (React.isValidElement(node)) {
          const props = node.props as { children?: React.ReactNode };
          if (typeof props.children === 'string') {
            return props.children;
          }
        }
        return '';
      },
      normalizeKindClass: (value) => value.toLowerCase(),
    });

    getter = getCachedCellContent;
    return null;
  };

  await act(async () => {
    root.render(<Harness />);
  });

  return {
    get: (column: GridColumnDefinition<SampleRow>, row: SampleRow) => {
      if (!getter) {
        throw new Error('cache getter unavailable');
      }
      return getter(column, row);
    },
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useGridTableCellCache', () => {
  it('caches primitive and object renders', async () => {
    const harness = await renderHarness(columns);
    const row: SampleRow = { id: 'alpha' };

    const first = harness.get(columns[0], row);
    expect(first.text).toBe('alpha');

    const second = harness.get(columns[0], row);
    expect(second).toBe(first);

    await harness.cleanup();
  });

  it('wraps kind content with normalized classes', async () => {
    const harness = await renderHarness(columns);
    const result = harness.get(columns[1], { id: 'beta', kind: 'Deployment' });
    expect(React.isValidElement(result.content)).toBe(true);
    const className = ((result.content as React.ReactElement).props as { className?: string })
      .className;
    expect(className).toContain('kind-badge');
    expect(className).toContain('deployment');

    await harness.cleanup();
  });
});
