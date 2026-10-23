/**
 * frontend/src/shared/components/tables/hooks/useGridTableDownloadAction.test.tsx
 *
 * The table toolbar's Download button: both choices stay busy while the rows
 * are fetched and then write every matching row (or the rows the table holds
 * when it cannot fetch every page) to the clipboard or to a time-stamped CSV
 * file; a failed fetch writes nothing and is reported; a dismissed save dialog
 * is not a failure. Runs inside the production shell with only the backend
 * boundary faked (test-utils/appState): files save through the SaveCsvFile RPC
 * and copies go to the Wails clipboard.
 */

import type { IconBarMenu } from '@shared/components/IconBar/IconBar';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { Clipboard } from '@wailsio/runtime';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { useGridTableDownloadAction } from './useGridTableDownloadAction';

type Row = { name: string };
type Destination = 'Copy to Clipboard' | 'Save to File';
const columns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', render: (row) => row.name },
];

const app = installAppStateHarness();
const writeText = vi.mocked(Clipboard.SetText);

describe('table Download button', () => {
  let view: MountedApp;
  let item: IconBarMenu;
  let fetchRows: ReturnType<typeof vi.fn<() => Promise<Row[]>>>;
  let saveResult: { path: string; bytes: number; canceled?: boolean };

  beforeEach(async () => {
    fetchRows = vi.fn().mockResolvedValue([{ name: 'all-matches' }]);
    writeText.mockReset().mockResolvedValue(undefined);
    saveResult = { path: '/tmp/table.csv', bytes: 1 };
    app.backend.answer('SaveCsvFile', () => saveResult);
    view = await app.render(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
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
    await view.show(<Probe />);
  };

  const choose = (destination: Destination) =>
    requireValue(
      item.menuItems.find(({ label }) => label === destination)?.onClick,
      `${destination} choice`
    )();

  const savedFiles = () => app.backend.calls('SaveCsvFile');

  const written = (destination: Destination) =>
    destination === 'Copy to Clipboard' ? writeText.mock.calls[0]?.[0] : savedFiles()[0]?.[1];

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
      expect(savedFiles()).toEqual([]);
      await act(async () => requireValue(finish, 'pending query')([{ name: 'all-matches' }]));
      expect(item.disabled).toBe(false);
      expect(item.feedback).toBe('success');
      expect(written(destination)).toBe('Name\nall-matches');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(750);
      });
      expect(item.feedback).toBeNull();
    }
  );

  it.each<Destination>(['Copy to Clipboard', 'Save to File'])(
    '%s writes nothing and reports a failed row acquisition',
    async (destination) => {
      const failure = new Error(`query failed: ${destination}`);
      fetchRows.mockRejectedValue(failure);
      await renderAction();
      await act(async () => choose(destination));
      expect(item.disabled).toBe(false);
      expect(item.feedback).toBe('error');
      expect(writeText).not.toHaveBeenCalled();
      expect(savedFiles()).toEqual([]);
      expect(app.errors.take((record) => record.error === failure)).toEqual([
        {
          kinds: ['operational'],
          error: failure,
          context: {
            source: 'GridTable',
            action: destination === 'Copy to Clipboard' ? 'copyCsv' : 'exportCsvFile',
          },
        },
      ]);
    }
  );

  it('writes column headers when the all-matching query settles empty', async () => {
    fetchRows.mockResolvedValue([]);
    await renderAction();
    await act(async () => choose('Copy to Clipboard'));
    expect(writeText).toHaveBeenCalledWith('Name');
    await act(async () => choose('Save to File'));
    expect(savedFiles()).toEqual([[expect.any(String), 'Name']]);
    expect(item.feedback).toBe('success');
  });

  it('rejects missing columns before acquiring rows', async () => {
    await renderAction({ exportColumns: [] });
    await act(async () => choose('Save to File'));
    expect(fetchRows).not.toHaveBeenCalled();
    expect(savedFiles()).toEqual([]);
    expect(item.feedback).toBe('error');
  });

  // Dismissing the save dialog is not a failure: no feedback, nothing reported
  // (the harness fails the test on any unexpected report).
  it('treats a dismissed save dialog as nothing happened', async () => {
    saveResult = { path: '', bytes: 0, canceled: true };
    await renderAction();
    await act(async () => choose('Save to File'));
    expect(savedFiles()).toHaveLength(1);
    expect(item.feedback).toBeNull();
    expect(item.disabled).toBe(false);
  });

  it('saves with an export-time-stamped file name', async () => {
    await renderAction();
    await act(async () => choose('Save to File'));
    expect(savedFiles()[0]?.[0]).toMatch(/^luxury-yacht-cluster-crds-\d{14}\.csv$/);
  });

  // A table that cannot fetch every page saves the rows it holds, as Copy does.
  it('saves the local rows when the table cannot fetch every page', async () => {
    await renderAction({ canFetchAllPages: false });
    await act(async () => choose('Save to File'));
    expect(savedFiles()).toEqual([[expect.any(String), 'Name\ncurrent-page']]);
    await act(async () => choose('Copy to Clipboard'));
    expect(writeText).toHaveBeenCalledWith('Name\ncurrent-page');
  });
});
