/**
 * frontend/src/utils/resourceCalculations.test.ts
 *
 * Test suite for resourceCalculations.
 * Covers key behaviors and edge cases for resourceCalculations.
 */

import { describe, expect, it } from 'vitest';

import {
  calculateCpuOvercommitted,
  calculateMemoryOvercommitted,
  parseCpuToMillicores,
  parseMemToMB,
} from './resourceCalculations';
import { getPodStatusSeverity } from './podStatusSeverity';

describe('resourceCalculations utilities', () => {
  it('parses cpu strings into millicores', () => {
    expect(parseCpuToMillicores('250m')).toBe(250);
    expect(parseCpuToMillicores('2')).toBe(2000);
    expect(parseCpuToMillicores('-')).toBe(0);
    expect(parseCpuToMillicores(undefined)).toBe(0);
  });

  it('parses memory strings into megabytes', () => {
    expect(parseMemToMB('256Ki')).toBeCloseTo(0.25, 2);
    expect(parseMemToMB('128Mi')).toBe(128);
    expect(parseMemToMB('2Gi')).toBe(2048);
    expect(parseMemToMB('3GB')).toBe(3072);
    expect(parseMemToMB('1048576')).toBeCloseTo(1); // bytes fallback
  });

  it('computes overcommit percentages when limits exceed allocatable', () => {
    expect(calculateCpuOvercommitted('2500m', '2000m')).toBe(25);
    expect(calculateCpuOvercommitted('1', '500m')).toBe(100);
    expect(calculateCpuOvercommitted('500m', '2000m')).toBe(0);

    expect(calculateMemoryOvercommitted('8Gi', '4Gi')).toBe(100);
    expect(calculateMemoryOvercommitted('256Mi', '512Mi')).toBe(0);
  });
});

describe('podStatusSeverity', () => {
  it('returns severity tiers for known status strings', () => {
    expect(getPodStatusSeverity('Running')).toBe('info');
    expect(getPodStatusSeverity('Failed')).toBe('error');
    expect(getPodStatusSeverity('CrashLoopBackOff')).toBe('error');
    expect(getPodStatusSeverity('Pending')).toBe('warning');
    expect(getPodStatusSeverity('Init:0/2')).toBe('warning');
    expect(getPodStatusSeverity('Init:ErrImagePull')).toBe('error');
    expect(getPodStatusSeverity('')).toBe('info');
  });
});
