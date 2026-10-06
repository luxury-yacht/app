/**
 * frontend/src/shared/utils/exportFilename.ts
 *
 * The file name offered in a save dialog for exported table rows or logs, and how
 * a Download choice ended.
 */

import dayjs from 'dayjs';

/** How a Download choice ended. A dismissed save dialog is neither success nor failure. */
export type DownloadOutcome = 'done' | 'failed' | 'canceled';

/**
 * `luxury-yacht-<base>-<YYYYMMDDHHmmss>.<extension>`, where `base` names what is
 * exported (e.g. a view id) and the timestamp is the local export time.
 */
export const buildExportFilename = (
  base: string,
  exportedAt: Date,
  extension: 'csv' | 'log'
): string => `luxury-yacht-${base}-${dayjs(exportedAt).format('YYYYMMDDHHmmss')}.${extension}`;
