/**
 * frontend/src/shared/components/tables/hooks/useGridTableCsvFileExportAction.test.tsx
 *
 * Test suite for useGridTableCsvFileExportAction.
 * Covers the export action's file naming and CSV handoff.
 */

import type { IconBarAction } from '@shared/components/IconBar/IconBar';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGridTableCsvFileExportAction } from './useGridTableCsvFileExportAction';

const saveCsvFileMock = vi.hoisted(() => vi.fn());

vi.mock('@core/data-access', () => ({
  saveCsvFile: (...args: unknown[]) => saveCsvFileMock(...args),
}));

interface Row {
  name: string;
}

const columns = [
  { key: 'name', header: 'Name', render: (row: Row) => row.name },
] as unknown as GridColumnDefinition<Row>[];

describe('useGridTableCsvFileExportAction', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let item: IconBarAction | undefined;

  beforeEach(() => {
    saveCsvFileMock.mockReset();
    saveCsvFileMock.mockResolvedValue({ path: '/tmp/export.csv' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    item = undefined;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('saves with the wrapped, export-time-stamped file name', async () => {
    const Probe = () => {
      // The hook always returns an action item ({ type: 'action' }).
      item = useGridTableCsvFileExportAction<Row>({
        fetchAllRows: () => Promise.resolve([{ name: 'alpha' }]),
        columns,
        getTextContent: (node) => String(node ?? ''),
        defaultFilename: 'cluster-crds',
      }) as IconBarAction;
      return null;
    };

    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
    });

    await act(async () => {
      item?.onClick?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveCsvFileMock).toHaveBeenCalledTimes(1);
    const [filename, csv] = saveCsvFileMock.mock.calls[0] as [string, string];
    expect(filename).toMatch(/^luxury-yacht-cluster-crds-\d{14}\.csv$/);
    expect(csv).toBe('Name\nalpha');
  });
});
