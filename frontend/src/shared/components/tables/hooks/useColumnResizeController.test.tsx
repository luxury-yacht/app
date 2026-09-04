/**
 * frontend/src/shared/components/tables/hooks/useColumnResizeController.test.tsx
 *
 * Test suite for useColumnResizeController.
 * Covers key behaviors and edge cases for useColumnResizeController.
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { useColumnResizeController } from '@shared/components/tables/hooks/useColumnResizeController';
import React, { act, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installWailsDragRuntime } from '@/test-utils/wailsDragRuntime.test.helpers';

type SampleRow = {
  name: string;
  kind: string;
  status: string;
};

type HarnessProps = {
  enable?: boolean;
  measureWidth?: number;
  onManualResize?: (event: {
    type: 'dragStart' | 'drag' | 'dragEnd' | 'autoSize' | 'reset';
    columns: string[];
  }) => void;
};

type HarnessHandle = {
  beginResize: (event: React.MouseEvent, leftKey: string, rightKey: string) => void;
  resizeWithKeyboard: (event: React.KeyboardEvent, columnKey: string) => void;
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
    resizable: false,
  },
];

const Harness = ({
  enable = true,
  measureWidth = 320,
  onManualResize,
  ref,
}: HarnessProps & { ref?: React.Ref<HarnessHandle> }) => {
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
    measureColumnWidth: () => measureWidth,
    enableColumnResizing: enable,
    onManualResize,
  });

  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  useImperativeHandle(
    ref,
    () => ({
      beginResize: controller.handleResizeStart,
      resizeWithKeyboard: controller.handleResizeKeyDown,
      autoSizeColumn: controller.autoSizeColumn,
      resetManualResizes: controller.resetManualResizes,
      getWidths: () => widthsRef.current,
      getManualKeys: () => Array.from(manualRef.current),
    }),
    [controller]
  );

  return null;
};

const renderHarness = async (props?: HarnessProps) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const ref = React.createRef<HarnessHandle>();
  const currentProps: HarnessProps = { enable: props?.enable, measureWidth: props?.measureWidth };
  currentProps.onManualResize = props?.onManualResize;

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
  it.each(['windows', 'linux'] as const)(
    'does not restore a finished column cursor after leaving a %s window edge',
    async (os) => {
      const runtime = await installWailsDragRuntime(os);
      const harness = await renderHarness();
      try {
        await act(async () => {
          harness.getHandle().beginResize(
            {
              clientX: 200,
              preventDefault: vi.fn(),
              stopPropagation: vi.fn(),
            } as unknown as React.MouseEvent,
            'name',
            'kind'
          );
        });
        await act(async () => {
          document.body.dispatchEvent(
            new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 300, buttons: 1 })
          );
        });
        expect(document.body.style.cursor).toBe('ew-resize');
        await act(async () => {
          document.body.dispatchEvent(
            new MouseEvent('mouseup', { bubbles: true, clientX: 1, clientY: 300 })
          );
        });
        document.body.dispatchEvent(
          new MouseEvent('mousemove', { bubbles: true, clientX: 400, clientY: 300 })
        );
        expect(document.body.style.cursor).not.toBe('col-resize');
      } finally {
        await harness.unmount();
        runtime.cleanup();
        document.body.style.cursor = '';
      }
    }
  );

  it('resizes a column with Arrow, Home, and End keys within its configured bounds', async () => {
    const harness = await renderHarness();
    const handle = harness.getHandle();
    const keyEvent = (key: string) =>
      ({
        key,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      }) as unknown as React.KeyboardEvent;

    await act(async () => handle.resizeWithKeyboard(keyEvent('ArrowRight'), 'name'));
    expect(handle.getWidths().name).toBe(236);

    await act(async () => handle.resizeWithKeyboard(keyEvent('Home'), 'name'));
    expect(handle.getWidths().name).toBe(140);

    await act(async () => handle.resizeWithKeyboard(keyEvent('End'), 'name'));
    expect(handle.getWidths().name).toBe(420);
    expect(handle.getManualKeys()).toEqual(['name']);

    await harness.unmount();
  });

  it('wraps each keyboard resize in a complete manual-resize lifecycle', async () => {
    const onManualResize = vi.fn();
    const harness = await renderHarness({ onManualResize });
    const event = {
      key: 'ArrowRight',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.KeyboardEvent;

    await act(async () => harness.getHandle().resizeWithKeyboard(event, 'name'));

    expect(onManualResize.mock.calls.map(([resizeEvent]) => resizeEvent.type)).toEqual([
      'dragStart',
      'drag',
      'dragEnd',
    ]);
    await harness.unmount();
  });

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

  it('prevents native drag initiation when a pointer resize starts', async () => {
    const harness = await renderHarness();
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 200,
    } as unknown as React.MouseEvent;

    await act(async () => {
      harness.getHandle().beginResize(event, 'name', 'kind');
    });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();

    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
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
