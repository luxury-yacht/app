import type { IconBarAction } from '@shared/components/IconBar/IconBar';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import { useGridTableCsvExport } from './useGridTableCsvExport';
import { useGridTableCsvFileExportAction } from './useGridTableCsvFileExportAction';

const mocks = vi.hoisted(() => ({ save: vi.fn(), report: vi.fn() }));
vi.mock('@core/data-access', () => ({ saveCsvFile: mocks.save }));
vi.mock('@/utils/errorHandler', () => ({ reportOperationalError: mocks.report }));

type Row = { name: string };
type Destination = 'clipboard' | 'file';
const columns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', render: (row) => row.name },
];

describe('table export operation lifetime', () => {
  let root: Root;
  let container: HTMLDivElement;
  let actions: Record<Destination, IconBarAction>;
  let fetchRows: ReturnType<typeof vi.fn<() => Promise<Row[]>>>;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.save.mockReset().mockResolvedValue({ path: '/tmp/table.csv' });
    mocks.report.mockReset();
    fetchRows = vi.fn().mockResolvedValue([{ name: 'all-matches' }]);
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  const renderActions = async (exportColumns = columns) => {
    const Probe = () => {
      actions = {
        clipboard: useGridTableCsvExport({
          data: [{ name: 'current-page' }],
          columns: exportColumns,
          getTextContent: String,
          fetchAllRows: fetchRows,
        }) as IconBarAction,
        file: useGridTableCsvFileExportAction({
          columns: exportColumns,
          getTextContent: String,
          fetchAllRows: fetchRows,
          defaultFilename: 'test',
        }) as IconBarAction,
      };
      return null;
    };
    await act(async () => root.render(<Probe />));
  };

  const invoke = (destination: Destination) =>
    requireValue(actions[destination].onClick, 'export action')();

  it.each<Destination>(['clipboard', 'file'])(
    '%s stays busy through row acquisition and resets success feedback after completion',
    async (destination) => {
      let finish: ((rows: Row[]) => void) | undefined;
      fetchRows.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      await renderActions();
      await act(async () => invoke(destination));
      expect(actions[destination].disabled).toBe(true);
      expect(writeText).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
      await act(async () => requireValue(finish, 'pending query')([{ name: 'all-matches' }]));
      expect(actions[destination].disabled).toBe(false);
      expect(actions[destination].feedback).toBe('success');
      if (destination === 'clipboard') {
        expect(writeText).toHaveBeenCalledWith('Name\nall-matches');
      } else {
        expect(mocks.save).toHaveBeenCalledWith(expect.any(String), 'Name\nall-matches');
      }
      act(() => vi.advanceTimersByTime(750));
      expect(actions[destination].feedback).toBeNull();
    }
  );

  it.each<Destination>(['clipboard', 'file'])(
    '%s rejects failed row acquisition without writing and cancels feedback cleanup on unmount',
    async (destination) => {
      const failure = new Error('query failed');
      fetchRows.mockRejectedValue(failure);
      await renderActions();
      await act(async () => invoke(destination));
      expect(actions[destination].disabled).toBe(false);
      expect(actions[destination].feedback).toBe('error');
      expect(writeText).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.report).toHaveBeenCalledWith(failure, {
        source: 'GridTable',
        action: destination === 'clipboard' ? 'copyCsv' : 'exportCsvFile',
      });
      expect(vi.getTimerCount()).toBe(1);
      act(() => root.render(null));
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('exports column headers when the all-matching query settles empty', async () => {
    fetchRows.mockResolvedValue([]);
    await renderActions();
    await act(async () => invoke('clipboard'));
    expect(writeText).toHaveBeenCalledWith('Name');
    expect(actions.clipboard.feedback).toBe('success');
    await act(async () => invoke('file'));
    expect(mocks.save).toHaveBeenCalledWith(expect.any(String), 'Name');
    expect(actions.file.feedback).toBe('success');
  });

  it('rejects missing columns before acquiring rows for either destination', async () => {
    await renderActions([]);
    await act(async () => {
      invoke('clipboard');
      invoke('file');
    });
    expect(fetchRows).not.toHaveBeenCalled();
    expect(actions.clipboard.feedback).toBe('error');
    expect(actions.file.feedback).toBe('error');
  });
});
