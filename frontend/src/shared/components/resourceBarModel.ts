import { formatResourceValue, type ResourceType } from '@shared/utils/resourceCalculations';
import {
  USAGE_CRITICAL_THRESHOLD_PERCENT,
  USAGE_HIGH_THRESHOLD_PERCENT,
} from './resourceBarThresholds';

export type ResourceBarStatus = 'critical' | 'warning' | 'normal' | 'unbounded';

interface ParsedResourceValues {
  usage: number;
  request: number;
  limit: number;
  allocatable: number;
}

interface ResourceBarScale {
  max: number;
  isUnbounded: boolean;
}

export interface ResourceBarModel extends ParsedResourceValues {
  maxScale: number;
  isUnbounded: boolean;
  usagePercent: number;
  requestPercent: number;
  limitPercent: number;
  usageVsLimit: number;
  usageVsAllocatable: number;
  status: ResourceBarStatus;
  hasConfigIssue: boolean;
  consumption: number | null;
  overcommittedAmount: number;
  overcommittedPercent: number;
  formattedUsage: string;
  formattedRequest: string;
  formattedLimit: string;
  formattedAllocatable: string;
  formattedOvercommitted: string;
  showReserved: boolean;
  showOverLimit: boolean;
}

/** CPU values are millicores and memory values are bytes; undefined means no value. */
export interface ResourceBarModelInput {
  usage?: number;
  request?: number;
  limit?: number;
  allocatable?: number;
  type: ResourceType;
}

const calculateScale = ({
  usage,
  request,
  limit,
  allocatable,
}: ParsedResourceValues): ResourceBarScale => {
  if (allocatable > 0) {
    return { max: allocatable, isUnbounded: false };
  }
  // Aggregated requests can exceed aggregated limits when some containers omit limits.
  // Preserve headroom so request and limit markers do not collapse at the bar edge.
  if (limit > 0 && request > limit) {
    return { max: Math.max(usage, request * 1.2), isUnbounded: false };
  }
  if (limit > 0) {
    return { max: limit, isUnbounded: false };
  }
  if (request > 0) {
    return { max: Math.max(usage, request * 1.2), isUnbounded: false };
  }
  return usage > 0 ? { max: usage, isUnbounded: true } : { max: 0, isUnbounded: false };
};

const statusForPercent = (percent: number): ResourceBarStatus => {
  if (percent >= USAGE_CRITICAL_THRESHOLD_PERCENT) {
    return 'critical';
  }
  return percent >= USAGE_HIGH_THRESHOLD_PERCENT ? 'warning' : 'normal';
};

const calculateStatus = (
  values: ParsedResourceValues,
  usageVsLimit: number,
  usageVsAllocatable: number
): ResourceBarStatus => {
  if (values.allocatable > 0) {
    return statusForPercent(usageVsAllocatable);
  }
  if (values.request > 0 && values.usage > values.request) {
    return values.limit > 0 && usageVsLimit > 95 ? 'critical' : 'warning';
  }
  if (values.limit > 0) {
    if (usageVsLimit > 95) {
      return 'critical';
    }
    return usageVsLimit > 80 ? 'warning' : 'normal';
  }
  return values.request > 0 ? 'normal' : 'unbounded';
};

const clampPercent = (value: number, maxScale: number): number => {
  if (maxScale === 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (value / maxScale) * 100));
};

const resolveResourceValues = (input: ResourceBarModelInput): ParsedResourceValues => ({
  usage: input.usage ?? 0,
  request: input.request ?? 0,
  limit: input.limit ?? 0,
  allocatable: input.allocatable ?? 0,
});

// Formats the inputs rather than the zero-filled values, so an absent value reads "-".
const formatResourceBarValues = (
  { usage, request, limit, allocatable, type }: ResourceBarModelInput,
  overcommittedAmount: number
): Pick<
  ResourceBarModel,
  | 'formattedUsage'
  | 'formattedRequest'
  | 'formattedLimit'
  | 'formattedAllocatable'
  | 'formattedOvercommitted'
> => ({
  formattedUsage: formatResourceValue(usage, type),
  formattedRequest: formatResourceValue(request, type),
  formattedLimit: formatResourceValue(limit, type),
  formattedAllocatable: formatResourceValue(allocatable, type),
  formattedOvercommitted:
    limit === undefined ? '-' : formatResourceValue(overcommittedAmount, type),
});

export const createResourceBarModel = (input: ResourceBarModelInput): ResourceBarModel => {
  const values = resolveResourceValues(input);
  const scale = calculateScale(values);
  const usageVsLimit = values.limit > 0 ? (values.usage / values.limit) * 100 : 0;
  const usageVsAllocatable = values.allocatable > 0 ? (values.usage / values.allocatable) * 100 : 0;
  const usagePercent = scale.isUnbounded ? 100 : clampPercent(values.usage, scale.max);
  const requestPercent = values.request > 0 ? clampPercent(values.request, scale.max) : 0;
  const limitPercent = values.limit > 0 ? clampPercent(values.limit, scale.max) : 0;
  const overcommittedAmount =
    values.allocatable > 0 && values.limit > values.allocatable
      ? values.limit - values.allocatable
      : 0;

  return {
    ...values,
    maxScale: scale.max,
    isUnbounded: scale.isUnbounded,
    usagePercent,
    requestPercent,
    limitPercent,
    usageVsLimit,
    usageVsAllocatable,
    status: calculateStatus(values, usageVsLimit, usageVsAllocatable),
    hasConfigIssue: values.request > 0 && values.limit > 0 && values.request > values.limit,
    consumption: values.request > 0 ? Math.round((values.usage / values.request) * 100) : null,
    overcommittedAmount,
    overcommittedPercent:
      values.allocatable > 0 ? Math.round((overcommittedAmount / values.allocatable) * 100) : 0,
    ...formatResourceBarValues(input, overcommittedAmount),
    showReserved: values.request > values.usage && requestPercent > usagePercent,
    showOverLimit: values.limit > 0 && values.usage > values.limit && usagePercent > limitPercent,
  };
};
