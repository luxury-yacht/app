/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelContent.test.tsx
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ObjectPanelContent } from '@modules/object-panel/components/ObjectPanel/ObjectPanelContent';
import type { DetailsTabProps } from '@modules/object-panel/components/ObjectPanel/Details/DetailsTab';
import { buildObjectDetailModel } from '@modules/object-panel/components/ObjectPanel/Details/objectDetailModel';

const hoistedRefs = vi.hoisted(() => ({
  detailsTabProps: { current: null as DetailsTabProps | null },
  logViewerProps: { current: null as any },
  eventsTabProps: { current: null as any },
  yamlTabProps: { current: null as any },
  manifestTabProps: { current: null as any },
  valuesTabProps: { current: null as any },
  shellTabProps: { current: null as any },
  nodeLogsTabProps: { current: null as any },
  podsTabProps: { current: null as any },
  setScopedDomainEnabled: vi.fn(),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: {
    setScopedDomainEnabled: (...args: unknown[]) => hoistedRefs.setScopedDomainEnabled(...args),
  },
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

vi.mock('@modules/object-panel/components/ObjectPanel/NodeLogs/NodeLogsTab', () => ({
  default: (props: unknown) => {
    hoistedRefs.nodeLogsTabProps.current = props;
    return <div data-testid="node-logs-tab" />;
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
  const objectData = { kind: 'Deployment', name: 'api', namespace: 'team-a' };

  const baseProps: React.ComponentProps<typeof ObjectPanelContent> = {
    activeTab: 'details',
    detailTabProps: {
      objectData,
      detailModel: buildObjectDetailModel(objectData, 'deployment', null),
      isActive: true,
      detailsLoading: false,
      detailsError: null,
      resourceDeleted: false,
      deletedResourceName: '',
      onAfterDelete: vi.fn(),
      onAfterAction: vi.fn(),
    },
    isPanelOpen: true,
    capabilities: {
      hasObjPanelLogs: true,
      hasNodeLogs: false,
      hasShell: false,
      hasManifest: true,
      hasValues: true,
      canDelete: true,
      canRestart: true,
      canScale: true,
      canEditYaml: true,
      canTrigger: false,
      canSuspend: false,
    },
    capabilityReasons: {},
    nodeLogsState: { allowed: false, pending: false, reason: undefined },
    nodeLogSources: [],
    detailScope: 'team-a:deployment:api',
    eventsScope: 'team-a:Deployment:api',
    containerLogsScope: 'team-a:deployment:api',
    mapScope: 'team-a:Deployment:api',
    helmScope: 'team-a:api',
    objectData: { kind: 'Deployment', name: 'api', namespace: 'team-a' },
    objectKind: 'deployment',
    resourceDeleted: false,
    deletedResourceName: '',
    onClosePanel: vi.fn(),
    onRefreshDetails: vi.fn(),
    panelId: 'obj:test:deployment:team-a:api',
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    Object.values(hoistedRefs).forEach((ref) => {
      if ('current' in ref) {
        ref.current = null;
      }
    });
    hoistedRefs.setScopedDomainEnabled.mockClear();
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

  it('renders node logs tab when logs tab is active for a node', () => {
    renderContent({
      activeTab: 'logs',
      capabilities: { ...baseProps.capabilities, hasObjPanelLogs: true, hasNodeLogs: false },
      objectData: { kind: 'Node', name: 'node-1', clusterId: 'alpha:ctx' },
      objectKind: 'node',
      nodeLogsState: { allowed: false, pending: true, reason: undefined },
      nodeLogSources: [
        {
          id: 'journal/kubelet',
          label: 'journal / kubelet',
          kind: 'journal',
          path: 'journal/kubelet',
        },
      ],
    });

    expect(hoistedRefs.nodeLogsTabProps.current).toMatchObject({
      nodeName: 'node-1',
      clusterId: 'alpha:ctx',
      isActive: true,
      availability: { pending: true },
      sources: [{ path: 'journal/kubelet' }],
    });
  });

  it('does not render logs viewer when capability is missing', () => {
    renderContent({
      activeTab: 'logs',
      capabilities: { ...baseProps.capabilities, hasObjPanelLogs: false },
    });
    expect(hoistedRefs.logViewerProps.current).toBeNull();
  });

  it('renders shell tab when active and capability present', () => {
    renderContent({
      activeTab: 'shell',
      capabilities: { ...baseProps.capabilities, hasShell: true },
      capabilityReasons: { shell: 'reason', debug: 'debug-reason' },
    });
    expect(hoistedRefs.shellTabProps.current).toMatchObject({
      namespace: 'team-a',
      resourceName: 'api',
      isActive: true,
      disabledReason: 'reason',
      debugDisabledReason: 'debug-reason',
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

  it('renders pods tab when active', () => {
    renderContent({ activeTab: 'pods' });
    expect(hoistedRefs.podsTabProps.current).toMatchObject({
      isActive: true,
    });
  });

  it('renders a close button when the object is deleted and closes the tab', () => {
    const onClosePanel = vi.fn();
    renderContent({
      resourceDeleted: true,
      deletedResourceName: 'api',
      onClosePanel,
    });

    const closeButton = container.querySelector('button');
    expect(closeButton?.textContent).toBe('Close');

    act(() => {
      closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClosePanel).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Object not found');
    expect(container.textContent).toContain('api is no longer available.');
  });

  it('disables panel-scoped refresh domains with preserveState and exact scope identity', () => {
    renderContent({
      detailScope: 'cluster-a|default:apps/v1:Deployment:api',
      eventsScope: 'cluster-a|default:apps/v1:Deployment:api|events',
      containerLogsScope: 'cluster-a|default:apps/v1:Deployment:api|logs',
      mapScope: 'cluster-a|default:apps/v1:Deployment:api|map',
      helmScope: 'cluster-a|default:helm:team-a:api',
    });

    hoistedRefs.setScopedDomainEnabled.mockClear();

    renderContent({ isPanelOpen: false });

    expect(hoistedRefs.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-events',
      'cluster-a|default:apps/v1:Deployment:api|events',
      false,
      { preserveState: true }
    );
    expect(hoistedRefs.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-yaml',
      'cluster-a|default:apps/v1:Deployment:api',
      false,
      { preserveState: true }
    );
    expect(hoistedRefs.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-helm-manifest',
      'cluster-a|default:helm:team-a:api',
      false,
      { preserveState: true }
    );
    expect(hoistedRefs.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-helm-values',
      'cluster-a|default:helm:team-a:api',
      false,
      { preserveState: true }
    );
    expect(hoistedRefs.setScopedDomainEnabled).toHaveBeenCalledWith(
      'container-logs',
      'cluster-a|default:apps/v1:Deployment:api|logs',
      false,
      { preserveState: true }
    );
    expect(hoistedRefs.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-map',
      'cluster-a|default:apps/v1:Deployment:api|map',
      false,
      { preserveState: true }
    );
  });
});
