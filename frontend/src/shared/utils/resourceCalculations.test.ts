import { describe, expect, it } from 'vitest';

import {
  calculateResourceMetrics,
  formatMemoryValue,
  formatResourceValue,
  getResourceLimitUsagePercent,
  parseResourceValue,
} from './resourceCalculations';

describe('shared resource calculations', () => {
  it.each([
    ['memory', '512Gi', '1000G', 54.9755813888],
    ['memory', '1024Ti', '2Pi', 50],
    ['memory', '1024Pi', '2Ei', 50],
    ['cpu', '500', '1k', 50],
    ['cpu', '250000u', '500m', 50],
    ['cpu', '250000000n', '500m', 50],
    ['memory', '1e6', '2M', 50],
    ['memory', '1T', '2e12', 50],
    ['memory', '1P', '2E', 0.05],
    ['memory', '1000m', '2', 50],
  ] as const)('calculates %s usage %s against limit %s', (type, usage, limit, expected) => {
    expect(getResourceLimitUsagePercent(usage, limit, type)).toBeCloseTo(expected, 8);
  });

  it('distinguishes zero usage from missing, invalid, or nonpositive capacity', () => {
    expect(getResourceLimitUsagePercent('0', '1Gi', 'memory')).toBe(0);
    for (const usage of [
      undefined,
      '',
      '-',
      '.',
      '+.',
      '1..2',
      '1.2.3Gi',
      'invalid',
      '1garbage',
      '-1',
      '1e999',
    ]) {
      expect(getResourceLimitUsagePercent(usage, '1Gi', 'memory')).toBeUndefined();
    }
    for (const limit of [undefined, '', '-', 'invalid', '1garbage', '0', '-1', '1e999']) {
      expect(getResourceLimitUsagePercent('1', limit, 'memory')).toBeUndefined();
    }
  });

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

  it.each([
    ['cpu', '250m', 250],
    ['cpu', '0.25', 250],
    ['cpu', '.25', 250],
    ['cpu', '+1.', 1000],
    ['cpu', '-0.25', -250],
    ['cpu', '5e-1', 500],
    ['cpu', '+2E+3', 2_000_000],
    ['memory', '1024Ki', 1],
    ['memory', '128Mi', 128],
    ['memory', '2Gi', 2048],
    ['memory', '1.5Ti', 1.5 * 1024 * 1024],
    ['memory', '3GB', 3072],
    ['memory', '512MB', 512],
    ['memory', '1048576', 1],
  ] as const)('parses %s resource value %s', (type, value, expected) => {
    expect(parseResourceValue(value, type)).toBe(expected);
  });

  it.each(['', '-', 'undefined', 'null', 'not set', 'invalid'])(
    'normalizes an invalid resource value %j to zero',
    (value) => {
      expect(parseResourceValue(value, 'cpu')).toBe(0);
      expect(parseResourceValue(value, 'memory')).toBe(0);
    }
  );

  it('formats parsed values consistently for UI and table exports', () => {
    expect(formatResourceValue('0.25', 250, 'cpu')).toBe('250m');
    expect(formatResourceValue('1.5Ti', 1.5 * 1024 * 1024, 'memory')).toBe('1.5Ti');
    expect(formatResourceValue('invalid', 0, 'memory')).toBe('-');
    expect(formatResourceValue('-', 0, 'cpu')).toBe('-');
    expect(formatResourceValue('not set', 0, 'cpu')).toBe('-');
  });

  it.each(['0', '0Ki', '0Mi'])('preserves an explicit zero memory value %s', (value) => {
    const parsedValue = parseResourceValue(value, 'memory');

    expect(parsedValue).toBe(0);
    expect(formatResourceValue(value, parsedValue, 'memory')).toBe('0');
  });
});
