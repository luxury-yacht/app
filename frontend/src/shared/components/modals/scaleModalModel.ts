/**
 * frontend/src/shared/components/modals/scaleModalModel.ts
 *
 * The replica counts the app can apply when scaling a workload.
 */

export const MAX_REPLICAS = 9999;

export const clampReplicas = (value: number): number => Math.max(0, Math.min(MAX_REPLICAS, value));
