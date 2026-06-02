import { describe, expect, it, vi } from 'vitest';

import { runCatalogQueryBulkDeletePages } from './useCatalogQueryBulkDeleteAction';

describe('runCatalogQueryBulkDeletePages', () => {
  it('accumulates paged bulk delete results until the cursor is exhausted', async () => {
    const runPage = vi
      .fn()
      .mockResolvedValueOnce({ processed: 100, succeeded: 99, failed: 1, continue: 'page-2' })
      .mockResolvedValueOnce({ processed: 25, succeeded: 25, failed: 0 });

    await expect(runCatalogQueryBulkDeletePages(runPage)).resolves.toMatchObject({
      processed: 125,
      succeeded: 124,
      failed: 1,
    });
    expect(runPage).toHaveBeenNthCalledWith(1, undefined);
    expect(runPage).toHaveBeenNthCalledWith(2, 'page-2');
  });

  it('throws when a page returns a cursor without processing anything', async () => {
    const runPage = vi
      .fn()
      .mockResolvedValueOnce({ processed: 0, succeeded: 0, failed: 0, continue: 'stalled' });

    await expect(runCatalogQueryBulkDeletePages(runPage)).rejects.toThrow(
      'Catalog bulk delete did not advance'
    );
  });

  it('throws when the backend repeats the same cursor', async () => {
    const runPage = vi
      .fn()
      .mockResolvedValueOnce({ processed: 10, succeeded: 10, failed: 0, continue: 'page-2' })
      .mockResolvedValueOnce({ processed: 1, succeeded: 1, failed: 0, continue: 'page-2' });

    await expect(runCatalogQueryBulkDeletePages(runPage)).rejects.toThrow(
      'Catalog bulk delete did not advance'
    );
  });
});
