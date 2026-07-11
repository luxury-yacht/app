/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTab.test.tsx
 *
 * DetailsTab composes the Overview (descriptor-driven, rendered by Overview/index) with the sibling
 * sections (Utilization, Containers, RBACRules, DataSection), each gated by the derived
 * ObjectDetailModel. Per-kind FIELD rendering is covered by the descriptor tests + driftCheck; this
 * suite covers the composition contract: what DetailsTab passes to Overview and which sibling
 * sections appear.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetailsTabProps } from './DetailsTab';
import { buildObjectDetailModel } from './objectDetailModel';

const useShortcutMock = vi.fn();
const overviewMock = vi.fn();
const utilizationMock = vi.fn();
const containersMock = vi.fn();
const rbacRulesMock = vi.fn();
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

vi.mock('./DetailsTabRBACRules', () => ({
  __esModule: true,
  default: (props: unknown) => {
    rbacRulesMock(props);
    return <div data-testid="mock-rbac-rules" />;
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

type TestObjectData = Pick<NonNullable<DetailsTabProps['objectData']>, 'kind' | 'name'> &
  Partial<NonNullable<DetailsTabProps['objectData']>>;

const createBaseProps = (
  objectData: TestObjectData,
  detail: Parameters<typeof buildObjectDetailModel>[2] = null
): DetailsTabProps => {
  const completeObjectData: NonNullable<DetailsTabProps['objectData']> = {
    clusterId: 'test-cluster',
    group: '',
    version: 'v1',
    ...objectData,
  };
  return {
    objectData: completeObjectData,
    detailModel: buildObjectDetailModel(
      completeObjectData,
      completeObjectData.kind.toLowerCase(),
      detail ?? null
    ),
    isActive: true,
    detailsLoading: false,
    detailsError: null,
    resourceDeleted: false,
    deletedResourceName: '',
    onAfterDelete: vi.fn(),
    onAfterAction: vi.fn(),
  };
};

const overviewProps = () => overviewMock.mock.calls[0]?.[0] as Record<string, unknown>;

describe('DetailsTab', () => {
  beforeEach(() => {
    overviewMock.mockClear();
    utilizationMock.mockClear();
    containersMock.mockClear();
    rbacRulesMock.mockClear();
    dataMock.mockClear();
    useShortcutMock.mockClear();
  });

  it('passes object identity, the active detail, and lifecycle callbacks to Overview', async () => {
    const detail = {
      status: 'Running',
      ready: '1/1',
      containers: [{ name: 'app', image: 'example/app:1.0.0' }],
      cpuUsage: '100m',
      memUsage: '128Mi',
    };
    const props = createBaseProps({ kind: 'Pod', name: 'pod-1', namespace: 'default' }, detail);

    const { cleanup } = await renderDetailsTab(props);

    // Overview owns the action controller (via ActionsMenu); DetailsTab forwards
    // the raw detail + identity + the panel lifecycle callbacks only.
    expect(overviewProps()).toMatchObject({
      kind: 'Pod',
      name: 'pod-1',
      namespace: 'default',
      activeDetail: detail,
      status: 'Running',
      ready: '1/1',
      onAfterDelete: props.onAfterDelete,
      onAfterAction: props.onAfterAction,
    });
    cleanup();
  });

  it('renders the Containers section for pods/workloads and the Utilization section with metrics', async () => {
    const props = createBaseProps(
      { kind: 'Pod', name: 'pod-1', namespace: 'default' },
      {
        containers: [{ name: 'app', image: 'example/app:1.0.0' }],
        initContainers: [{ name: 'init', image: 'busybox' }],
        cpuUsage: '100m',
        cpuRequest: '50m',
        memUsage: '128Mi',
        memRequest: '64Mi',
      }
    );

    const { cleanup } = await renderDetailsTab(props);
    expect(containersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        containers: expect.arrayContaining([{ name: 'app', image: 'example/app:1.0.0' }]),
      })
    );
    expect(utilizationMock).toHaveBeenCalled();
    expect(dataMock).not.toHaveBeenCalled();
    cleanup();
  });

  it('hides utilization for inactive replicasets', async () => {
    const props = createBaseProps(
      { kind: 'ReplicaSet', name: 'web-rs', namespace: 'default' },
      { replicas: '1/2', cpuUsage: '100m', memUsage: '128Mi', isActive: false }
    );
    const { cleanup } = await renderDetailsTab(props);
    expect(utilizationMock).not.toHaveBeenCalled();
    cleanup();
  });

  it('passes port-forward availability false for pods with no forwardable ports', async () => {
    const props = createBaseProps(
      { kind: 'Pod', name: 'pod-1', namespace: 'default' },
      { containers: [{ name: 'app', image: 'i', ports: ['53/UDP'] }] }
    );
    const { cleanup } = await renderDetailsTab(props);
    expect(overviewProps()).toMatchObject({ portForwardAvailable: false });
    cleanup();
  });

  it('passes port-forward availability false for services with no TCP ports', async () => {
    const props = createBaseProps(
      { kind: 'Service', name: 'svc-1', namespace: 'default' },
      { ports: [{ name: 'dns', port: 53, protocol: 'UDP' }] }
    );
    const { cleanup } = await renderDetailsTab(props);
    expect(overviewProps()).toMatchObject({ portForwardAvailable: false });
    cleanup();
  });

  it('renders the data section for config maps and marks secrets', async () => {
    const cfg = await renderDetailsTab(
      createBaseProps(
        { kind: 'ConfigMap', name: 'cfg', namespace: 'default' },
        { data: { key: 'value' }, binaryData: {} }
      )
    );
    expect(dataMock).toHaveBeenCalledWith(expect.objectContaining({ isSecret: false }));
    cfg.cleanup();

    dataMock.mockClear();
    const sec = await renderDetailsTab(
      createBaseProps({ kind: 'Secret', name: 's', namespace: 'default' }, { data: { t: 'x' } })
    );
    expect(dataMock).toHaveBeenCalledWith(expect.objectContaining({ isSecret: true }));
    sec.cleanup();
  });

  it('uses node utilization metrics and omits containers when not applicable', async () => {
    const props = createBaseProps(
      { kind: 'Node', name: 'node-a', namespace: '' },
      {
        cpuUsage: '2',
        cpuCapacity: '4',
        memoryUsage: '8Gi',
        memoryCapacity: '16Gi',
        podsCount: 50,
        podsCapacity: '110',
      }
    );
    const { cleanup } = await renderDetailsTab(props);
    expect(utilizationMock.mock.calls[0][0]).toMatchObject({ mode: 'nodeMetrics' });
    expect(containersMock).not.toHaveBeenCalled();
    cleanup();
  });

  it('renders the RBAC rules section for roles', async () => {
    const props = createBaseProps(
      { kind: 'Role', name: 'role', namespace: 'ci' },
      { rules: [{ apiGroups: [''], resources: ['pods'], verbs: ['list'] }] }
    );
    const { cleanup } = await renderDetailsTab(props);
    expect(rbacRulesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        policyRules: [{ apiGroups: [''], resources: ['pods'], verbs: ['list'] }],
      })
    );
    cleanup();
  });

  it('omits the Containers section for Jobs (even though Job details carry containers)', async () => {
    const props = createBaseProps(
      { kind: 'Job', name: 'job', namespace: 'batch' },
      { containers: [{ name: 'app', image: 'i' }], duration: '1m' }
    );
    const { cleanup } = await renderDetailsTab(props);
    expect(containersMock).not.toHaveBeenCalled();
    cleanup();
  });

  it('passes derived scale/suspend signals for scalable workloads and cronjobs', async () => {
    const deploy = await renderDetailsTab(
      createBaseProps(
        { kind: 'Deployment', name: 'web', namespace: 'apps' },
        { desiredReplicas: 4 }
      )
    );
    expect(overviewProps()).toMatchObject({ desiredReplicas: 4 });
    deploy.cleanup();

    overviewMock.mockClear();
    const cron = await renderDetailsTab(
      createBaseProps({ kind: 'CronJob', name: 'c', namespace: 'batch' }, { suspend: true })
    );
    expect(overviewProps()).toMatchObject({ suspend: true });
    cron.cleanup();
  });

  it('still renders the Overview (with null detail) for custom/unknown kinds', async () => {
    const props = createBaseProps({ kind: 'Widget', name: 'gizmo', namespace: 'weird' }, null);
    const { cleanup } = await renderDetailsTab(props);
    expect(overviewProps()).toMatchObject({ kind: 'Widget', name: 'gizmo', activeDetail: null });
    expect(utilizationMock).not.toHaveBeenCalled();
    expect(containersMock).not.toHaveBeenCalled();
    cleanup();
  });

  it('shows loading overlay, deletion warning, and detail error messages', async () => {
    const props: DetailsTabProps = {
      ...createBaseProps({ kind: 'Pod', name: 'pod-1', namespace: 'default' }),
      detailsLoading: true,
      resourceDeleted: true,
      deletedResourceName: 'pod-1',
      detailsError: 'fetch failed',
    };
    const { container, cleanup } = await renderDetailsTab(props);
    expect(container.textContent).toContain('Loading pod details...');
    expect(container.textContent).toContain(
      'pod-1 no longer exists. Please select another resource.'
    );
    expect(container.textContent).toContain('Error loading details: fetch failed');
    cleanup();
  });
});
