/**
 * frontend/src/shared/components/tables/hooks/useColumnVisibilityController.test.tsx
 *
 * Test suite for useColumnVisibilityController.
 * Covers key behaviors and edge cases for useColumnVisibilityController.
 */

import React, { act, useImperativeHandle } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { useColumnVisibilityController } from '@shared/components/tables/hooks/useColumnVisibilityController';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SampleRow = { name: string };

const columns: GridColumnDefinition<SampleRow>[] = [
  { key: 'name', header: 'Name', render: (row) => row.name },
  { key: 'namespace', header: 'Namespace', render: (row) => row.name },
  { key: 'status', header: 'Status', render: (row) => row.name },
  { key: 'kind', header: 'Kind', render: (row) => row.name },
  { key: 'age', header: 'Age', render: (row) => row.name },
];

type HarnessHandle = {
  toggle: (key: string) => void;
  isVisible: (key: string) => boolean;
  getRenderedKeys: () => string[];
};

interface HarnessProps {
  columnVisibility?: Record<string, boolean>;
  nonHideableColumns?: string[];
  onColumnVisibilityChange?: (next: Record<string, boolean>) => void;
}

const createHarness = async (props: HarnessProps = {}) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const ref = React.createRef<HarnessHandle>();

  const Harness = React.forwardRef<HarnessHandle, HarnessProps>((incomingProps, forwardRef) => {
    const controller = useColumnVisibilityController<SampleRow>({
      columns,
      columnVisibility: incomingProps.columnVisibility,
      nonHideableColumns: incomingProps.nonHideableColumns ?? [],
      onColumnVisibilityChange: incomingProps.onColumnVisibilityChange,
    });

    const renderedKeysRef = React.useRef(controller.renderedColumns.map((col) => col.key));
    const visibilityFnRef = React.useRef(controller.isColumnVisible);

    React.useEffect(() => {
      renderedKeysRef.current = controller.renderedColumns.map((col) => col.key);
      visibilityFnRef.current = controller.isColumnVisible;
    }, [controller.renderedColumns, controller.isColumnVisible]);

    useImperativeHandle(forwardRef, () => ({
      toggle: controller.toggleColumnVisibility,
      isVisible: (key: string) => visibilityFnRef.current(key),
      getRenderedKeys: () => renderedKeysRef.current,
    }));

    return null;
  });

  await act(async () => {
    root.render(<Harness ref={ref} {...props} />);
  });

  return {
    handle: () => {
      if (!ref.current) {
        throw new Error('Harness not initialised');
      }
      return ref.current;
    },
    rerender: async (nextProps: HarnessProps) => {
      await act(async () => {
        root.render(<Harness ref={ref} {...nextProps} />);
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

describe('useColumnVisibilityController', () => {
  it('toggles visibility and respects locked columns', async () => {
    const onChange = vi.fn();
    const harness = await createHarness({
      nonHideableColumns: ['namespace'],
      onColumnVisibilityChange: onChange,
    });
    const handle = harness.handle();

    expect(handle.getRenderedKeys()).toContain('namespace');
    expect(handle.getRenderedKeys()).toContain('status');

    await act(async () => {
      handle.toggle('status');
      await Promise.resolve();
    });

    expect(handle.isVisible('status')).toBe(false);
    expect(handle.getRenderedKeys()).not.toContain('status');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: false }));

    await act(async () => {
      handle.toggle('namespace');
    });

    expect(handle.isVisible('namespace')).toBe(true);

    await harness.unmount();
  });

  it('syncs controlled visibility state', async () => {
    const harness = await createHarness({ columnVisibility: { namespace: false } });
    const handle = harness.handle();
    expect(handle.isVisible('namespace')).toBe(false);
    expect(handle.getRenderedKeys()).not.toContain('namespace');

    await harness.rerender({ columnVisibility: { namespace: true } });
    await act(async () => {
      await Promise.resolve();
    });
    expect(handle.isVisible('namespace')).toBe(true);

    await harness.unmount();
  });

  it('allows hiding Age like other standard columns', async () => {
    const onChange = vi.fn();
    const harness = await createHarness({ onColumnVisibilityChange: onChange });
    const handle = harness.handle();

    expect(handle.isVisible('age')).toBe(true);

    await act(async () => {
      handle.toggle('age');
      await Promise.resolve();
    });

    expect(handle.isVisible('age')).toBe(false);
    expect(handle.getRenderedKeys()).not.toContain('age');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ age: false }));

    await harness.unmount();
  });
});
