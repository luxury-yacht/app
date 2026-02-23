/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/useOverviewData.test.ts
 *
 * Regression tests for useOverviewData. Verifies that the grouped-memo
 * refactor produces the same output as the original monolithic useMemo for
 * representative resource kinds across all 7 category groups, plus the
 * default fallback and null-objectData cases.
 */

import ReactDOM from 'react-dom/client';
import React, { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useOverviewData } from './useOverviewData';

type Params = Parameters<typeof useOverviewData>[0];
type Result = ReturnType<typeof useOverviewData>;

// Builds a params object where every detail field is null.
function emptyParams(objectData: Params['objectData'] = null): Params {
  return {
    objectData,
    podDetails: null,
    deploymentDetails: null,
    replicaSetDetails: null,
    daemonSetDetails: null,
    statefulSetDetails: null,
    jobDetails: null,
    cronJobDetails: null,
    configMapDetails: null,
    secretDetails: null,
    helmReleaseDetails: null,
    serviceDetails: null,
    ingressDetails: null,
    networkPolicyDetails: null,
    endpointSliceDetails: null,
    pvcDetails: null,
    pvDetails: null,
    storageClassDetails: null,
    serviceAccountDetails: null,
    roleDetails: null,
    roleBindingDetails: null,
    clusterRoleDetails: null,
    clusterRoleBindingDetails: null,
    hpaDetails: null,
    pdbDetails: null,
    resourceQuotaDetails: null,
    limitRangeDetails: null,
    nodeDetails: null,
    namespaceDetails: null,
    ingressClassDetails: null,
    crdDetails: null,
    mutatingWebhookDetails: null,
    validatingWebhookDetails: null,
  };
}

