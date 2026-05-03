import type { PanelObjectData } from './types';

const MAP_SUPPORTED_KINDS = new Set([
  'pod',
  'service',
  'endpointslice',
  'persistentvolumeclaim',
  'persistentvolume',
  'storageclass',
  'configmap',
  'secret',
  'serviceaccount',
  'node',
  'clusterrole',
  'clusterrolebinding',
  'deployment',
  'replicaset',
  'statefulset',
  'daemonset',
  'job',
  'cronjob',
  'horizontalpodautoscaler',
  'ingress',
  'ingressclass',
]);

const hasText = (value: string | null | undefined): boolean => Boolean(value?.trim());

export const isObjectMapSupportedKind = (kind: string | null | undefined): boolean =>
  Boolean(kind && MAP_SUPPORTED_KINDS.has(kind.trim().toLowerCase()));

export const hasCompleteObjectMapReference = (
  objectData: PanelObjectData | null | undefined
): objectData is PanelObjectData & {
  clusterId: string;
  group: string;
  kind: string;
  name: string;
  version: string;
} => {
  if (!objectData || !isObjectMapSupportedKind(objectData.kind)) {
    return false;
  }

  return (
    hasText(objectData.clusterId) &&
    hasText(objectData.kind) &&
    hasText(objectData.name) &&
    objectData.group != null &&
    hasText(objectData.version)
  );
};
