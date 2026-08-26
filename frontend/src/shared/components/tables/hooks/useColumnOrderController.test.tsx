import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import {
  reconcileColumnOrder,
  useColumnOrderController,
} from '@shared/components/tables/hooks/useColumnOrderController';
import React, { act, useImperativeHandle } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string };

const columns: GridColumnDefinition<Row>[] = [
  { key: 'kind', header: 'Kind', render: (row) => row.id },
  { key: 'name', header: 'Name', hideable: false, render: (row) => row.id },
  { key: 'age', header: 'Age', render: (row) => row.id },
];

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('reconcileColumnOrder', () => {
  it('keeps known saved keys, drops removed keys, and appends new keys in declaration order', () => {
    expect(reconcileColumnOrder(columns, ['age', 'removed', 'kind'])).toEqual([
      'age',
      'kind',
      'name',
    ]);
  });

  it('rejects duplicate column keys', () => {
    expect(() => reconcileColumnOrder([...columns, columns[0]], null)).toThrow(
      'GridTable column keys must be unique: "kind"'
    );
  });
});

describe('useColumnOrderController', () => {
  it('moves required-visible columns without changing their visibility capability', async () => {
    type Handle = { move: (key: string, offset: -1 | 1) => void; keys: () => string[] };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    const ref = React.createRef<Handle>();
    const onChange = vi.fn();

    const Harness = ({ ref: handleRef }: { ref?: React.Ref<Handle> }) => {
      const controller = useColumnOrderController({ columns, onColumnOrderChange: onChange });
      useImperativeHandle(handleRef, () => ({
        move: controller.moveColumn,
        keys: () => controller.orderedColumns.map((column) => column.key),
      }));
      return null;
    };

    await act(async () => root.render(<Harness ref={ref} />));
    await act(async () => ref.current?.move('name', -1));

    expect(ref.current?.keys()).toEqual(['name', 'kind', 'age']);
    expect(onChange).toHaveBeenCalledWith(['name', 'kind', 'age']);
    expect(columns[1].hideable).toBe(false);

    await act(async () => root.unmount());
    container.remove();
  });

  it('moves a dragged column directly to the requested list index', async () => {
    type Handle = {
      reorder: (key: string, targetIndex: number) => void;
      reset: () => void;
      canReset: () => boolean;
      keys: () => string[];
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    const ref = React.createRef<Handle>();
    const onChange = vi.fn();

    const Harness = ({ ref: handleRef }: { ref?: React.Ref<Handle> }) => {
      const controller = useColumnOrderController({ columns, onColumnOrderChange: onChange });
      useImperativeHandle(handleRef, () => ({
        reorder: controller.reorderColumn,
        reset: controller.resetColumnOrder,
        canReset: () => controller.canResetColumnOrder,
        keys: () => controller.orderedColumns.map((column) => column.key),
      }));
      return null;
    };

    await act(async () => root.render(<Harness ref={ref} />));
    await act(async () => ref.current?.reorder('kind', 2));

    expect(ref.current?.keys()).toEqual(['name', 'age', 'kind']);
    expect(ref.current?.canReset()).toBe(true);
    expect(onChange).toHaveBeenCalledWith(['name', 'age', 'kind']);

    await act(async () => ref.current?.reset());
    expect(ref.current?.keys()).toEqual(['kind', 'name', 'age']);
    expect(ref.current?.canReset()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(['kind', 'name', 'age']);

    await act(async () => root.unmount());
    container.remove();
  });

  it('maps a visible-header insertion around hidden columns into the durable full order', async () => {
    type Handle = {
      reorderVisible: (key: string, visibleKeys: string[], insertIndex: number) => void;
      keys: () => string[];
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    const ref = React.createRef<Handle>();
    const onChange = vi.fn();

    const Harness = ({ ref: handleRef }: { ref?: React.Ref<Handle> }) => {
      const controller = useColumnOrderController({ columns, onColumnOrderChange: onChange });
      useImperativeHandle(handleRef, () => ({
        reorderVisible: controller.reorderVisibleColumn,
        keys: () => controller.orderedColumns.map((column) => column.key),
      }));
      return null;
    };

    await act(async () => root.render(<Harness ref={ref} />));
    // Name is hidden from this rendered header. Dropping Kind after Age must
    // still preserve Name in the durable order and place Kind directly after Age.
    await act(async () => ref.current?.reorderVisible('kind', ['kind', 'age'], 2));

    expect(ref.current?.keys()).toEqual(['name', 'age', 'kind']);
    expect(onChange).toHaveBeenCalledWith(['name', 'age', 'kind']);

    await act(async () => ref.current?.reorderVisible('kind', ['age', 'kind'], 0));
    expect(ref.current?.keys()).toEqual(['name', 'kind', 'age']);
    expect(onChange).toHaveBeenLastCalledWith(['name', 'kind', 'age']);

    await act(async () => root.unmount());
    container.remove();
  });

  it('does not publish a full-order change for a visually unchanged header drop', async () => {
    type Handle = {
      reorderVisible: (key: string, visibleKeys: string[], insertIndex: number) => void;
      keys: () => string[];
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    const ref = React.createRef<Handle>();
    const onChange = vi.fn();

    const Harness = ({ ref: handleRef }: { ref?: React.Ref<Handle> }) => {
      const controller = useColumnOrderController({
        columns,
        columnOrder: ['kind', 'name', 'age'],
        onColumnOrderChange: onChange,
      });
      useImperativeHandle(handleRef, () => ({
        reorderVisible: controller.reorderVisibleColumn,
        keys: () => controller.orderedColumns.map((column) => column.key),
      }));
      return null;
    };

    await act(async () => root.render(<Harness ref={ref} />));
    await act(async () => ref.current?.reorderVisible('kind', ['kind', 'age'], 1));

    expect(ref.current?.keys()).toEqual(['kind', 'name', 'age']);
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });
});
