import {
  IgnoreClusterAttentionFindingType,
  IgnoreClusterAttentionObject,
  RestoreClusterAttentionFindingType,
  RestoreClusterAttentionObject,
} from '@/core/backend-api';
import type { AttentionIgnoreRules, ResourceRef } from '@/core/refresh/types';

const requireClusterId = (clusterId: string) => {
  if (!clusterId) {
    throw new Error('clusterId is required');
  }
};

const normalizeRules = (rules: AttentionIgnoreRules | null): AttentionIgnoreRules => ({
  ignoredObjects: rules?.ignoredObjects ?? [],
  findingTypes: rules?.findingTypes ?? [],
});

export async function ignoreClusterAttentionObject(
  clusterId: string,
  ref: ResourceRef
): Promise<AttentionIgnoreRules> {
  requireClusterId(clusterId);
  return normalizeRules(await IgnoreClusterAttentionObject(clusterId, ref));
}

export async function restoreClusterAttentionObject(
  clusterId: string,
  ref: ResourceRef
): Promise<AttentionIgnoreRules> {
  requireClusterId(clusterId);
  return normalizeRules(await RestoreClusterAttentionObject(clusterId, ref));
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
