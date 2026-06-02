import { describe, expect, it } from 'vitest';
import { buildLocalPartialDataLabel } from './tablePartialState';

describe('buildLocalPartialDataLabel', () => {
  it('uses backend warnings when a snapshot producer reports truncation', () => {
    const label = buildLocalPartialDataLabel({
      stats: {
        itemCount: 50,
        totalItems: 500,
        truncated: true,
        buildDurationMs: 12,
        warnings: ['Showing most recent 50 of 500 rows.'],
      },
      fallback: 'Fallback window copy.',
      sourceLabel: 'Namespace Config',
    });

    expect(label).toContain('Showing most recent 50 of 500 rows.');
    expect(label).toContain('Namespace Config is a bounded local window');
    expect(label).toContain('apply only to the visible rows');
  });

  it('falls back to totals or caller copy when warnings are absent', () => {
    expect(
      buildLocalPartialDataLabel({
        stats: {
          itemCount: 25,
          totalItems: 100,
          truncated: true,
          buildDurationMs: 7,
        },
        fallback: 'Fallback window copy.',
      })
    ).toContain('Showing 25 of 100 rows.');

    expect(
      buildLocalPartialDataLabel({
        stats: null,
        fallback: 'Fallback window copy.',
      })
    ).toContain('Fallback window copy.');
  });
});
