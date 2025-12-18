import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ObjectPanelContent } from '@modules/object-panel/components/ObjectPanel/ObjectPanelContent';
import type { DetailsTabProps } from '@modules/object-panel/components/ObjectPanel/Details/DetailsTab';

const hoistedRefs = vi.hoisted(() => ({
  detailsTabProps: { current: null as DetailsTabProps | null },
  logViewerProps: { current: null as any },
  eventsTabProps: { current: null as any },
  yamlTabProps: { current: null as any },
  manifestTabProps: { current: null as any },
  valuesTabProps: { current: null as any },
  shellTabProps: { current: null as any },
  maintenanceTabProps: { current: null as any },
  podsTabProps: { current: null as any },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Details/DetailsTab', () => ({
  default: (props: DetailsTabProps) => {
    hoistedRefs.detailsTabProps.current = props;
    return <div data-testid="details-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Logs/LogViewer', () => ({
  default: (props: unknown) => {
    hoistedRefs.logViewerProps.current = props;
    return <div data-testid="logs-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Events/EventsTab', () => ({
  default: (props: unknown) => {
    hoistedRefs.eventsTabProps.current = props;
    return <div data-testid="events-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Yaml/YamlTab', () => ({
  default: (props: unknown) => {
    hoistedRefs.yamlTabProps.current = props;
    return <div data-testid="yaml-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Helm/ManifestTab', () => ({
  default: (props: unknown) => {
    hoistedRefs.manifestTabProps.current = props;
    return <div data-testid="manifest-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Helm/ValuesTab', () => ({
  default: (props: unknown) => {
    hoistedRefs.valuesTabProps.current = props;
    return <div data-testid="values-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Shell/ShellTab', () => ({
  default: (props: unknown) => {
    hoistedRefs.shellTabProps.current = props;
    return <div data-testid="shell-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Maintenance/NodeMaintenanceTab', () => ({
  NodeMaintenanceTab: (props: unknown) => {
    hoistedRefs.maintenanceTabProps.current = props;
    return <div data-testid="maintenance-tab" />;
  },
}));

vi.mock('@modules/object-panel/components/ObjectPanel/Pods/PodsTab', () => ({
  PodsTab: (props: unknown) => {
    hoistedRefs.podsTabProps.current = props;
    return <div data-testid="pods-tab" />;
  },
}));

describe('ObjectPanelContent', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const baseProps: React.ComponentProps<typeof ObjectPanelContent> = {
    activeTab: 'details',
    detailTabProps: {
      objectData: { kind: 'Deployment', name: 'api', namespace: 'team-a' },
      isActive: true,
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
      scaleReplicas: 1,
      showScaleInput: false,
      onRestartClick: vi.fn(),
      onDeleteClick: vi.fn(),
      onScaleClick: vi.fn(),
      onScaleCancel: vi.fn(),
      onScaleReplicasChange: vi.fn(),
      onShowScaleInput: vi.fn(),
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
    },
    isPanelOpen: true,
    capabilities: {
      hasLogs: true,
      hasShell: false,
      hasManifest: true,
      hasValues: true,
      canDelete: true,
      canRestart: true,
      canScale: true,
      canEditYaml: true,
    },
    capabilityReasons: {},
    detailScope: 'team-a:deployment:api',
    helmScope: 'team-a:api',
    objectData: { kind: 'Deployment', name: 'api', namespace: 'team-a' },
    objectKind: 'deployment',
    resourceDeleted: false,
    deletedResourceName: '',
    onRefreshDetails: vi.fn(),
    podsState: {
      pods: [],
      metrics: null,
      loading: false,
      error: null,
      scope: null,
    },
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    Object.values(hoistedRefs).forEach((ref) => {
      ref.current = null;
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderContent = (props?: Partial<React.ComponentProps<typeof ObjectPanelContent>>) => {
    act(() => {
      root.render(<ObjectPanelContent {...baseProps} {...props} />);
    });
  };

  it('renders details tab content when active', () => {
    renderContent();
    expect(hoistedRefs.detailsTabProps.current).toMatchObject(baseProps.detailTabProps!);
  });

  it('renders logs viewer when logs tab is active and capability present', () => {
    renderContent({ activeTab: 'logs' });
    expect(hoistedRefs.logViewerProps.current).toMatchObject({
      namespace: 'team-a',
      resourceName: 'api',
      resourceKind: 'deployment',
      isActive: true,
    });
  });

  it('does not render logs viewer when capability is missing', () => {
    renderContent({
      activeTab: 'logs',
      capabilities: { ...baseProps.capabilities, hasLogs: false },
    });
    expect(hoistedRefs.logViewerProps.current).toBeNull();
  });

  it('renders shell tab when active and capability present', () => {
    renderContent({
      activeTab: 'shell',
      capabilities: { ...baseProps.capabilities, hasShell: true },
      capabilityReasons: { shell: 'reason' },
    });
    expect(hoistedRefs.shellTabProps.current).toMatchObject({
      namespace: 'team-a',
      resourceName: 'api',
      isActive: true,
      disabledReason: 'reason',
      availableContainers: [],
    });
  });

  it('does not render shell tab when capability is missing', () => {
    renderContent({
      activeTab: 'shell',
      capabilities: { ...baseProps.capabilities, hasShell: false },
    });
    expect(hoistedRefs.shellTabProps.current).toBeNull();
  });

  it('passes capability information to YAML tab', () => {
    renderContent({
      activeTab: 'yaml',
      capabilityReasons: { editYaml: 'forbidden' },
      capabilities: { ...baseProps.capabilities, canEditYaml: false },
    });
    expect(hoistedRefs.yamlTabProps.current).toMatchObject({
      scope: baseProps.detailScope,
      canEdit: false,
      editDisabledReason: 'forbidden',
    });
  });

  it('renders helm manifest and values tabs with scope', () => {
    renderContent({ activeTab: 'manifest' });
    expect(hoistedRefs.manifestTabProps.current).toMatchObject({
      scope: baseProps.helmScope,
      isActive: true,
    });

    renderContent({ activeTab: 'values' });
    expect(hoistedRefs.valuesTabProps.current).toMatchObject({
      scope: baseProps.helmScope,
      isActive: true,
    });
  });

  it('renders maintenance tab when active for node objects', () => {
    renderContent({
      activeTab: 'maintenance',
      objectKind: 'node',
      objectData: { kind: 'Node', name: 'node-1' },
      detailTabProps: {
        ...baseProps.detailTabProps!,
        objectData: { kind: 'Node', name: 'node-1' },
        nodeDetails: {
          name: 'node-1',
          unschedulable: false,
        } as any,
      },
    });
    expect(hoistedRefs.maintenanceTabProps.current).toMatchObject({
      objectName: 'node-1',
      isActive: true,
    });
  });

  it('renders pods tab when active', () => {
    renderContent({ activeTab: 'pods' });
    expect(hoistedRefs.podsTabProps.current).toMatchObject({
      pods: [],
      loading: false,
      isActive: true,
    });
  });
});
