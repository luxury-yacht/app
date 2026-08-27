import { describe, expect, it } from 'vitest';

import {
  calculateResourceMetrics,
  formatMemoryValue,
  formatResourceValue,
  parseResourceValue,
} from './resourceCalculations';

describe('shared resource calculations', () => {
  it('covers shared resource calculations scenarios', async () => {
    {
      // Scenario: parses and formats tebibyte memory values
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
    }

    {
      // Scenario: reports percentages over 100 percent for overcommitted resources
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
    }

    for (const [type, value, expected] of [
      ['cpu', '250m', 250],
      ['cpu', '0.25', 250],
      ['memory', '1024Ki', 1],
      ['memory', '128Mi', 128],
      ['memory', '2Gi', 2048],
      ['memory', '1.5Ti', 1.5 * 1024 * 1024],
      ['memory', '3GB', 3072],
      ['memory', '512MB', 512],
      ['memory', '1048576', 1],
    ] as const) {
      // Scenarios: parses %s resource value %s
      expect(parseResourceValue(value, type)).toBe(expected);
    }

    for (const value of ['', '-', 'undefined', 'null', 'not set', 'invalid']) {
      // Scenarios: normalizes an invalid resource value %j to zero
      expect(parseResourceValue(value, 'cpu')).toBe(0);
      expect(parseResourceValue(value, 'memory')).toBe(0);
    }
    // Scenario: formats parsed values consistently for UI and table exports
    expect(formatResourceValue('0.25', 250, 'cpu')).toBe('250m');
    expect(formatResourceValue('1.5Ti', 1.5 * 1024 * 1024, 'memory')).toBe('1.5Ti');
    expect(formatResourceValue('invalid', 0, 'memory')).toBe('-');
    expect(formatResourceValue('-', 0, 'cpu')).toBe('-');
    expect(formatResourceValue('not set', 0, 'cpu')).toBe('-');

    for (const value of ['0', '0Ki', '0Mi']) {
      // Scenarios: preserves an explicit zero memory value %s
      const parsedValue = parseResourceValue(value, 'memory');

      expect(parsedValue).toBe(0);
      expect(formatResourceValue(value, parsedValue, 'memory')).toBe('0');
    }
  });
});
