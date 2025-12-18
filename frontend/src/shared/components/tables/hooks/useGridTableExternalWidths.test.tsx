import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useGridTableExternalWidths } from '@shared/components/tables/hooks/useGridTableExternalWidths';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useGridTableExternalWidths', () => {
  const renderHarness = async (
    widths: Record<string, { width: number }> | null,
    callback: (value: Record<string, number> | null) => void
  ) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    const Harness: React.FC = () => {
      const value = useGridTableExternalWidths(widths as any);
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
    await renderHarness({ name: { width: 120 }, kind: { width: Number.NaN } } as any, (value) => {
      captured = value;
    });
    expect(captured).toEqual({ name: 120 });
  });
});
