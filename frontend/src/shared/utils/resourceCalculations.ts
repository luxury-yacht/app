/**
 * frontend/src/shared/utils/resourceCalculations.ts
 *
 * Utility helpers for resourceCalculations.
 * Provides shared helper functions for the frontend.
 */

// Shared resource calculation utilities used by ResourceBar and object panel.
// CPU quantities are millicores and memory quantities are bytes throughout; only
// display formatting converts to other units.

export interface ResourceData {
  usage?: number;
  request?: number;
  limit?: number;
  allocatable?: number;
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

// Kubernetes quantities use decimal SI, binary SI, or a decimal exponent. Object
// detail payloads also supply spaced values and the existing MB/GB display aliases.
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

// Parses a quantity string into millicores (CPU) or bytes (memory); undefined when
// the value is absent or not a quantity (for example the "-" no-data marker).
export const parseResourceQuantity = (
  value: string | undefined,
  type: ResourceType
): number | undefined => {
  // Number conversion below rejects malformed decimal parts such as multiple dots.
  const match = value?.trim().match(/^([+-]?[\d.]+)\s*([a-zA-Z]*|[eE][+-]?\d+)$/);
  if (!match) {
    return undefined;
  }
  const suffix = match[2];
  const aliases: Readonly<Record<string, number>> = { MB: 1024 ** 2, GB: 1024 ** 3 };
  const aliasFactor = type === 'memory' ? aliases[suffix] : undefined;
  const factor = /^[eE][+-]?\d+$/.test(suffix)
    ? 10 ** Number(suffix.slice(1))
    : (QUANTITY_FACTORS[suffix] ?? aliasFactor);
  if (factor === undefined) {
    return undefined;
  }
  const parsed = Number(match[1]) * factor * (type === 'cpu' ? 1000 : 1);
  return Number.isFinite(parsed) ? parsed : undefined;
};

// A missing usage or limit is unknown, while an explicit zero usage is valid.
export const getResourceLimitUsagePercent = (
  usage: string | undefined,
  limit: string | undefined,
  type: ResourceType
): number | undefined => {
  const rawUsage = parseResourceQuantity(usage, type);
  const rawLimit = parseResourceQuantity(limit, type);
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

const BYTES_PER_MIB = 1024 * 1024;

// Format memory values for display
export const formatMemoryValue = (bytes: number): string => {
  if (bytes === 0) {
    return '0';
  }
  const mb = bytes / BYTES_PER_MIB;
  if (mb >= 1024 * 1024) {
    return `${(mb / (1024 * 1024)).toFixed(1)}Ti`;
  } else if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)}Gi`;
  } else {
    return `${Math.round(mb)}Mi`;
  }
};

const isResourceAmount = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);

export const formatResourceValue = (value: number | undefined, type: ResourceType): string => {
  if (!isResourceAmount(value)) {
    return '-';
  }
  if (type === 'cpu') {
    return `${Math.round(value)}m`;
  }
  return formatMemoryValue(value);
};

// Copy and Export write plain integers, with the unit in the column header, so
// spreadsheets can sort and sum them. Memory uses KiB: MiB is too coarse.
export const RESOURCE_EXPORT_UNITS: Readonly<Record<ResourceType, string>> = {
  cpu: 'm',
  memory: 'KiB',
};

export const formatResourceExportValue = (
  value: number | undefined,
  type: ResourceType
): string => {
  if (!isResourceAmount(value)) {
    return '-';
  }
  return String(Math.round(type === 'cpu' ? value : value / 1024));
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

export const calculateResourceOvercommit = (
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
export const calculateResourceMetrics = (data: ResourceData): ResourceCalculations => {
  const usage = data.usage ?? 0;
  const request = data.request ?? 0;
  const limit = data.limit ?? 0;
  const allocatable = data.allocatable ?? 0;

  const scale = calculateResourceScale({ usage, request, limit, allocatable });

  // Calculate true percentages. Rendering code clamps these only when using
  // them as CSS widths or marker positions.
  const usagePercent = percentageOfScale(usage, scale);
  const requestPercent = percentageOfScale(request, scale);
  const limitPercent = percentageOfScale(limit, scale);

  // Calculate consumption (usage vs request)
  const consumption = request > 0 ? Math.round((usage / request) * 100) : null;

  // Calculate overcommitted resources (limit vs allocatable)
  const { overcommittedAmount, overcommittedPercent } = calculateResourceOvercommit(
    limit,
    allocatable
  );

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
