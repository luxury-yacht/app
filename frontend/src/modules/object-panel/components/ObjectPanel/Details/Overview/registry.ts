/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/registry.ts
 *
 * Legacy fallback for Overview rendering. After the X1 descriptor migration, every built-in kind
 * renders via `descriptorRegistry` (see index.tsx). This module now only provides:
 *   - the GenericOverview fallback for unregistered/custom-resource kinds, and
 *   - per-kind action capabilities (`getResourceCapabilities`).
 */

import React from 'react';
import { GenericOverview } from './GenericOverview';

interface OverviewCapabilities {
  delete?: boolean;
  restart?: boolean;
  scale?: boolean;
  edit?: boolean;
  objPanelLogs?: boolean;
  exec?: boolean;
  trigger?: boolean;
  suspend?: boolean;
}

// Per-kind action capabilities, keyed by lowercase kind.
const CAPABILITIES_BY_KIND: Record<string, OverviewCapabilities> = {
  // Cluster resources
  customresourcedefinition: { delete: true, edit: true },
  ingressclass: { delete: true, edit: true },
  mutatingwebhookconfiguration: { delete: true, edit: true },
  namespace: { delete: true, edit: true },
  validatingwebhookconfiguration: { delete: true, edit: true },
  // Config
  configmap: { delete: true, edit: true },
  secret: { delete: true, edit: true },
  // Jobs
  job: { delete: true },
  cronjob: { delete: true, trigger: true, suspend: true },
  // Network
  service: { delete: true, edit: true },
  ingress: { delete: true, edit: true },
  endpointslice: { delete: true },
  networkpolicy: { delete: true, edit: true },
  // Gateway API
  gatewayclass: { delete: true, edit: true },
  gateway: { delete: true, edit: true },
  listenerset: { delete: true, edit: true },
  httproute: { delete: true, edit: true },
  grpcroute: { delete: true, edit: true },
  tlsroute: { delete: true, edit: true },
  backendtlspolicy: { delete: true, edit: true },
  referencegrant: { delete: true, edit: true },
  // Node
  node: { edit: true },
  // Pod
  pod: { delete: true, objPanelLogs: true, exec: true },
  // Policy / autoscaling
  horizontalpodautoscaler: { delete: true, edit: true },
  limitrange: { delete: true, edit: true },
  poddisruptionbudget: { delete: true, edit: true },
  resourcequota: { delete: true, edit: true },
  // RBAC
  clusterrole: { delete: true, edit: true },
  clusterrolebinding: { delete: true, edit: true },
  role: { delete: true, edit: true },
  rolebinding: { delete: true, edit: true },
  serviceaccount: { delete: true, edit: true },
  // Storage
  persistentvolume: { delete: true, edit: true },
  persistentvolumeclaim: { delete: true, edit: true },
  storageclass: { delete: true, edit: true },
  // Workloads
  daemonset: { delete: true, restart: true, scale: true, edit: true },
  deployment: { delete: true, restart: true, scale: true, edit: true },
  statefulset: { delete: true, restart: true, scale: true, edit: true },
  replicaset: { delete: true },
  // Helm
  helmrelease: { delete: true },
};

/**
 * Fallback renderer used by index.tsx for kinds without a registered descriptor (custom resources
 * and anything not yet covered). Renders the generic, field-agnostic overview.
 */
export const overviewRegistry = {
  renderComponent(props: any): React.ReactElement {
    return React.createElement(GenericOverview, props);
  },
};

// Action capabilities for a kind; custom/unknown kinds default to delete-only.
export function getResourceCapabilities(kind: string): OverviewCapabilities {
  return CAPABILITIES_BY_KIND[kind.toLowerCase()] || { delete: true };
}
