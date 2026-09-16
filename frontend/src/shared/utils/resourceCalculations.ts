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

export type ResourceType = 'cpu' | 'memory';

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

const EMPTY_RESOURCE_VALUES = new Set(['-', 'undefined', 'null', 'not set']);

const isEmptyResourceValue = (value: string): boolean => !value || EMPTY_RESOURCE_VALUES.has(value);

// Kubernetes quantities use decimal SI, binary SI, or a decimal exponent. UI
// producers also supply spaced values and the existing MB/GB display aliases.
const QUANTITY_FACTORS: Readonly<Record<string, number>> = {
  '': 1,
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  Ei: 1024 ** 6,
};

const parseQuantity = (value: string | undefined, type: ResourceType): number | undefined => {
  const match = value?.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([a-zA-Z]*|[eE][+-]?\d+)$/);
  if (!match) {
    return undefined;
  }
  const suffix = match[2];
  const aliases: Readonly<Record<string, number>> = { MB: 1024 ** 2, GB: 1024 ** 3 };
  const factor = /^[eE][+-]?\d+$/.test(suffix)
    ? 10 ** Number(suffix.slice(1))
    : (QUANTITY_FACTORS[suffix] ?? (type === 'memory' ? aliases[suffix] : undefined));
  if (factor === undefined) {
    return undefined;
  }
  const parsed = Number(match[1]) * factor * (type === 'cpu' ? 1000 : 1 / 1024 ** 2);
  return Number.isFinite(parsed) ? parsed : undefined;
};

// CPU is expressed in millicores; memory is expressed in MiB.
export const parseResourceValue = (value: string | undefined, type: ResourceType): number =>
  parseQuantity(value, type) ?? 0;

// A missing usage or limit is unknown, while an explicit zero usage is valid.
export const getResourceLimitUsagePercent = (
  usage: string | undefined,
  limit: string | undefined,
  type: ResourceType
): number | undefined => {
  const rawUsage = parseQuantity(usage, type);
  const rawLimit = parseQuantity(limit, type);
  if (rawUsage === undefined || rawLimit === undefined || rawLimit <= 0 || rawUsage < 0) {
    return undefined;
  }
  const percentage = (rawUsage / rawLimit) * 100;
  return Number.isFinite(percentage) ? percentage : undefined;
};

// Format CPU values for display
export const formatCpuValue = (millicores: number): string => {
  if (millicores === 0) {
    return '0';
  }
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
  if (mb === 0) {
    return '0';
  }
  if (mb >= 1024 * 1024) {
    return `${(mb / (1024 * 1024)).toFixed(1)}Ti`;
  } else if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)}Gi`;
  } else {
    return `${Math.round(mb)}Mi`;
  }
};

export const formatResourceValue = (
  value: string | undefined,
  parsedValue: number,
  type: ResourceType
): string => {
  if (
    value === undefined ||
    isEmptyResourceValue(value) ||
    parseQuantity(value, type) === undefined
  ) {
    return '-';
  }
  if (type === 'cpu') {
    return `${Math.round(parsedValue)}m`;
  }
  return formatMemoryValue(parsedValue);
};

const calculateResourceScale = ({
  usage,
  request,
  limit,
  allocatable,
}: Omit<
  ResourceCalculations,
  | 'usagePercent'
  | 'requestPercent'
  | 'limitPercent'
  | 'consumption'
  | 'overcommittedAmount'
  | 'overcommittedPercent'
  | 'hasConfigIssue'
>): number => {
  if (allocatable > 0) {
    return allocatable;
  }
  return limit > 0 ? limit : Math.max(usage, request * 1.2);
};

const percentageOfScale = (value: number, scale: number): number => {
  if (scale <= 0) {
    return 0;
  }
  return Math.max(0, (value / scale) * 100);
};

const calculateOvercommit = (
  limit: number,
  allocatable: number
): Pick<ResourceCalculations, 'overcommittedAmount' | 'overcommittedPercent'> => {
  const overcommittedAmount = allocatable > 0 && limit > allocatable ? limit - allocatable : 0;
  return {
    overcommittedAmount,
    overcommittedPercent:
      overcommittedAmount > 0 ? Math.round((overcommittedAmount / allocatable) * 100) : 0,
  };
};

// Calculate all resource metrics
export const calculateResourceMetrics = (
  data: ResourceData,
  type: ResourceType
): ResourceCalculations => {
  const usage = parseResourceValue(data.usage, type);
  const request = parseResourceValue(data.request, type);
  const limit = parseResourceValue(data.limit, type);
  const allocatable = parseResourceValue(data.allocatable, type);

  const scale = calculateResourceScale({ usage, request, limit, allocatable });

  // Calculate true percentages. Rendering code clamps these only when using
  // them as CSS widths or marker positions.
  const usagePercent = percentageOfScale(usage, scale);
  const requestPercent = percentageOfScale(request, scale);
  const limitPercent = percentageOfScale(limit, scale);

  // Calculate consumption (usage vs request)
  const consumption = request > 0 ? Math.round((usage / request) * 100) : null;

  // Calculate overcommitted resources (limit vs allocatable)
  const { overcommittedAmount, overcommittedPercent } = calculateOvercommit(limit, allocatable);

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
