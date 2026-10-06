import { describe, expect, it } from 'vitest';

import {
  calculateResourceMetrics,
  calculateResourceOvercommit,
  formatMemoryValue,
  formatResourceExportValue,
  formatResourceValue,
  parseResourceQuantity,
} from './resourceCalculations';

const KIB = 1024;
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const TIB = 1024 ** 4;

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
  ] as const)('parses %s quantities %s and %s in the same units', (type, first, second, ratio) => {
    const parsedFirst = parseResourceQuantity(first, type);
    const parsedSecond = parseResourceQuantity(second, type);
    expect(parsedFirst).toBeDefined();
    expect(parsedSecond).toBeDefined();
    expect(((parsedFirst ?? 0) / (parsedSecond ?? 1)) * 100).toBeCloseTo(ratio, 8);
  });

  it('distinguishes zero from missing or invalid quantities', () => {
    expect(parseResourceQuantity('0', 'memory')).toBe(0);
    for (const value of [
      undefined,
      '',
      '-',
      '.',
      '+.',
      '1..2',
      '1.2.3Gi',
      'invalid',
      '1garbage',
      '1e999',
    ]) {
      expect(parseResourceQuantity(value, 'memory')).toBeUndefined();
    }
  });

  it('scales tebibyte memory values and formats them in binary units', () => {
    const metrics = calculateResourceMetrics({
      usage: 512 * GIB,
      request: TIB,
      limit: 1.5 * TIB,
      allocatable: 2 * TIB,
    });

    expect(metrics.usagePercent).toBe(25);
    expect(metrics.requestPercent).toBe(50);
    expect(metrics.limitPercent).toBe(75);
    expect(formatMemoryValue(metrics.limit)).toBe('1.5Ti');
  });

  it('reports percentages over 100 percent for overcommitted resources', () => {
    const metrics = calculateResourceMetrics({
      usage: 2.5 * TIB,
      request: 3 * TIB,
      limit: 5 * TIB,
      allocatable: 2 * TIB,
    });

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
    ['memory', '1Ki', KIB],
    ['memory', '128Mi', 128 * MIB],
    ['memory', '2Gi', 2 * GIB],
    ['memory', '1.5Ti', 1.5 * TIB],
    ['memory', '3GB', 3 * GIB],
    ['memory', '512 MB', 512 * MIB],
    ['memory', '1048576', MIB],
  ] as const)('parses %s quantity %s into millicores or bytes', (type, value, expected) => {
    expect(parseResourceQuantity(value, type)).toBe(expected);
  });

  it.each([undefined, '', '-', 'undefined', 'null', 'not set', 'invalid'])(
    'treats %j as no value rather than zero',
    (value) => {
      expect(parseResourceQuantity(value, 'cpu')).toBeUndefined();
      expect(parseResourceQuantity(value, 'memory')).toBeUndefined();
    }
  );

  it('formats CPU in millicores and memory in binary units, with a dash for no value', () => {
    expect(formatResourceValue(250, 'cpu')).toBe('250m');
    expect(formatResourceValue(1.5 * TIB, 'memory')).toBe('1.5Ti');
    expect(formatResourceValue(0, 'memory')).toBe('0');
    expect(formatResourceValue(undefined, 'cpu')).toBe('-');
  });

  it('exports usage as whole millicores and KiB, keeping zero distinct from no value', () => {
    expect(formatResourceExportValue(1234.4, 'cpu')).toBe('1234');
    expect(formatResourceExportValue(1560 * MIB + 123, 'memory')).toBe('1597440');
    expect(formatResourceExportValue(0, 'memory')).toBe('0');
    expect(formatResourceExportValue(undefined, 'memory')).toBe('-');
  });

  it('reports overcommit only when limits exceed positive allocatable capacity', () => {
    expect(calculateResourceOvercommit(2500, 2000).overcommittedPercent).toBe(25);
    expect(calculateResourceOvercommit(8 * GIB, 4 * GIB).overcommittedPercent).toBe(100);
    expect(calculateResourceOvercommit(500, 2000).overcommittedPercent).toBe(0);
    expect(calculateResourceOvercommit(2000, 0).overcommittedPercent).toBe(0);
  });
});