describe('useOverviewData', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const resultRef: { current: Result } = { current: null };

  const renderHook = (params: Params) => {
    const Harness: React.FC = () => {
      resultRef.current = useOverviewData(params);
      return null;
    };
    act(() => {
      root.render(React.createElement(Harness));
    });
    return resultRef.current;
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    resultRef.current = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('returns null when objectData is null', () => {
    const result = renderHook(emptyParams(null));
    expect(result).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Workloads group
  // -----------------------------------------------------------------------

  it('maps Pod details from the workloads group', () => {
    const params = emptyParams({ kind: 'Pod', namespace: 'ns-a', name: 'web-1' });
    params.podDetails = {
      name: 'web-1',
      age: '2h',
      node: 'node-1',
      nodeIP: '10.0.0.1',
      podIP: '10.1.0.5',
      ownerKind: 'ReplicaSet',
      ownerName: 'web-abc',
      status: 'Running',
      ready: '1/1',
      restarts: 0,
      qosClass: 'Burstable',
      priorityClass: '',
      serviceAccount: 'default',
      hostNetwork: false,
      labels: { app: 'web' },
      annotations: {},
    } as any;

    const result = renderHook(params);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('Pod');
    expect(result!.name).toBe('web-1');
    expect(result!.node).toBe('node-1');
    expect(result!.namespace).toBe('ns-a');
    expect(result!.owner).toEqual({ kind: 'ReplicaSet', name: 'web-abc' });
    expect(result!.labels).toEqual({ app: 'web' });
  });

  it('maps Deployment details from the workloads group', () => {
    const params = emptyParams({ kind: 'Deployment', namespace: 'prod', name: 'api' });
    params.deploymentDetails = {
      name: 'api',
      age: '5d',
      namespace: 'prod',
      replicas: 3,
      desiredReplicas: 3,
      ready: 3,
      upToDate: 3,
      available: 3,
      strategy: 'RollingUpdate',
      labels: { tier: 'backend' },
      annotations: {},
    } as any;

    const result = renderHook(params);
    expect(result!.kind).toBe('Deployment');
    expect(result!.ready).toBe('3');
    expect(result!.strategy).toBe('RollingUpdate');
  });

  // -----------------------------------------------------------------------
  // Config group
  // -----------------------------------------------------------------------

  it('maps ConfigMap details from the config group', () => {
    const params = emptyParams({ kind: 'ConfigMap', namespace: 'default', name: 'app-config' });
    params.configMapDetails = {
      name: 'app-config',
      age: '1d',
      namespace: 'default',
    } as any;

    const result = renderHook(params);
    expect(result!.kind).toBe('ConfigMap');
    expect(result!.configMapDetails).toBe(params.configMapDetails);
  });

  // -----------------------------------------------------------------------
  // Network group
  // -----------------------------------------------------------------------

  it('maps Service details from the network group', () => {
    const params = emptyParams({ kind: 'Service', namespace: 'default', name: 'frontend' });
    params.serviceDetails = {
      name: 'frontend',
      age: '3d',
      namespace: 'default',
    } as any;

    const result = renderHook(params);
    expect(result!.kind).toBe('Service');
    expect(result!.serviceDetails).toBe(params.serviceDetails);
  });

  // -----------------------------------------------------------------------
  // Storage group
  // -----------------------------------------------------------------------

  it('maps PVC details from the storage group', () => {
    const params = emptyParams({ kind: 'PersistentVolumeClaim', namespace: 'data', name: 'db-pvc' });
    params.pvcDetails = {
      name: 'db-pvc',
      age: '30d',
      namespace: 'data',
      status: 'Bound',
      volumeName: 'pv-123',
      capacity: '10Gi',
      accessModes: ['ReadWriteOnce'],
      storageClass: 'standard',
      volumeMode: 'Filesystem',
      mountedBy: ['db-0'],
      labels: {},
      annotations: {},
    } as any;

    const result = renderHook(params);
    expect(result!.kind).toBe('PersistentVolumeClaim');
    expect(result!.status).toBe('Bound');
    expect(result!.volumeName).toBe('pv-123');
    expect(result!.mountedBy).toEqual(['db-0']);
  });

  // -----------------------------------------------------------------------
  // RBAC group
  // -----------------------------------------------------------------------

  it('maps ClusterRole details from the RBAC group', () => {
    const params = emptyParams({ kind: 'ClusterRole', name: 'admin' });
    params.clusterRoleDetails = {
      name: 'admin',
      age: '90d',
      rules: [{ apiGroups: ['*'], resources: ['*'], verbs: ['*'] }],
      aggregationRule: null,
      clusterRoleBindings: ['admin-binding'],
      labels: {},
      annotations: {},
    } as any;

    const result = renderHook(params);
    expect(result!.kind).toBe('ClusterRole');
    expect(result!.policyRules).toEqual([{ apiGroups: ['*'], resources: ['*'], verbs: ['*'] }]);
    expect(result!.clusterRoleBindings).toEqual(['admin-binding']);
  });

  // -----------------------------------------------------------------------
  // Policy group
  // -----------------------------------------------------------------------

  it('maps HPA details from the policy group', () => {
    const params = emptyParams({ kind: 'HorizontalPodAutoscaler', namespace: 'prod', name: 'api-hpa' });
    params.hpaDetails = {
      name: 'api-hpa',
      age: '7d',
      namespace: 'prod',
      scaleTargetRef: { kind: 'Deployment', name: 'api' },
      minReplicas: 2,
      maxReplicas: 10,
      currentReplicas: 3,
      desiredReplicas: 3,
      labels: {},
      annotations: {},
    } as any;

    const result = renderHook(params);
    expect(result!.kind).toBe('HorizontalPodAutoscaler');
    expect(result!.minReplicas).toBe(2);
    expect(result!.maxReplicas).toBe(10);
    expect(result!.scaleTargetRef).toEqual({ kind: 'Deployment', name: 'api' });
  });

  // -----------------------------------------------------------------------
  // Cluster group
  // -----------------------------------------------------------------------

  it('maps Node details from the cluster group', () => {
    const params = emptyParams({ kind: 'Node', name: 'node-1' });
    params.nodeDetails = {
      name: 'node-1',
      age: '60d',
      status: 'Ready',
      roles: ['control-plane'],
      version: 'v1.29.0',
      os: 'linux',
      osImage: 'Ubuntu 22.04',
      architecture: 'amd64',
      containerRuntime: 'containerd://1.7.0',
      kernelVersion: '5.15.0',
      kubeletVersion: 'v1.29.0',
      hostname: 'node-1',
      internalIP: '10.0.0.1',
      externalIP: '',
      cpuCapacity: '8',
      cpuAllocatable: '7800m',
      memoryCapacity: '32Gi',
      memoryAllocatable: '30Gi',
      labels: { 'node-role.kubernetes.io/control-plane': '' },
      annotations: {},
    } as any;

    const result = renderHook(params);
    expect(result!.kind).toBe('Node');
    expect(result!.name).toBe('node-1');
    expect(result!.status).toBe('Ready');
    expect(result!.roles).toEqual(['control-plane']);
    expect(result!.cpuCapacity).toBe('8');
  });

  // -----------------------------------------------------------------------
  // Default fallback
  // -----------------------------------------------------------------------

  it('returns default fallback for unrecognised resource kinds', () => {
    const objectData = {
      kind: 'CustomWidget',
      name: 'my-widget',
      namespace: 'tools',
      age: '1h',
      status: 'Active',
      apiGroup: 'widgets.example.com',
      labels: { team: 'platform' },
    };
    const result = renderHook(emptyParams(objectData));

    expect(result!.kind).toBe('CustomWidget');
    expect(result!.name).toBe('my-widget');
    expect(result!.namespace).toBe('tools');
    expect(result!.apiGroup).toBe('widgets.example.com');
    expect(result!.labels).toEqual({ team: 'platform' });
  });

  it('ignores detail objects that do not match the current kind', () => {
    // objectData says Service, but we populate podDetails — should NOT produce Pod output.
    const params = emptyParams({ kind: 'Service', namespace: 'default', name: 'svc' });
    params.podDetails = { name: 'stale-pod', age: '1h', status: 'Running' } as any;

    const result = renderHook(params);
    // Falls through to default fallback since no serviceDetails is set.
    expect(result!.kind).toBe('Service');
    expect(result!.name).toBe('svc');
    // Pod-specific fields should NOT leak through.
    expect(result!.node).toBeUndefined();
    expect(result!.restarts).toBeUndefined();
  });
});
