import { describe, expect, it } from 'vitest';
import { buildExportFilename } from './exportFilename';

describe('buildExportFilename', () => {
  it('wraps the base name with the app prefix, a local timestamp and the extension', () => {
    const exportedAt = new Date(2026, 5, 10, 14, 22, 33); // 2026-06-10 14:22:33 local
    expect(buildExportFilename('cluster-crds', exportedAt, 'csv')).toBe(
      'luxury-yacht-cluster-crds-20260610142233.csv'
    );
    expect(buildExportFilename('pod-api-logs', exportedAt, 'log')).toBe(
      'luxury-yacht-pod-api-logs-20260610142233.log'
    );
  });

  it('zero-pads every timestamp component', () => {
    const exportedAt = new Date(2026, 0, 2, 3, 4, 5); // 2026-01-02 03:04:05 local
    expect(buildExportFilename('browse', exportedAt, 'csv')).toBe(
      'luxury-yacht-browse-20260102030405.csv'
    );
  });
});
