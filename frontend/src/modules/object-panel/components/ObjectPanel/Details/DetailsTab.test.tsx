import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DetailsTabProps } from './DetailsTab';

const useShortcutMock = vi.fn();
const overviewMock = vi.fn();
const utilizationMock = vi.fn();
const containersMock = vi.fn();
const dataMock = vi.fn();

vi.mock('@ui/shortcuts', () => ({
  useShortcut: (options: unknown) => useShortcutMock(options),
  useSearchShortcutTarget: () => undefined,
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Details/Overview', () => ({
  __esModule: true,
  default: (props: unknown) => {
    overviewMock(props);
    return <div data-testid="mock-overview" />;
  },
}));

vi.mock('./DetailsTabUtilization', () => ({
  __esModule: true,
  default: (props: unknown) => {
    utilizationMock(props);
    return <div data-testid="mock-utilization" />;
  },
}));

vi.mock('./DetailsTabContainers', () => ({
  __esModule: true,
  default: (props: unknown) => {
    containersMock(props);
    return <div data-testid="mock-containers" />;
  },
}));

vi.mock('./DetailsTabData', () => ({
  __esModule: true,
  default: (props: unknown) => {
    dataMock(props);
    return <div data-testid="mock-data" />;
  },
}));

import DetailsTab from './DetailsTab';

const renderDetailsTab = async (props: DetailsTabProps) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    root.render(<DetailsTab {...props} />);
    await Promise.resolve();
  });

  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

const createBaseProps = (overrides: Partial<DetailsTabProps> = {}): DetailsTabProps => ({
  objectData: { kind: 'Pod', name: 'pod-1', namespace: 'default', age: '1h', status: 'Running' },
  isActive: true,
  podDetails: null,
  deploymentDetails: null,
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
  detailsLoading: false,
  detailsError: null,
  resourceDeleted: false,
  deletedResourceName: '',
  canRestart: true,
  canScale: true,
  canDelete: true,
  restartDisabledReason: undefined,
  scaleDisabledReason: undefined,
  deleteDisabledReason: undefined,
  actionLoading: false,
  actionError: null,
  scaleReplicas: 2,
  showScaleInput: false,
  onRestartClick: vi.fn(),
  onDeleteClick: vi.fn(),
  onScaleClick: vi.fn(),
  onScaleCancel: vi.fn(),
  onScaleReplicasChange: vi.fn(),
  onShowScaleInput: vi.fn(),
  ...overrides,
});

type OverviewScenario = {
  name: string;
  objectData: Record<string, unknown>;
  extraProps: Partial<DetailsTabProps>;
  expectedOverview: Record<string, unknown>;
  expectUtilization?: Record<string, unknown> | null;
  expectContainers?: boolean;
  expectData?: Record<string, unknown> | null;
};

const buildScenarioProps = (scenario: OverviewScenario): DetailsTabProps => {
  const base = createBaseProps();
  base.objectData = { ...base.objectData, ...scenario.objectData };
  Object.assign(base, scenario.extraProps);
  return base;
};

