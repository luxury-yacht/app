/**
 * frontend/src/modules/object-panel/components/ObjectPanel/constants.ts
 *
 * UI component for constants.
 * Handles rendering and interactions for the object panel feature.
 */

import type { ResourceCapability } from './types';
import type { ObjectDetailsRefresherName } from '@/core/refresh/refresherTypes';

export const MIN_PANEL_WIDTH = 500;
export const CLUSTER_SCOPE = '__cluster__';
export const INACTIVE_SCOPE = '__inactive__';

export const WORKLOAD_KIND_API_NAMES: Record<string, string> = {
  deployment: 'Deployment',
  daemonset: 'DaemonSet',
  statefulset: 'StatefulSet',
  replicaset: 'ReplicaSet',
};

export const RESOURCE_CAPABILITIES: Record<string, ResourceCapability> = {
  // Workloads
  pod: { logs: true, delete: true, shell: true },
  deployment: { logs: true, restart: true, scale: true, delete: true },
  daemonset: { logs: true, restart: true, delete: true },
  statefulset: { logs: true, restart: true, scale: true, delete: true },
  job: { logs: true, delete: true },
  cronjob: { logs: true, delete: true, trigger: true, suspend: true },
  replicaset: { logs: true, delete: true },

  // Configuration
  configmap: { delete: true },
  secret: { delete: true },

  // Network
  service: { delete: true },
  ingress: { delete: true },
  networkpolicy: { delete: true },
  endpointslice: { delete: true },

  // Storage
  persistentvolumeclaim: { delete: true },
  persistentvolume: { delete: true },
  storageclass: { delete: true },

  // RBAC
  serviceaccount: { delete: true },
  role: { delete: true },
  rolebinding: { delete: true },
  clusterrole: { delete: true },
  clusterrolebinding: { delete: true },

  // Autoscaling & Policy
  horizontalpodautoscaler: { delete: true },
  poddisruptionbudget: { delete: true },
  resourcequota: { delete: true },
  limitrange: { delete: true },

  // Cluster Resources
  namespace: { delete: true },
  ingressclass: { delete: true },
  customresourcedefinition: { delete: true },
  mutatingwebhookconfiguration: { delete: true },
  validatingwebhookconfiguration: { delete: true },

  // Helm
  helmrelease: { delete: true },
};

export const getObjectDetailsRefresherName = (
  kind?: string | null
): ObjectDetailsRefresherName | null => {
  if (!kind) {
    return null;
  }
  return `object-${kind.toLowerCase()}` as ObjectDetailsRefresherName;
};

export const TABS = {
  DETAILS: { id: 'details', label: 'Details', alwaysShow: true },
  VALUES: { id: 'values', label: 'Values' },
  MANIFEST: { id: 'manifest', label: 'Manifest' },
  LOGS: { id: 'logs', label: 'Logs', requiresCapability: 'hasLogs' },
  PODS: {
    id: 'pods',
    label: 'Pods',
    onlyForKinds: [
      'node',
      'deployment',
      'daemonset',
      'statefulset',
      'job',
      'cronjob',
      'replicaset',
    ],
  },
  EVENTS: { id: 'events', label: 'Events', alwaysShow: true },
  YAML: { id: 'yaml', label: 'YAML', alwaysShow: true },
  MAINTENANCE: { id: 'maintenance', label: 'Maintenance', onlyForKinds: ['node'] },
  SHELL: {
    id: 'shell',
    label: 'Shell',
    requiresCapability: 'hasShell',
    onlyForKinds: ['pod'],
  },
} as const;
