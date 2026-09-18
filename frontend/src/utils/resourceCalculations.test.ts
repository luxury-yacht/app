/**
 * frontend/src/utils/resourceCalculations.test.ts
 *
 * Test suite for resourceCalculations.
 * Covers key behaviors and edge cases for resourceCalculations.
 */

import { describe, expect, it } from 'vitest';

import { calculateCpuOvercommitted, calculateMemoryOvercommitted } from './resourceCalculations';

describe('resourceCalculations utilities', () => {
  it.each([undefined, 'invalid', '0', '-1'])(
    'does not report overcommit without positive capacity (%s)',
    (capacity) => {
      expect(calculateCpuOvercommitted('2', capacity)).toBe(0);
      expect(calculateMemoryOvercommitted('2Gi', capacity)).toBe(0);
    }
  );

  it('computes overcommit percentages when limits exceed allocatable', () => {
    expect(calculateCpuOvercommitted('2500m', '2000m')).toBe(25);
    expect(calculateCpuOvercommitted('1', '500m')).toBe(100);
    expect(calculateCpuOvercommitted('500m', '2000m')).toBe(0);

    expect(calculateMemoryOvercommitted('8Gi', '4Gi')).toBe(100);
    expect(calculateMemoryOvercommitted('256Mi', '512Mi')).toBe(0);
  });
});