describe('DetailsTab', () => {
  beforeEach(() => {
    overviewMock.mockClear();
    utilizationMock.mockClear();
    containersMock.mockClear();
    dataMock.mockClear();
    useShortcutMock.mockClear();
  });

  it('passes pod overview, utilization, and container data to child components', async () => {
    const props = createBaseProps({
      podDetails: {
        name: 'pod-1',
        age: '1h',
        node: 'node-a',
        nodeIP: '10.0.0.1',
        podIP: '192.168.0.10',
        ownerKind: 'Deployment',
        ownerName: 'web',
        status: 'Running',
        ready: '1/1',
        restarts: 0,
        qosClass: 'Burstable',
        serviceAccount: 'default',
        hostNetwork: false,
        containers: [{ name: 'app', image: 'example/app:1.0.0' }],
        initContainers: [{ name: 'init', image: 'busybox' }],
        cpuUsage: '100m',
        cpuRequest: '50m',
        cpuLimit: '200m',
        memUsage: '128Mi',
        memRequest: '64Mi',
        memLimit: '256Mi',
        labels: {},
        annotations: {},
      } as any,
    });

    const { cleanup } = await renderDetailsTab(props);
    expect(overviewMock).toHaveBeenCalled();
    expect(utilizationMock).toHaveBeenCalled();
    expect(containersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        containers: expect.arrayContaining([{ name: 'app', image: 'example/app:1.0.0' }]),
        initContainers: expect.arrayContaining([{ name: 'init', image: 'busybox' }]),
      })
    );
    expect(dataMock).not.toHaveBeenCalled();

    const overviewProps = overviewMock.mock.calls[0][0] as Record<string, unknown>;
    expect(overviewProps).toMatchObject({
      kind: 'Pod',
      name: 'pod-1',
      namespace: 'default',
      canRestart: true,
      onScale: expect.any(Function),
    });
    expect(useShortcutMock).toHaveBeenCalledWith(expect.objectContaining({ key: 'o' }));
    cleanup();
  });

  it('renders data section for config maps', async () => {
    const props = createBaseProps({
      objectData: { kind: 'ConfigMap', name: 'cfg', namespace: 'default', age: '2d' },
      configMapDetails: {
        name: 'cfg',
        namespace: 'default',
        age: '2d',
        data: { key: 'value' },
        binaryData: {},
      } as any,
    });

    const { cleanup } = await renderDetailsTab(props);

    expect(dataMock).toHaveBeenCalled();
    expect(dataMock.mock.calls[0][0]).toMatchObject({ isSecret: false });
    cleanup();
  });

  it('uses node utilization metrics and omits containers when not applicable', async () => {
    const props = createBaseProps({
      objectData: { kind: 'Node', name: 'node-a', namespace: '', age: '10d' },
      nodeDetails: {
        name: 'node-a',
        age: '10d',
        cpuUsage: '2',
        cpuCapacity: '4',
        cpuAllocatable: '3',
        cpuRequests: '1',
        cpuLimits: '3',
        memoryUsage: '8Gi',
        memoryCapacity: '16Gi',
        memoryAllocatable: '15Gi',
        memRequests: '4Gi',
        memLimits: '12Gi',
        podsCount: 50,
        podsCapacity: '110',
        podsAllocatable: '100',
      } as any,
    });

    const { cleanup } = await renderDetailsTab(props);

    expect(utilizationMock).toHaveBeenCalled();
    expect(utilizationMock.mock.calls[0][0]).toMatchObject({ mode: 'nodeMetrics' });
    expect(containersMock).not.toHaveBeenCalled();
    cleanup();
  });

  it('shows loading overlay, deletion warning, and error messages', async () => {
    const props = createBaseProps({
      detailsLoading: true,
      resourceDeleted: true,
      deletedResourceName: 'pod-1',
      actionError: 'boom',
      detailsError: 'fetch failed',
    });

    const { container, cleanup } = await renderDetailsTab(props);
    expect(container.textContent).toContain('Loading pod details...');
    expect(container.textContent).toContain(
      'pod-1 no longer exists. Please select another resource.'
    );
    expect(container.textContent).toContain('Error: boom');
    expect(container.textContent).toContain('Error loading details: fetch failed');
    cleanup();
  });

  describe('overview data mapping', () => {
    const scenarios: OverviewScenario[] = [
      {
        name: 'Deployment overview includes rollout metadata',
        objectData: { kind: 'Deployment', name: 'web', namespace: 'apps', age: '1h' },
        extraProps: {
          deploymentDetails: {
            name: 'web',
            age: '1h',
            namespace: 'apps',
            replicas: 3,
            desiredReplicas: 3,
            ready: 2,
            upToDate: 2,
            available: 2,
            strategy: 'RollingUpdate',
            maxSurge: '25%',
            maxUnavailable: '25%',
            minReadySeconds: 30,
            revisionHistory: 10,
            progressDeadline: '5m',
            paused: false,
            rolloutStatus: 'Complete',
            rolloutMessage: 'All good',
            observedGeneration: 2,
            currentRevision: 'rev-1',
            selector: { matchLabels: { app: 'web' } },
            conditions: [],
            replicaSets: [],
            pods: [{}, {}],
            cpuUsage: '100m',
            cpuRequest: '50m',
            cpuLimit: '200m',
            memUsage: '256Mi',
            memRequest: '128Mi',
            memLimit: '512Mi',
            containers: [{ name: 'main', image: 'img:v1' }],
            labels: { app: 'web' },
            annotations: { team: 'platform' },
          } as any,
        },
        expectedOverview: {
          kind: 'Deployment',
          name: 'web',
          desiredReplicas: 3,
          ready: '2',
        },
        expectUtilization: {
          cpu: expect.objectContaining({ usage: '100m', limit: '200m' }),
          memory: expect.objectContaining({ usage: '256Mi', limit: '512Mi' }),
        },
        expectContainers: true,
      },
      {
        name: 'DaemonSet overview maps readiness',
        objectData: { kind: 'DaemonSet', name: 'ds', namespace: 'ops', age: '2h' },
        extraProps: {
          daemonSetDetails: {
            name: 'ds',
            age: '2h',
            namespace: 'ops',
            desired: 5,
            current: 4,
            ready: 3,
            upToDate: 4,
            available: 4,
            updateStrategy: 'RollingUpdate',
            numberMisscheduled: 1,
            labels: {},
            annotations: {},
            pods: [{}, {}, {}],
            cpuUsage: '200m',
            cpuRequest: '150m',
            cpuLimit: '500m',
            memUsage: '300Mi',
            memRequest: '256Mi',
            memLimit: '600Mi',
            containers: [{ name: 'sidecar', image: 'img:v2' }],
          } as any,
        },
        expectedOverview: {
          kind: 'DaemonSet',
          desired: 5,
          ready: '3',
        },
        expectUtilization: {
          cpu: expect.objectContaining({ usage: '200m', limit: '500m' }),
          memory: expect.objectContaining({ usage: '300Mi', limit: '600Mi' }),
        },
        expectContainers: true,
      },
      {
        name: 'StatefulSet overview lists service name',
        objectData: { kind: 'StatefulSet', name: 'sts', namespace: 'data', age: '3h' },
        extraProps: {
          statefulSetDetails: {
            name: 'sts',
            age: '3h',
            namespace: 'data',
            replicas: 6,
            desiredReplicas: 6,
            ready: 5,
            upToDate: 5,
            available: 5,
            updateStrategy: 'RollingUpdate',
            serviceName: 'sts-headless',
            podManagementPolicy: 'Parallel',
            labels: {},
            annotations: {},
            pods: [{}, {}],
            cpuUsage: '120m',
            cpuRequest: '100m',
            cpuLimit: '300m',
            memUsage: '256Mi',
            memRequest: '200Mi',
            memLimit: '512Mi',
            containers: [{ name: 'db', image: 'img:v3' }],
          } as any,
        },
        expectedOverview: {
          kind: 'StatefulSet',
          serviceName: 'sts-headless',
          ready: '5',
        },
        expectUtilization: {
          cpu: expect.objectContaining({ usage: '120m', limit: '300m' }),
          memory: expect.objectContaining({ usage: '256Mi', limit: '512Mi' }),
        },
        expectContainers: true,
      },
      {
        name: 'Service overview provides details payload',
        objectData: { kind: 'Service', name: 'svc', namespace: 'net', age: '4h' },
        extraProps: {
          serviceDetails: {
            name: 'svc',
            age: '4h',
            namespace: 'net',
            clusterIP: '10.0.0.5',
            ports: [],
            type: 'ClusterIP',
          } as any,
        },
        expectedOverview: {
          kind: 'Service',
          serviceDetails: expect.objectContaining({ clusterIP: '10.0.0.5' }),
        },
        expectUtilization: null,
        expectContainers: false,
      },
      {
        name: 'Ingress overview returns TLS data',
        objectData: { kind: 'Ingress', name: 'ing', namespace: 'net', age: '5h' },
        extraProps: {
          ingressDetails: {
            name: 'ing',
            age: '5h',
            namespace: 'net',
            rules: [],
            tls: [{ secretName: 'tls' }],
          } as any,
        },
        expectedOverview: {
          kind: 'Ingress',
          ingressDetails: expect.objectContaining({ tls: [{ secretName: 'tls' }] }),
        },
        expectUtilization: null,
        expectContainers: false,
      },
      {
        name: 'NetworkPolicy overview relays spec',
        objectData: { kind: 'NetworkPolicy', name: 'np', namespace: 'net', age: '6h' },
        extraProps: {
          networkPolicyDetails: {
            name: 'np',
            age: '6h',
            namespace: 'net',
            policyTypes: ['Ingress'],
            podSelector: {},
          } as any,
        },
        expectedOverview: {
          kind: 'NetworkPolicy',
          networkPolicyDetails: expect.objectContaining({ policyTypes: ['Ingress'] }),
        },
        expectUtilization: null,
        expectContainers: false,
      },
      {
        name: 'EndpointSlice overview surfaces slices',
        objectData: { kind: 'EndpointSlice', name: 'eps', namespace: 'net', age: '7h' },
        extraProps: {
          endpointSliceDetails: {
            name: 'eps',
            age: '7h',
            namespace: 'net',
            slices: [],
          } as any,
        },
        expectedOverview: {
          kind: 'EndpointSlice',
          endpointSliceDetails: expect.objectContaining({ slices: [] }),
        },
        expectUtilization: null,
        expectContainers: false,
      },
      {
        name: 'ServiceAccount overview includes bindings',
        objectData: {
          kind: 'ServiceAccount',
          name: 'builder',
          namespace: 'ci',
          age: '8h',
        },
        extraProps: {
          serviceAccountDetails: {
            name: 'builder',
            age: '8h',
            namespace: 'ci',
            secrets: [{ name: 'token' }],
            imagePullSecrets: [],
            automountServiceAccountToken: true,
            usedByPods: ['pod-a'],
            roleBindings: ['rb'],
            clusterRoleBindings: ['crb'],
          } as any,
        },
        expectedOverview: {
          kind: 'ServiceAccount',
          secrets: [{ name: 'token' }],
        },
        expectUtilization: null,
      },
      {
        name: 'Role overview exposes rules',
        objectData: { kind: 'Role', name: 'role', namespace: 'ci', age: '9h' },
        extraProps: {
          roleDetails: {
            name: 'role',
            age: '9h',
            namespace: 'ci',
            rules: [{ apiGroups: [''], resources: ['pods'], verbs: ['list'] }],
            usedByRoleBindings: ['rb'],
          } as any,
        },
        expectedOverview: {
          kind: 'Role',
          policyRules: [{ apiGroups: [''], resources: ['pods'], verbs: ['list'] }],
        },
        expectUtilization: null,
      },
      {
        name: 'RoleBinding overview relays subjects',
        objectData: { kind: 'RoleBinding', name: 'rb', namespace: 'ci', age: '10h' },
        extraProps: {
          roleBindingDetails: {
            name: 'rb',
            age: '10h',
            namespace: 'ci',
            roleRef: { name: 'role', kind: 'Role' },
            subjects: [{ name: 'user', kind: 'User' }],
          } as any,
        },
        expectedOverview: {
          kind: 'RoleBinding',
          roleRef: expect.objectContaining({ name: 'role' }),
        },
        expectUtilization: null,
      },
      {
        name: 'ClusterRole overview includes aggregation rule',
        objectData: { kind: 'ClusterRole', name: 'cr', namespace: '', age: '11h' },
        extraProps: {
          clusterRoleDetails: {
            name: 'cr',
            age: '11h',
            rules: [],
            aggregationRule: { clusterRoleSelectors: [] },
            clusterRoleBindings: ['crb'],
          } as any,
        },
        expectedOverview: {
          kind: 'ClusterRole',
          aggregationRule: expect.any(Object),
        },
        expectUtilization: null,
      },
      {
        name: 'ClusterRoleBinding overview relays subjects',
        objectData: {
          kind: 'ClusterRoleBinding',
          name: 'crb',
          namespace: '',
          age: '12h',
        },
        extraProps: {
          clusterRoleBindingDetails: {
            name: 'crb',
            age: '12h',
            roleRef: { name: 'cr', kind: 'ClusterRole' },
            subjects: [{ name: 'group', kind: 'Group' }],
          } as any,
        },
        expectedOverview: {
          kind: 'ClusterRoleBinding',
          roleRef: expect.objectContaining({ name: 'cr' }),
        },
        expectUtilization: null,
      },
      {
        name: 'HorizontalPodAutoscaler overview captures targets',
        objectData: {
          kind: 'HorizontalPodAutoscaler',
          name: 'hpa',
          namespace: 'autoscale',
          age: '13h',
        },
        extraProps: {
          hpaDetails: {
            name: 'hpa',
            age: '13h',
            namespace: 'autoscale',
            scaleTargetRef: { kind: 'Deployment', name: 'web' },
            minReplicas: 1,
            maxReplicas: 5,
            currentReplicas: 2,
            desiredReplicas: 4,
            metrics: [],
            currentMetrics: [],
            behavior: {},
          } as any,
        },
        expectedOverview: {
          kind: 'HorizontalPodAutoscaler',
          scaleTargetRef: expect.objectContaining({ name: 'web' }),
        },
        expectUtilization: null,
      },
      {
        name: 'PodDisruptionBudget overview exposes expectations',
        objectData: {
          kind: 'PodDisruptionBudget',
          name: 'pdb',
          namespace: 'autoscale',
          age: '14h',
        },
        extraProps: {
          pdbDetails: {
            name: 'pdb',
            age: '14h',
            namespace: 'autoscale',
            minAvailable: '1',
            maxUnavailable: '25%',
            currentHealthy: 2,
            desiredHealthy: 3,
            disruptionsAllowed: 1,
            expectedPods: 3,
            selector: {},
          } as any,
        },
        expectedOverview: {
          kind: 'PodDisruptionBudget',
          disruptionsAllowed: 1,
        },
        expectUtilization: null,
      },
      {
        name: 'ResourceQuota overview surfaces usage',
        objectData: {
          kind: 'ResourceQuota',
          name: 'rq',
          namespace: 'quota',
          age: '15h',
        },
        extraProps: {
          resourceQuotaDetails: {
            name: 'rq',
            age: '15h',
            namespace: 'quota',
            hard: { cpu: '4' },
            used: { cpu: '2' },
            scopes: ['NotTerminating'],
            scopeSelector: {},
          } as any,
        },
        expectedOverview: {
          kind: 'ResourceQuota',
          hard: expect.objectContaining({ cpu: '4' }),
        },
        expectUtilization: null,
      },
      {
        name: 'LimitRange overview returns limits',
        objectData: {
          kind: 'LimitRange',
          name: 'lr',
          namespace: 'quota',
          age: '16h',
        },
        extraProps: {
          limitRangeDetails: {
            name: 'lr',
            age: '16h',
            namespace: 'quota',
            limits: [{ type: 'Container' }],
          } as any,
        },
        expectedOverview: {
          kind: 'LimitRange',
          limits: [{ type: 'Container' }],
        },
        expectUtilization: null,
      },
      {
        name: 'Namespace overview references workload status',
        objectData: {
          kind: 'Namespace',
          name: 'workloads',
          namespace: '',
          age: '17h',
        },
        extraProps: {
          namespaceDetails: {
            name: 'workloads',
            age: '17h',
            status: 'Active',
            hasWorkloads: true,
            workloadsUnknown: false,
            labels: { env: 'prod' },
            annotations: { owner: 'team' },
          } as any,
        },
        expectedOverview: {
          kind: 'Namespace',
          hasWorkloads: true,
        },
        expectUtilization: null,
      },
      {
        name: 'IngressClass overview exposes controller',
        objectData: {
          kind: 'IngressClass',
          name: 'nginx',
          namespace: '',
          age: '18h',
        },
        extraProps: {
          ingressClassDetails: {
            name: 'nginx',
            age: '18h',
            controller: 'k8s.io/ingress-nginx',
            isDefault: true,
            parameters: {},
          } as any,
        },
        expectedOverview: {
          kind: 'IngressClass',
          controller: 'k8s.io/ingress-nginx',
        },
        expectUtilization: null,
      },
      {
        name: 'CustomResourceDefinition overview surfaces versions',
        objectData: {
          kind: 'CustomResourceDefinition',
          name: 'widgets.acme.com',
          namespace: '',
          age: '19h',
        },
        extraProps: {
          crdDetails: {
            name: 'widgets.acme.com',
            age: '19h',
            group: 'acme.com',
            versions: [{ name: 'v1' }],
            scope: 'Namespaced',
            names: { plural: 'widgets' },
            conditions: [],
          } as any,
        },
        expectedOverview: {
          kind: 'CustomResourceDefinition',
          versions: [{ name: 'v1' }],
        },
        expectUtilization: null,
      },
      {
        name: 'MutatingWebhookConfiguration overview relays webhooks',
        objectData: {
          kind: 'MutatingWebhookConfiguration',
          name: 'mutate',
          namespace: '',
          age: '20h',
        },
        extraProps: {
          mutatingWebhookDetails: {
            name: 'mutate',
            age: '20h',
            webhooks: [{ name: 'default' }],
          } as any,
        },
        expectedOverview: {
          kind: 'MutatingWebhookConfiguration',
          webhooks: [{ name: 'default' }],
        },
        expectUtilization: null,
      },
      {
        name: 'ValidatingWebhookConfiguration overview relays webhooks',
        objectData: {
          kind: 'ValidatingWebhookConfiguration',
          name: 'validate',
          namespace: '',
          age: '21h',
        },
        extraProps: {
          validatingWebhookDetails: {
            name: 'validate',
            age: '21h',
            webhooks: [{ name: 'default' }],
          } as any,
        },
        expectedOverview: {
          kind: 'ValidatingWebhookConfiguration',
          webhooks: [{ name: 'default' }],
        },
        expectUtilization: null,
      },
      {
        name: 'Job overview captures duration',
        objectData: { kind: 'Job', name: 'job', namespace: 'batch', age: '22h' },
        extraProps: {
          jobDetails: {
            name: 'job',
            age: '22h',
            namespace: 'batch',
            completions: 1,
            parallelism: 1,
            backoffLimit: 3,
            succeeded: 1,
            failed: 0,
            active: 0,
            startTime: 'now',
            completionTime: 'later',
            duration: '1m',
          } as any,
        },
        expectedOverview: {
          kind: 'Job',
          duration: '1m',
        },
        expectUtilization: null,
        expectContainers: false,
      },
      {
        name: 'CronJob overview lists schedule',
        objectData: { kind: 'CronJob', name: 'cron', namespace: 'batch', age: '23h' },
        extraProps: {
          cronJobDetails: {
            name: 'cron',
            age: '23h',
            namespace: 'batch',
            schedule: '* * * * *',
            suspend: false,
            activeJobs: 1,
            lastScheduleTime: 'yesterday',
            successfulJobsHistory: 3,
            failedJobsHistory: 1,
          } as any,
        },
        expectedOverview: {
          kind: 'CronJob',
          schedule: '* * * * *',
        },
        expectUtilization: null,
        expectContainers: false,
      },
      {
        name: 'PersistentVolumeClaim overview shows mount info',
        objectData: {
          kind: 'PersistentVolumeClaim',
          name: 'pvc',
          namespace: 'storage',
          age: '24h',
        },
        extraProps: {
          pvcDetails: {
            name: 'pvc',
            age: '24h',
            namespace: 'storage',
            status: 'Bound',
            volumeName: 'pv',
            capacity: '10Gi',
            accessModes: ['ReadWriteOnce'],
            storageClass: 'sc',
            volumeMode: 'Filesystem',
            mountedBy: ['pod'],
          } as any,
        },
        expectedOverview: {
          kind: 'PersistentVolumeClaim',
          status: 'Bound',
        },
        expectUtilization: null,
      },
      {
        name: 'PersistentVolume overview lists claim reference',
        objectData: {
          kind: 'PersistentVolume',
          name: 'pv',
          namespace: '',
          age: '25h',
        },
        extraProps: {
          pvDetails: {
            name: 'pv',
            age: '25h',
            capacity: '10Gi',
            accessModes: ['ReadWriteOnce'],
            reclaimPolicy: 'Delete',
            status: 'Bound',
            claimRef: { namespace: 'storage', name: 'pvc' },
            storageClass: 'standard',
            volumeMode: 'Filesystem',
          } as any,
        },
        expectedOverview: {
          kind: 'PersistentVolume',
          claimRef: expect.objectContaining({ name: 'pvc' }),
        },
        expectUtilization: null,
      },
      {
        name: 'StorageClass overview includes provisioner',
        objectData: {
          kind: 'StorageClass',
          name: 'standard',
          namespace: '',
          age: '26h',
        },
        extraProps: {
          storageClassDetails: {
            name: 'standard',
            age: '26h',
            provisioner: 'kubernetes.io/aws-ebs',
            reclaimPolicy: 'Delete',
            volumeBindingMode: 'WaitForFirstConsumer',
            allowVolumeExpansion: true,
            isDefault: true,
            parameters: {},
          } as any,
        },
        expectedOverview: {
          kind: 'StorageClass',
          provisioner: 'kubernetes.io/aws-ebs',
        },
        expectUtilization: null,
      },
      {
        name: 'HelmRelease overview exposes revision',
        objectData: {
          kind: 'HelmRelease',
          name: 'helm',
          namespace: 'apps',
          age: '27h',
        },
        extraProps: {
          helmReleaseDetails: {
            name: 'helm',
            age: '27h',
            namespace: 'apps',
            chart: 'chart',
            appVersion: '1.0.0',
            status: 'deployed',
            revision: 3,
            updated: 'now',
          } as any,
        },
        expectedOverview: {
          kind: 'HelmRelease',
          revision: 3,
        },
        expectUtilization: null,
      },
      {
        name: 'Secret overview marks as secret data',
        objectData: {
          kind: 'Secret',
          name: 'secret',
          namespace: 'config',
          age: '28h',
        },
        extraProps: {
          secretDetails: {
            name: 'secret',
            age: '28h',
            namespace: 'config',
            data: { token: 'abc' },
          } as any,
        },
        expectedOverview: {
          kind: 'Secret',
          secretDetails: expect.objectContaining({ name: 'secret' }),
        },
        expectUtilization: null,
        expectData: { isSecret: true },
      },
      {
        name: 'Unknown kind falls back to object metadata',
        objectData: {
          kind: 'Widget',
          name: 'gizmo',
          namespace: 'weird',
          age: '29h',
          status: 'Ready',
          apiGroup: 'acme.com',
        },
        extraProps: {},
        expectedOverview: {
          kind: 'Widget',
          apiGroup: 'acme.com',
        },
        expectUtilization: null,
      },
    ];

    it.each(scenarios)('%s', async (scenario) => {
      const { cleanup } = await renderDetailsTab(buildScenarioProps(scenario));

      expect(overviewMock).toHaveBeenCalledWith(expect.objectContaining(scenario.expectedOverview));

      if (scenario.expectUtilization === null) {
        expect(utilizationMock).not.toHaveBeenCalled();
      } else if (scenario.expectUtilization) {
        expect(utilizationMock).toHaveBeenCalledWith(
          expect.objectContaining(scenario.expectUtilization)
        );
      }

      if (scenario.expectContainers === true) {
        expect(containersMock).toHaveBeenCalled();
      } else if (scenario.expectContainers === false) {
        expect(containersMock).not.toHaveBeenCalled();
      }

      if (scenario.expectData === null) {
        expect(dataMock).not.toHaveBeenCalled();
      } else if (scenario.expectData) {
        expect(dataMock).toHaveBeenCalledWith(expect.objectContaining(scenario.expectData));
      }

      cleanup();
    });
  });

  it('skips utilization when metrics are missing', async () => {
    const props = createBaseProps({
      objectData: { kind: 'Pod', name: 'pod', namespace: 'default' },
      podDetails: {
        name: 'pod',
        age: '1h',
        namespace: 'default',
      } as any,
    });

    const { cleanup } = await renderDetailsTab(props);
    expect(utilizationMock).not.toHaveBeenCalled();
    cleanup();
  });

  it('falls back to object metrics when detail data is unavailable', async () => {
    const props = createBaseProps({
      objectData: {
        kind: 'Deployment',
        name: 'web',
        namespace: 'apps',
        cpuUsage: '250m',
        cpuRequest: '100m',
        cpuLimit: '400m',
        memUsage: '512Mi',
        memRequest: '256Mi',
        memLimit: '1Gi',
      },
    });

    const { cleanup } = await renderDetailsTab(props);

    expect(utilizationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cpu: expect.objectContaining({ usage: '250m', limit: '400m' }),
        memory: expect.objectContaining({ usage: '512Mi', limit: '1Gi' }),
      })
    );

    cleanup();
  });

  it('omits containers section when workloads have no containers', async () => {
    const props = createBaseProps({
      objectData: { kind: 'Deployment', name: 'empty', namespace: 'apps' },
      deploymentDetails: {
        name: 'empty',
        age: '1h',
        namespace: 'apps',
        replicas: 1,
        desiredReplicas: 1,
        ready: 1,
        upToDate: 1,
        available: 1,
        containers: [],
      } as any,
    });

    const { cleanup } = await renderDetailsTab(props);

    expect(containersMock).not.toHaveBeenCalled();
    cleanup();
  });
});
