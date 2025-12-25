/**
 * frontend/src/shared/utils/resourceCalculations.ts
 *
 * Utility helpers for resourceCalculations.
 * Provides shared helper functions for the frontend.
 */

// Shared resource calculation utilities used by ResourceBar and object panel

export interface ResourceData {
  usage?: string;
  request?: string;
  limit?: string;
  allocatable?: string;
}

export interface ResourceCalculations {
  usage: number;
  request: number;
  limit: number;
  allocatable: number;
  usagePercent: number;
  requestPercent: number;
  limitPercent: number;
  consumption: number | null;
  overcommittedAmount: number;
  overcommittedPercent: number;
  hasConfigIssue: boolean;
}

// Parse CPU values to millicores
const parseCpuValue = (value: string | undefined): number => {
  if (!value || value === '-' || value === 'undefined' || value === 'null' || value === 'not set')
    return 0;

  try {
    if (value.endsWith('m')) {
      const parsed = parseFloat(value.slice(0, -1));
      return isNaN(parsed) ? 0 : parsed;
    } else {
      const parsed = parseFloat(value) * 1000; // Convert cores to millicores
      return isNaN(parsed) ? 0 : parsed;
    }
  } catch {
    return 0;
  }
};

// Parse Memory values to MB (Mi)
const parseMemoryValue = (value: string | undefined): number => {
  if (!value || value === '-' || value === 'undefined' || value === 'null' || value === 'not set')
    return 0;

  try {
    const num = parseFloat(value);
    if (isNaN(num)) return 0;

    if (value.endsWith('Ki')) {
      return num / 1024; // Convert Ki to Mi
    } else if (value.endsWith('Mi')) {
      return num; // Already in Mi
    } else if (value.endsWith('Gi')) {
      return num * 1024; // Convert Gi to Mi
    } else if (value.endsWith('GB')) {
      return num * 1024; // Convert GB to Mi
    } else if (value.endsWith('MB')) {
      return num; // Already in Mi
    } else {
      // No unit suffix - assume bytes
      return num / (1024 * 1024); // Convert bytes to Mi
    }
  } catch {
    return 0;
  }
};

// Format CPU values for display
export const formatCpuValue = (millicores: number): string => {
  if (millicores === 0) return '0';
  if (millicores < 1000) {
    return `${millicores}m`;
  }
  // Convert to cores with 2 decimal places
  const cores = millicores / 1000.0;
  if (cores === Math.floor(cores)) {
    return `${cores}`;
  }
  return `${cores.toFixed(2)}`;
};

// Format memory values for display
export const formatMemoryValue = (mb: number): string => {
  if (mb === 0) return '0';
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)}Gi`;
  } else {
    return `${Math.round(mb)}Mi`;
  }
};

// Calculate all resource metrics
export const calculateResourceMetrics = (
  data: ResourceData,
  type: 'cpu' | 'memory'
): ResourceCalculations => {
  const parseValue = type === 'cpu' ? parseCpuValue : parseMemoryValue;

  const usage = parseValue(data.usage);
  const request = parseValue(data.request);
  const limit = parseValue(data.limit);
  const allocatable = parseValue(data.allocatable);

  // Determine scale based on context
  const scale = allocatable > 0 ? allocatable : limit > 0 ? limit : Math.max(usage, request * 1.2);

  // Calculate percentages
  const usagePercent = scale > 0 ? Math.min(100, Math.max(0, (usage / scale) * 100)) : 0;
  const requestPercent =
    scale > 0 && request > 0 ? Math.min(100, Math.max(0, (request / scale) * 100)) : 0;
  const limitPercent =
    scale > 0 && limit > 0 ? Math.min(100, Math.max(0, (limit / scale) * 100)) : 0;

  // Calculate consumption (usage vs request)
  const consumption = request > 0 ? Math.round((usage / request) * 100) : null;

  // Calculate overcommitted resources (limit vs allocatable)
  const overcommittedAmount = allocatable > 0 && limit > allocatable ? limit - allocatable : 0;
  const overcommittedPercent =
    allocatable > 0 && overcommittedAmount > 0
      ? Math.round((overcommittedAmount / allocatable) * 100)
      : 0;

  // Check for configuration issues
  const hasConfigIssue = request > 0 && limit > 0 && request > limit;

  return {
    usage,
    request,
    limit,
    allocatable,
    usagePercent,
    requestPercent,
    limitPercent,
    consumption,
    overcommittedAmount,
    overcommittedPercent,
    hasConfigIssue,
  };
};
