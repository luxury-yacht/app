import React, { act, forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { useColumnResizeController } from '@shared/components/tables/hooks/useColumnResizeController';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SampleRow = {
  name: string;
  kind: string;
  status: string;
};

type HarnessProps = {
  enable?: boolean;
  measureWidth?: number;
};

type HarnessHandle = {
  beginResize: (event: React.MouseEvent, leftKey: string, rightKey: string) => void;
  autoSizeColumn: (columnKey: string) => void;
  resetManualResizes: () => void;
  getWidths: () => Record<string, number>;
  getManualKeys: () => string[];
};

const baseColumns: GridColumnDefinition<SampleRow>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (row) => row.name,
    minWidth: 140,
    maxWidth: 420,
  },
  {
    key: 'kind',
    header: 'Kind',
    render: (row) => row.kind,
    minWidth: 80,
    maxWidth: 360,
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => row.status,
    minWidth: 80,
    maxWidth: 200,
    width: 110,
  },
];

const getColumnMinWidth = <T,>(column: GridColumnDefinition<T>) =>
  typeof column.minWidth === 'number' ? column.minWidth : 60;
const getColumnMaxWidth = <T,>(column: GridColumnDefinition<T>) =>
  typeof column.maxWidth === 'number' ? column.maxWidth : 480;

const Harness = forwardRef<HarnessHandle, HarnessProps>(
  ({ enable = true, measureWidth = 320 }, ref) => {
    const [widths, setWidths] = useState<Record<string, number>>({
      name: 220,
      kind: 140,
      status: 110,
    });
    const manualRef = useRef(new Set<string>());

    const columns = useMemo(() => baseColumns, []);

    const controller = useColumnResizeController<SampleRow>({
      columns,
      renderedColumns: columns,
      columnWidths: widths,
      setColumnWidths: setWidths,
      manuallyResizedColumnsRef: manualRef,
      getColumnMinWidth,
      getColumnMaxWidth,
      measureColumnWidth: () => measureWidth,
      enableColumnResizing: enable,
      isFixedColumnKey: (key) => key === 'status',
    });

    const widthsRef = useRef(widths);
    widthsRef.current = widths;

    useImperativeHandle(
      ref,
      () => ({
        beginResize: controller.handleResizeStart,
        autoSizeColumn: controller.autoSizeColumn,
        resetManualResizes: controller.resetManualResizes,
        getWidths: () => widthsRef.current,
        getManualKeys: () => Array.from(manualRef.current),
      }),
      [controller]
    );

    return null;
  }
);

const renderHarness = async (props?: HarnessProps) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const ref = React.createRef<HarnessHandle>();
  const currentProps: HarnessProps = { enable: props?.enable, measureWidth: props?.measureWidth };

  await act(async () => {
    root.render(<Harness ref={ref} {...currentProps} />);
  });

  return {
    getHandle: () => {
      if (!ref.current) {
        throw new Error('Harness not mounted');
      }
      return ref.current;
    },
    rerender: async (nextProps: Partial<HarnessProps>) => {
      Object.assign(currentProps, nextProps);
      await act(async () => {
        root.render(<Harness ref={ref} {...currentProps} />);
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useColumnResizeController', () => {
  it('updates widths and manual keys when dragging between columns', async () => {
    const harness = await renderHarness();
    const handle = harness.getHandle();

    await act(async () => {
      handle.beginResize(
        {
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          clientX: 200,
        } as unknown as React.MouseEvent,
        'name',
        'kind'
      );
    });

    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 260 }));
    });

    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });

    const widths = handle.getWidths();
    expect(widths.name).toBe(280);
    expect(widths.kind).toBe(140);
    expect(handle.getManualKeys().sort()).toEqual(['name']);
    await harness.unmount();
  });

  it('auto-sizes a column without altering neighbors', async () => {
    const harness = await renderHarness({ measureWidth: 360 });
    const handle = harness.getHandle();

    await act(async () => {
      handle.autoSizeColumn('name');
    });

    const widths = handle.getWidths();
    expect(widths.name).toBe(360);
    expect(widths.kind).toBe(140);
    expect(handle.getManualKeys()).toEqual(['name']);
    await harness.unmount();
  });

  it('clears manual state when resetManualResizes is invoked', async () => {
    const harness = await renderHarness();
    const handle = harness.getHandle();

    await act(async () => {
      handle.beginResize(
        {
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          clientX: 210,
        } as unknown as React.MouseEvent,
        'name',
        'kind'
      );
    });

    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 240 }));
    });

    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(handle.getManualKeys().sort()).toEqual(['name']);

    await act(async () => {
      handle.resetManualResizes();
    });

    expect(handle.getManualKeys()).toHaveLength(0);
    await harness.unmount();
  });

  it('no-ops when resizing is disabled', async () => {
    const harness = await renderHarness({ enable: false });
    const handle = harness.getHandle();

    const initial = handle.getWidths();

    await act(async () => {
      handle.beginResize(
        {
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
          clientX: 180,
        } as unknown as React.MouseEvent,
        'name',
        'kind'
      );
    });

    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 240 }));
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(handle.getWidths()).toEqual(initial);
    expect(handle.getManualKeys()).toHaveLength(0);
    await harness.unmount();
  });
});
