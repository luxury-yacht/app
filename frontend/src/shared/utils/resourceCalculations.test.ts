import { describe, expect, it } from 'vitest';

import { calculateResourceMetrics, formatMemoryValue } from './resourceCalculations';

describe('shared resource calculations', () => {
  it('parses and formats tebibyte memory values', () => {
    const metrics = calculateResourceMetrics(
      {
        usage: '512.0 Gi',
        request: '1.0 Ti',
        limit: '1.5 Ti',
        allocatable: '2.0 Ti',
      },
      'memory'
    );

    expect(metrics.usage).toBe(512 * 1024);
    expect(metrics.request).toBe(1024 * 1024);
    expect(metrics.limit).toBe(1.5 * 1024 * 1024);
    expect(metrics.allocatable).toBe(2 * 1024 * 1024);
    expect(metrics.usagePercent).toBe(25);
    expect(metrics.requestPercent).toBe(50);
    expect(metrics.limitPercent).toBe(75);
    expect(formatMemoryValue(metrics.limit)).toBe('1.5Ti');
  });

  it('reports percentages over 100 percent for overcommitted resources', () => {
    const metrics = calculateResourceMetrics(
      {
        usage: '2.5 Ti',
        request: '3.0 Ti',
        limit: '5.0 Ti',
        allocatable: '2.0 Ti',
      },
      'memory'
    );

    expect(metrics.usagePercent).toBe(125);
    expect(metrics.requestPercent).toBe(150);
    expect(metrics.limitPercent).toBe(250);
  });
});
