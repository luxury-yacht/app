import type { IconBarMenu } from '@shared/components/IconBar/IconBar';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { Clipboard } from '@wailsio/runtime';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import { useGridTableDownloadAction } from './useGridTableDownloadAction';

const mocks = vi.hoisted(() => ({ save: vi.fn(), report: vi.fn() }));
vi.mock('@core/data-access', () => ({ saveCsvFile: mocks.save }));
vi.mock('@/utils/errorHandler', () => ({ reportOperationalError: mocks.report }));

type Row = { name: string };
type Destination = 'Copy to Clipboard' | 'Save to File';
const columns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', render: (row) => row.name },
];

describe('table Download button', () => {
  let root: Root;
  let container: HTMLDivElement;
  let item: IconBarMenu;
  let fetchRows: ReturnType<typeof vi.fn<() => Promise<Row[]>>>;
  const writeText = vi.mocked(Clipboard.SetText);

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.save.mockReset().mockResolvedValue({ path: '/tmp/table.csv' });
    mocks.report.mockReset();
    fetchRows = vi.fn().mockResolvedValue([{ name: 'all-matches' }]);
    writeText.mockReset().mockResolvedValue(undefined);
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  const renderAction = async ({ exportColumns = columns, canFetchAllPages = true } = {}) => {
    const Probe = () => {
      item = useGridTableDownloadAction({
        data: [{ name: 'current-page' }],
        columns: exportColumns,
        getTextContent: String,
        fetchAllRows: canFetchAllPages ? fetchRows : undefined,
        allMatchingRows: true,
        defaultFilename: 'cluster-crds',
      }) as IconBarMenu;
      return null;
    };
    await act(async () => root.render(<Probe />));
  };

  const choose = (destination: Destination) =>
    requireValue(
      item.menuItems.find(({ label }) => label === destination)?.onClick,
      `${destination} choice`
    )();

  const written = (destination: Destination) =>
    destination === 'Copy to Clipboard'
      ? writeText.mock.calls[0]?.[0]
      : mocks.save.mock.calls[0]?.[1];

  it('offers both destinations from one menu button', async () => {
    await renderAction();
    expect(item.type).toBe('menu');
    expect(item.menuItems.map(({ label }) => label)).toEqual(['Copy to Clipboard', 'Save to File']);
  });

  it.each<Destination>(['Copy to Clipboard', 'Save to File'])(
    '%s stays busy through row acquisition and resets success feedback after completion',
    async (destination) => {
      let finish: ((rows: Row[]) => void) | undefined;
      fetchRows.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      await renderAction();
      await act(async () => choose(destination));
      expect(item.disabled).toBe(true);
      expect(writeText).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
      await act(async () => requireValue(finish, 'pending query')([{ name: 'all-matches' }]));
      expect(item.disabled).toBe(false);
      expect(item.feedback).toBe('success');
      expect(written(destination)).toBe('Name\nall-matches');
      act(() => vi.advanceTimersByTime(750));
      expect(item.feedback).toBeNull();
    }
  );

  it.each<Destination>(['Copy to Clipboard', 'Save to File'])(
    '%s rejects failed row acquisition without writing and cancels feedback cleanup on unmount',
    async (destination) => {
      const failure = new Error('query failed');
      fetchRows.mockRejectedValue(failure);
      await renderAction();
      await act(async () => choose(destination));
      expect(item.disabled).toBe(false);
      expect(item.feedback).toBe('error');
      expect(writeText).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.report).toHaveBeenCalledWith(failure, {
        source: 'GridTable',
        action: destination === 'Copy to Clipboard' ? 'copyCsv' : 'exportCsvFile',
      });
      expect(vi.getTimerCount()).toBe(1);
      act(() => root.render(null));
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('writes column headers when the all-matching query settles empty', async () => {
    fetchRows.mockResolvedValue([]);
    await renderAction();
    await act(async () => choose('Copy to Clipboard'));
    expect(writeText).toHaveBeenCalledWith('Name');
    await act(async () => choose('Save to File'));
    expect(mocks.save).toHaveBeenCalledWith(expect.any(String), 'Name');
    expect(item.feedback).toBe('success');
  });

  it('rejects missing columns before acquiring rows', async () => {
    await renderAction({ exportColumns: [] });
    await act(async () => choose('Save to File'));
    expect(fetchRows).not.toHaveBeenCalled();
    expect(item.feedback).toBe('error');
  });

  // Dismissing the save dialog is not a failure: no feedback, nothing reported.
  it('treats a dismissed save dialog as nothing happened', async () => {
    mocks.save.mockResolvedValue({ path: '', bytes: 0, canceled: true });
    await renderAction();
    await act(async () => choose('Save to File'));
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(item.feedback).toBeNull();
    expect(item.disabled).toBe(false);
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it('saves with an export-time-stamped file name', async () => {
    await renderAction();
    await act(async () => choose('Save to File'));
    expect(mocks.save.mock.calls[0]?.[0]).toMatch(/^luxury-yacht-cluster-crds-\d{14}\.csv$/);
  });

  // A table that cannot fetch every page saves the rows it holds, as Copy does.
  it('saves the local rows when the table cannot fetch every page', async () => {
    await renderAction({ canFetchAllPages: false });
    await act(async () => choose('Save to File'));
    expect(mocks.save).toHaveBeenCalledWith(expect.any(String), 'Name\ncurrent-page');
    await act(async () => choose('Copy to Clipboard'));
    expect(writeText).toHaveBeenCalledWith('Name\ncurrent-page');
  });
});
