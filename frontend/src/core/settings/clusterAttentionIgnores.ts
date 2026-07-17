import {
  IgnoreClusterAttentionFindingType,
  IgnoreClusterAttentionObjectFinding,
  IgnoreGlobalAttentionFindingType,
  RestoreClusterAttentionFindingType,
  RestoreClusterAttentionObjectFinding,
  RestoreGlobalAttentionFindingType,
} from '@/core/backend-api';
import type { AttentionIgnoreRules, ResourceRef } from '@/core/refresh/types';

const requireClusterId = (clusterId: string) => {
  if (!clusterId) {
    throw new Error('clusterId is required');
  }
};

const normalizeRules = (rules: AttentionIgnoreRules | null): AttentionIgnoreRules => ({
  objectFindings: rules?.objectFindings ?? [],
  clusterFindingTypes: rules?.clusterFindingTypes ?? [],
  globalFindingTypes: rules?.globalFindingTypes ?? [],
});

export async function ignoreClusterAttentionObjectFinding(
  clusterId: string,
  ref: ResourceRef,
  findingType: string
): Promise<AttentionIgnoreRules> {
  requireClusterId(clusterId);
  return normalizeRules(await IgnoreClusterAttentionObjectFinding(clusterId, ref, findingType));
}

export async function restoreClusterAttentionObjectFinding(
  clusterId: string,
  ref: ResourceRef,
  findingType: string
): Promise<AttentionIgnoreRules> {
  requireClusterId(clusterId);
  return normalizeRules(await RestoreClusterAttentionObjectFinding(clusterId, ref, findingType));
}

export async function ignoreClusterAttentionFindingType(
  clusterId: string,
  findingType: string
): Promise<AttentionIgnoreRules> {
  requireClusterId(clusterId);
  return normalizeRules(await IgnoreClusterAttentionFindingType(clusterId, findingType));
}

export async function restoreClusterAttentionFindingType(
  clusterId: string,
  findingType: string
): Promise<AttentionIgnoreRules> {
  requireClusterId(clusterId);
  return normalizeRules(await RestoreClusterAttentionFindingType(clusterId, findingType));
}

export async function ignoreGlobalAttentionFindingType(
  clusterId: string,
  findingType: string
): Promise<AttentionIgnoreRules> {
  requireClusterId(clusterId);
  return normalizeRules(await IgnoreGlobalAttentionFindingType(clusterId, findingType));
}

export async function restoreGlobalAttentionFindingType(
  clusterId: string,
  findingType: string
): Promise<AttentionIgnoreRules> {
  requireClusterId(clusterId);
  return normalizeRules(await RestoreGlobalAttentionFindingType(clusterId, findingType));
}
