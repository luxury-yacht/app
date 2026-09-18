/**
 * frontend/src/utils/resourceCalculations.ts
 *
 * Utility helpers for resourceCalculations.
 * Provides shared helper functions for the frontend.
 */

import {
  calculateResourceOvercommit,
  parseResourceValue,
} from '@shared/utils/resourceCalculations';

export const parseCpuToMillicores = (val: string | undefined): number =>
  parseResourceValue(val, 'cpu');

/**
 * Parse memory value to MB
 */
export const parseMemToMB = (val: string | undefined): number => parseResourceValue(val, 'memory');

/**
 * Calculate overcommitted percentage for CPU
 */
export const calculateCpuOvercommitted = (
  limits: string | undefined,
  allocatable: string | undefined
): number => {
  const limitsValue = parseCpuToMillicores(limits);
  const allocatableValue = parseCpuToMillicores(allocatable);
  return calculateResourceOvercommit(limitsValue, allocatableValue).overcommittedPercent;
};

/**
 * Calculate overcommitted percentage for Memory
 */
export const calculateMemoryOvercommitted = (
  limits: string | undefined,
  allocatable: string | undefined
): number => {
  const limitsValue = parseMemToMB(limits);
  const allocatableValue = parseMemToMB(allocatable);
  return calculateResourceOvercommit(limitsValue, allocatableValue).overcommittedPercent;
};
