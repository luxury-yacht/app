/**
 * frontend/src/shared/components/tables/hooks/useGridTableExternalWidths.test.tsx
 *
 * Test suite for useGridTableExternalWidths.
 * Covers key behaviors and edge cases for useGridTableExternalWidths.
 */

import type { ColumnWidthState } from '@shared/components/tables/GridTable.types';
import { useGridTableExternalWidths } from '@shared/components/tables/hooks/useGridTableExternalWidths';
import type React from 'react';
import { act, useEffect } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useGridTableExternalWidths', () => {
  const renderHarness = async (
    widths: Record<string, ColumnWidthState> | null,
    callback: (value: Record<string, number> | null) => void
  ) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    const Harness: React.FC = () => {
      const value = useGridTableExternalWidths(widths);
      useEffect(() => {
        callback(value);
      }, [value]);
      return null;
    };

    await act(async () => {
      root.render(<Harness />);
    });
  };

  it('returns null when controlled widths absent', async () => {
    let captured: Record<string, number> | null = { name: 1 };
    await renderHarness(null, (value) => {
      captured = value;
    });
    expect(captured).toBeNull();
  });

  it('filters valid numeric widths', async () => {
    let captured: Record<string, number> | null = null;
    await renderHarness(
      {
        name: { width: 120, unit: 'px', autoWidth: false, source: 'user', updatedAt: 0 },
        kind: { width: Number.NaN, unit: 'px', autoWidth: false, source: 'user', updatedAt: 0 },
      },
      (value) => {
        captured = value;
      }
    );
    expect(captured).toEqual({ name: 120 });
  });
});
