/**
 * frontend/src/test-utils/appState/harness.tsx
 *
 * Mounts the app's real state owners over fakes of only its external boundary
 * (see transport.ts). Every mount runs the production window bootstrap
 * (windowBootstrap.ts) and renders under the production shell:
 * - `render(ui)` renders `ui` inside `AppShell` (provider mode);
 * - `mountApp()` renders the root the native descriptor selects (full-app
 *   mode), required for surfaces under route- or panel-owned providers.
 * Fixtures seed state only through the boundary. Each test mounts and tears
 * down its own app; unexpected error reports fail the test.
 */

import { resolveClusterMeta } from '@modules/kubernetes/config/kubeconfigSelection';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { useObjectPanelState } from '@modules/object-panel/contexts/ObjectPanelStateContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { getObjectPanelScopes, type ObjectPanelScopes } from '@modules/object-panel/objectPanelRef';
import { isIdentityPanelRef, panelTargetFromSnapshot } from '@modules/object-panel/panelTarget';
import { act, type ReactElement, type ReactNode, useEffect, useSyncExternalStore } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';
import { AppShell } from '@/App';
import { backend, panelwindow } from '@/core/backend-api/models';
import { useOptionalViewState } from '@/core/contexts/ViewStateContext';
import { useScopedRefreshDomainLifecycle } from '@/core/data-access';
import type { DataRequestReason } from '@/core/data-access/types';
import { eventBus } from '@/core/events';
import type { PanelWindowDescriptor } from '@/core/panel-windows';
import {
  makeCatalogSnapshotPayload,
  makeClusterAttentionSnapshot,
  makeClusterOverviewSnapshotPayload,
  makeNamespaceWorkloadSnapshotPayload,
  makePodSnapshotPayload,
} from '@/core/refresh/refreshContractTestBuilders';
import type { RefreshDemand } from '@/core/refresh/refreshRuntime';
import {
  buildClusterRefreshScope,
  buildRefreshScope,
  CLUSTER_SELECTOR,
} from '@/core/refresh/scopeSelector';
import type { DomainPayloadMap, NamespaceSummary, RefreshDomain } from '@/core/refresh/types';
import { setAppPreferencesForTesting } from '@/core/settings/appPreferences';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import { PanelWindowShell } from '@/PanelWindowApp';
import type { KubernetesObjectReference } from '@/types/view-state';
import { AppLayout } from '@/ui/layout/AppLayout';
import {
  createWindowPreparation,
  disposeWindowPreparation,
  loadWindowRoot,
  prepareWindow,
  renderWindowRoot,
  type WindowPreparation,
} from '@/windowBootstrap';
import { type ErrorCapture, installErrorCapture } from './errorCapture';
import { resetAppModuleState } from './moduleState';
import {
  type BackendArgs,
  type BackendResult,
  type FakeBackend,
  type FakeRuntimeEvents,
  type FakeSnapshotServer,
  type FakeStreams,
  installTransport,
  type StreamAcknowledgement,
  type Transport,
} from './transport';

type KubeconfigInfo = NonNullable<BackendResult<'GetKubeconfigs'>['kubeconfigs']>[number];
type WorkspaceState = BackendResult<'GetClusterWorkspaceStateForWindow'>;
type WorkspaceClusterState = NonNullable<NonNullable<WorkspaceState['clusters']>[string]>;
type AppSettings = NonNullable<BackendResult<'GetAppSettings'>>;

const DEFAULT_WINDOW_NAME = 'workspace-1';
// Reporting is unavailable in tests; production builds read these from Vite.
const TEST_REPORTING_CONFIG = { enabled: false, dsn: '', environment: 'test', release: '' };

export interface TestCluster {
  /** The kubeconfig selection string (`<path>:<context>`). */
  selection: string;
  /** The cluster id production derives from the selection. */
  clusterId: string;
  clusterName: string;
}

export interface ClusterFixture {
  name: string;
  context: string;
  lifecycle?: backend.ClusterLifecycleState;
  /** The cluster's auth state the backend reports (default: none reported). */
  auth?: Partial<WorkspaceClusterState['auth']>;
  /** The cluster's health the backend reports (default: healthy). */
  health?: backend.ClusterHealthState;
  /** Whether the workspace has this cluster open at startup (default true). */
  open?: boolean;
}

/**
 * A change the backend makes to an open cluster while the window runs. Its
 * credential state is what backend/internal/authstate reports: `valid`
 * (recovered, which clears the diagnostic), `recovering` (retrying), or
 * `invalid` (failed), with the diagnostic the backend attaches.
 */
export interface ClusterStateChange {
  lifecycle?: backend.ClusterLifecycleState;
  auth?: Partial<WorkspaceClusterState['auth']> & { state: 'valid' | 'recovering' | 'invalid' };
  health?:
    | backend.ClusterHealthState.ClusterHealthHealthy
    | backend.ClusterHealthState.ClusterHealthDegraded;
}

/** A refresh lease a test holds the way a mounted view does. */
export interface HarnessLease {
  domain: RefreshDomain;
  scope: string;
  preserveState?: boolean;
  demand?: RefreshDemand;
  /** A tab that reads its scope when it enables it passes a read reason. */
  fetchOnEnable?: DataRequestReason | false;
}

/** Complete object identity; the cluster comes from a `TestCluster`. */
export interface ObjectIdentity {
  group: string;
  version: string;
  kind: string;
  /** Empty for cluster-scoped kinds. */
  namespace: string;
  name: string;
}

export interface TestObject {
  /** What `openWithObject` takes: the object with its cluster. */
  ref: KubernetesObjectReference & ObjectIdentity & { clusterId: string; clusterName: string };
  /** The refresh scopes production derives for the object's panel. */
  scopes: ObjectPanelScopes;
}

export interface PermissionDenial {
  verb: string;
  resourceKind?: string;
  namespace?: string;
  subresource?: string;
  name?: string;
}

export type PermissionQuery = NonNullable<BackendArgs<'QueryPermissions'>[0]>[number];

/**
 * How the cluster answers a permission query. `true`/`false` resolve the way
 * the backend usually does (a namespace's rules, or an access review for a
 * cluster-wide query). `{ reason }` is an access review's answer with the API
 * server's reason, denied unless `allowed: true`: what the backend returns
 * when a namespace's rules are incomplete (EKS access policies, webhook
 * authorizers). `{ error }` is a check the cluster could not evaluate.
 */
export type PermissionDecision =
  | boolean
  | { allowed?: boolean; reason: string }
  /** The cluster could not evaluate the check (an inactive cluster, a failed review). */
  | { error: string };

/** Public hooks of the real owners, read from inside the mounted shell. */
export interface AppOwners {
  kubeconfig: ReturnType<typeof useKubeconfig>;
  /** Null in a panel window, which has no workspace navigation. */
  viewState: ReturnType<typeof useOptionalViewState>;
  namespace: ReturnType<typeof useNamespace>;
  objectPanel: ReturnType<typeof useObjectPanel>;
  objectPanels: ReturnType<typeof useObjectPanelState>;
}

/**
 * An open panel's target as the real panel state holds it. Identity panels
 * (RBAC users and groups) have no group, version, or namespace.
 */
export type OpenPanelTarget =
  | (ObjectIdentity & { clusterId: string; clusterName?: string })
  | { targetType: 'identity'; clusterId: string; kind: string; name: string };

/**
 * A sidebar entry: a cluster view (`'overview'` is the cluster Overview), a
 * namespace's view, or a view across clusters.
 */
export type SidebarTarget =
  | { clusterView: string }
  | { namespace: string; view: string }
  | { globalView: string };

export interface MountedApp {
  container: HTMLElement;
  /** Workspace windows: the object panels the real panel state has open. */
  openPanels(): OpenPanelTarget[];
  /** Workspace windows: the owners' current public hook values. */
  owners(): AppOwners;
  /**
   * Provider mode only: replaces the surface under test after startup, as a
   * user opening it would. Production mounts leasing surfaces only for clusters
   * the workspace has connected (AppLayout routes and panels), so a surface
   * shown before startup would lose its leases to the connection prune.
   */
  show(ui: ReactNode): Promise<void>;
  /** Removes the surface under test synchronously, leaving the shell mounted. */
  clear(): void;
  /**
   * Switches the workspace to an open cluster's tab through the real
   * kubeconfig owner, as clicking the tab would. Throws if it did not switch.
   */
  selectCluster(cluster: TestCluster): Promise<void>;
  /**
   * Full-app mode: clicks the sidebar entry of a view in the visible cluster,
   * as the user would. A namespace view's namespace is expanded first. Throws
   * when the sidebar does not offer the entry.
   */
  goTo(target: SidebarTarget): Promise<void>;
  /**
   * Holds refresh leases the way a mounted view does, after startup (a lease
   * taken before its cluster connects is pruned). Resolves to their release.
   */
  lease(...leases: HarnessLease[]): Promise<() => Promise<void>>;
  unmount(): void;
}

export interface AppStateHarness {
  readonly backend: FakeBackend;
  readonly events: FakeRuntimeEvents;
  readonly streams: FakeStreams;
  readonly snapshots: FakeSnapshotServer;
  readonly errors: ErrorCapture;
  readonly windowName: string;
  /** Names of the windows the app focused, in order. */
  focusedWindows(): string[];
  /** Adds a kubeconfig context; open clusters are part of the startup workspace. */
  cluster(fixture: ClusterFixture): TestCluster;
  /**
   * The backend changes an open cluster's state: later workspace answers
   * report it, and the window receives the events the backend sends for it
   * (backend/events.go).
   */
  setClusterState(cluster: TestCluster, change: ClusterStateChange): Promise<void>;
  /**
   * Makes the next mount a native panel window for `cluster`: bootstrap
   * resolves a panel descriptor, so `render` uses the panel-window shell.
   * `transferId` is the move that opened it (default: none); `tabs` is the
   * group it holds (default: empty).
   */
  panelWindow(
    cluster: TestCluster,
    options?: { name?: string; transferId?: string; tabs?: panelwindow.TabSnapshot[] }
  ): PanelWindowDescriptor;
  /** An object of `cluster`, with the panel scopes production derives for it. */
  object(cluster: TestCluster, identity: ObjectIdentity): TestObject;
  /**
   * Serves the reads an object's panel makes when it opens: its details
   * (backend/object_detail_provider.go; an empty detail of its kind unless
   * `detail` says otherwise), its YAML (a minimal manifest of its identity),
   * its events (none), the pods its Pods tab lists, and a namespaced object's
   * namespace pods and workloads. To fail or hold a read, follow with
   * `snapshots.fail` or `snapshots.respond`.
   */
  servePanel(
    cluster: TestCluster,
    identity: ObjectIdentity,
    detail?: Partial<DomainPayloadMap['object-details']>
  ): TestObject;
  /**
   * Serves what the full app's start screen (the cluster Overview) reads for
   * the cluster: its overview, attention findings, and discovered families.
   */
  startScreen(cluster: TestCluster): void;
  /** Serves the cluster's namespace list (and its empty metrics). */
  namespaces(cluster: TestCluster, names: string[]): void;
  /**
   * Answers every read of a query table domain in `cluster` (any selector,
   * page, sort, or filter) with the typed-resource envelope and `payload`
   * (rows default to none; totals count the rows). Returns a function that
   * stops answering.
   */
  serveTable<D extends keyof DomainPayloadMap>(
    cluster: TestCluster,
    domain: D,
    payload?: Partial<DomainPayloadMap[D]>
  ): () => void;
  /** Persisted preferences the bootstrap hydrates. */
  preferences(settings: Partial<AppSettings>): void;
  /** Permission queries are allowed unless a denial matches. */
  denyPermissions(denials: PermissionDenial[]): void;
  /**
   * Decides every permission query from now on, in place of `denyPermissions`.
   * Results carry the source and reason the backend sets for them.
   */
  permissions(decide: (query: PermissionQuery) => PermissionDecision): void;
  /** Provider mode: renders `ui` inside the production shell. */
  render(ui: ReactNode): Promise<MountedApp>;
  /**
   * Full-app mode: renders the root the native descriptor selects. `probes`
   * render beside the workspace layout, inside the shell, to read owners'
   * hooks the way `owners()` does.
   */
  mountApp(probes?: ReactNode): Promise<MountedApp>;
  /** Settles queued work: microtasks, lazy imports, and zero-delay timers. */
  settle(): Promise<void>;
}

interface Session {
  transport: Transport;
  errors: ErrorCapture;
  kubeconfigs: KubeconfigInfo[];
  clusters: Map<string, WorkspaceClusterState>;
  workspace: { selectedKubeconfigs: string[]; visibleClusterId: string };
  settings: Partial<AppSettings>;
  denials: PermissionDenial[];
  decide: ((query: PermissionQuery) => PermissionDecision) | null;
  panelWindows: Map<string, PanelWindowDescriptor>;
  mounted: Array<{ root: Root; container: HTMLElement; preparation: WindowPreparation }>;
  /** `show` and `settle` work in flight; teardown waits for it. */
  inFlight: Set<Promise<unknown>>;
}

const NO_AUTH: WorkspaceClusterState['auth'] = {
  state: '',
  reason: '',
  errorClass: '',
  secondsUntilRetry: 0,
  class: '',
  kind: '',
  summary: '',
  execCommand: '',
};

const workspaceClusterState = (
  cluster: TestCluster,
  lifecycle: backend.ClusterLifecycleState,
  auth: Partial<WorkspaceClusterState['auth']> = {},
  health = backend.ClusterHealthState.ClusterHealthHealthy
): WorkspaceClusterState => ({
  clusterId: cluster.clusterId,
  clusterName: cluster.clusterName,
  lifecycle,
  auth: { ...NO_AUTH, ...auth },
  health,
  scopeRevision: 1,
});

// backend/cluster_auth_contract.go newClusterAuthStateCommand.
const AUTH_EVENTS = {
  valid: 'cluster:auth:recovered',
  recovering: 'cluster:auth:recovering',
  invalid: 'cluster:auth:failed',
} as const;

/** The backend's state after `change`, and the events it sends for it. */
const applyClusterChange = (
  state: WorkspaceClusterState,
  change: ClusterStateChange
): { next: WorkspaceClusterState; events: Array<[string, Record<string, unknown>]> } => {
  const identity = { clusterId: state.clusterId, clusterName: state.clusterName };
  const events: Array<[string, Record<string, unknown>]> = [];
  let next = state;
  if (change.lifecycle) {
    events.push([
      'cluster:lifecycle',
      { clusterId: state.clusterId, state: change.lifecycle, previousState: state.lifecycle },
    ]);
    next = { ...next, lifecycle: change.lifecycle };
  }
  if (change.auth) {
    const auth =
      change.auth.state === 'valid'
        ? { ...NO_AUTH, state: 'valid' }
        : { ...NO_AUTH, ...change.auth };
    // ClusterAuthEvent carries every diagnostic field (authEventPayload).
    const { reason, class: diagnosticClass, kind, summary, execCommand } = auth;
    events.push([
      AUTH_EVENTS[change.auth.state],
      { ...identity, reason, class: diagnosticClass, kind, summary, execCommand },
    ]);
    next = { ...next, auth };
  }
  if (change.health) {
    events.push([`cluster:health:${change.health}`, identity]);
    next = { ...next, health: change.health };
  }
  return { next, events };
};

const namespaceSummary = (clusterId: string, name: string): NamespaceSummary => ({
  ref: {
    clusterId,
    group: '',
    version: 'v1',
    kind: 'Namespace',
    resource: 'namespaces',
    name,
    namespace: '',
    uid: `${clusterId}/${name}`,
  },
  phase: 'Active',
  resourceVersion: '1',
  creationTimestamp: 0,
  hasWorkloads: true,
  warningEventsState: 'available',
  quotaPressureState: 'available',
});

const matches = (expected: string | undefined, actual: string | undefined) =>
  expected === undefined || expected === (actual ?? '');

const deniedBy = (query: PermissionQuery, denials: PermissionDenial[]): boolean =>
  denials.some(
    (denial) =>
      denial.verb === query.verb &&
      matches(denial.resourceKind, query.resourceKind) &&
      matches(denial.namespace, query.namespace) &&
      matches(denial.subresource, query.subresource) &&
      matches(denial.name, query.name)
  );

/**
 * One permission result, as backend/resource_gateway_permissions.go builds it:
 * a namespaced query resolves from the namespace's complete rules (SSRR,
 * :262-273); a cluster-wide query, or one whose rules are incomplete, by access
 * review (SSAR, with the API server's reason, capabilities/service.go:221).
 */
const permissionResult = (query: PermissionQuery, decision: PermissionDecision) => {
  if (typeof decision === 'object' && 'error' in decision) {
    // The backend reports a check it could not evaluate per query, never as a
    // failed call (resource_gateway_permissions.go).
    return { ...query, allowed: false, source: 'error', error: decision.error };
  }
  if (typeof decision === 'object') {
    return {
      ...query,
      allowed: decision.allowed ?? false,
      source: 'ssar',
      reason: decision.reason,
    };
  }
  if (query.namespace) {
    return decision
      ? { ...query, allowed: true, source: 'ssrr' }
      : { ...query, allowed: false, source: 'denied', reason: 'no matching rule' };
  }
  return { ...query, allowed: decision, source: 'ssar', reason: '' };
};

type WorkspacePanel = NonNullable<BackendResult<'GetPanelWorkspace'>['panels']>[number];

const OBJECT_REFERENCE_FIELDS = [
  'clusterId',
  'group',
  'version',
  'kind',
  'namespace',
  'name',
] as const;
const IDENTITY_REFERENCE_FIELDS = ['clusterId', 'kind', 'name'] as const;

/** internal/panelwindow/types.go identity(): the tab kind and every reference field, exactly. */
const samePanelIdentity = (left: WorkspacePanel['tab'], right: WorkspacePanel['tab']): boolean =>
  left.kind === right.kind &&
  OBJECT_REFERENCE_FIELDS.every(
    (field) => (left.objectRef?.[field] ?? '') === (right.objectRef?.[field] ?? '')
  ) &&
  IDENTITY_REFERENCE_FIELDS.every(
    (field) => (left.identityRef?.[field] ?? '') === (right.identityRef?.[field] ?? '')
  );

/**
 * The backend's panel directory for this window. Mirrors
 * internal/appwindow/workspace.go OpenPanelWorkspaceObject,
 * ClosePanelWorkspaceObject, and Snapshot: a window opens panels only for
 * clusters it displays, re-opening a listed panel focuses it instead of
 * rendering it again, and every change rings `panel-workspace:changed`.
 */
const answerPanelDirectory = (session: Session): void => {
  const { backend: rpc, events } = session.transport;
  const directory = new Map<string, { revision: number; panels: WorkspacePanel[] }>();
  const clusterEntry = (clusterId: string) => {
    const existing = directory.get(clusterId);
    if (existing) {
      return existing;
    }
    const created = { revision: 0, panels: [] as WorkspacePanel[] };
    directory.set(clusterId, created);
    return created;
  };
  const changed = (clusterId: string) => {
    clusterEntry(clusterId).revision += 1;
    queueMicrotask(() => events.emit('panel-workspace:changed', { clusterId }));
  };
  const displays = (clusterId: string) =>
    session.workspace.selectedKubeconfigs.some(
      (selection) => resolveClusterMeta(selection, session.kubeconfigs).id === clusterId
    );

  rpc.answer('OpenPanelWorkspaceObject', (windowName, tab) => {
    const { clusterId } = panelTargetFromSnapshot(tab);
    if (!displays(clusterId)) {
      throw new Error(`window ${windowName} does not display cluster ${clusterId}`);
    }
    const entry = clusterEntry(clusterId);
    const listed = entry.panels.find((existing) => existing.tab.panelId === tab.panelId);
    if (listed && !samePanelIdentity(listed.tab, tab)) {
      // workspace.go Open: a listed panel id must keep its object identity.
      throw new Error('panel identity does not match its object');
    }
    if (listed) {
      // The directory focuses the panel where it already is (workspace.go
      // focusWorkspacePanel) instead of rendering it again.
      const { location } = listed;
      if (location.kind === panelwindow.PanelLocationKind.PanelLocationWindow) {
        events.emit(
          'panel-window:focus-requested',
          { panelId: tab.panelId },
          { sender: location.windowName }
        );
      } else {
        events.emit(
          'panel-workspace:focus-requested',
          { clusterId, panelId: tab.panelId },
          { sender: location.windowName }
        );
      }
      changed(clusterId);
      return { panel: listed, render: false };
    }
    const panel: WorkspacePanel = {
      tab,
      location: {
        kind: panelwindow.PanelLocationKind.PanelLocationDocked,
        windowName,
        groupId: 'right',
        index: entry.panels.length,
        active: true,
      },
    };
    entry.panels.push(panel);
    changed(clusterId);
    return { panel, render: true };
  });
  rpc.answer('ClosePanelWorkspaceObject', (_windowName, clusterId, panelId) => {
    const entry = clusterEntry(clusterId);
    entry.panels = entry.panels.filter((panel) => panel.tab.panelId !== panelId);
    changed(clusterId);
  });
  rpc.answer('GetPanelWorkspace', (_windowName, clusterId) => {
    const entry = clusterEntry(clusterId);
    return { revision: entry.revision, panels: [...entry.panels] };
  });
  // Mirrors internal/appwindow/cluster_panel_close.go CloseClusterView for the
  // only app view of a cluster with no panel windows: the directory drops the
  // cluster's panels, and backend/workspace_cluster_close.go removes the
  // window's selection.
  rpc.answer('CloseClusterView', (windowName, clusterId) => {
    const selection = session.workspace.selectedKubeconfigs.find(
      (candidate) => resolveClusterMeta(candidate, session.kubeconfigs).id === clusterId
    );
    if (!selection) {
      throw new Error(`window ${windowName} no longer displays cluster ${clusterId}`);
    }
    if ([...session.panelWindows.values()].some((panel) => panel.clusterId === clusterId)) {
      throw new Error('The harness does not fake closing a cluster with open panel windows');
    }
    session.workspace.selectedKubeconfigs = session.workspace.selectedKubeconfigs.filter(
      (candidate) => candidate !== selection
    );
    directory.delete(clusterId);
    changed(clusterId);
    return true;
  });
  answerPanelWindowOpen(session, clusterEntry, changed);
};

/**
 * Native panel windows. Mirrors internal/appwindow/registry.go
 * BeginPanelWindowOpen and AcknowledgePanelWindowReady: the group stays in
 * place while its new window opens; the window's ready acknowledgement moves
 * the group into it, tells the source window (`panel-window:opened`), and
 * rings `panel-workspace:changed`. A window registered live with
 * `panelWindow` just gets its descriptor back.
 */
const answerPanelWindowOpen = (
  session: Session,
  clusterEntry: (clusterId: string) => { panels: WorkspacePanel[] },
  changed: (clusterId: string) => void
): void => {
  const { backend: rpc, events } = session.transport;
  const openingSources = new Map<string, string>();

  rpc.answer('BeginPanelWindowOpen', (sourceWindowName, snapshot) => {
    const windowName = `panel-${session.panelWindows.size + 1}`;
    const descriptor: PanelWindowDescriptor = {
      windowName,
      clusterId: snapshot.clusterId,
      groupId: snapshot.groupId,
      state: panelwindow.WindowState.WindowStateOpening,
      transferId: snapshot.transferId,
      group: {
        clusterId: snapshot.clusterId,
        groupId: snapshot.groupId,
        tabs: snapshot.tabs,
        activePanelId: snapshot.activePanelId,
      },
    };
    session.panelWindows.set(windowName, descriptor);
    openingSources.set(windowName, sourceWindowName);
    return descriptor;
  });
  rpc.answer('AcknowledgePanelWindowReady', (windowName, transferId) => {
    const descriptor = session.panelWindows.get(windowName);
    if (!descriptor) {
      throw new Error(`no panel window ${windowName} is opening`);
    }
    const live = { ...descriptor, state: panelwindow.WindowState.WindowStateLive };
    session.panelWindows.set(windowName, live);
    const source = openingSources.get(windowName);
    if (source === undefined || descriptor.transferId !== transferId) {
      return live;
    }
    openingSources.delete(windowName);
    const { clusterId, groupId, group } = descriptor;
    const moved = (group.tabs ?? []).map((tab) => tab.panelId);
    const entry = clusterEntry(clusterId);
    entry.panels = entry.panels.map((panel) => {
      const index = moved.indexOf(panel.tab.panelId);
      return index < 0
        ? panel
        : {
            ...panel,
            location: {
              kind: panelwindow.PanelLocationKind.PanelLocationWindow,
              windowName,
              groupId,
              index,
              active: panel.tab.panelId === group.activePanelId,
            },
          };
    });
    events.emit(
      'panel-window:opened',
      { windowName, transferId, sourceWindowName: source, clusterId, groupId, tabs: group.tabs },
      { sender: source }
    );
    changed(clusterId);
    return live;
  });
};

const answerBootRpcs = (session: Session): void => {
  const { backend: rpc } = session.transport;
  const workspaceState = (): WorkspaceState => ({
    selectedKubeconfigs: [...session.workspace.selectedKubeconfigs],
    visibleClusterId: session.workspace.visibleClusterId,
    clusters: Object.fromEntries(session.clusters),
  });

  rpc.answer('GetAppSettingsSchema', () => null);
  rpc.answer('GetAppSettings', () => ({ ...session.settings }) as AppSettings);
  rpc.answer('GetNativeWindowDescriptor', (name) => {
    const panel = session.panelWindows.get(name);
    return panel
      ? { schemaVersion: 1, role: panelwindow.NativeRole.NativeRolePanel, panel }
      : {
          schemaVersion: 1,
          role: panelwindow.NativeRole.NativeRoleWorkspace,
          workspace: { windowName: name },
        };
  });
  rpc.answer('GetKubeconfigs', () => ({
    kubeconfigs: [...session.kubeconfigs],
    state:
      session.kubeconfigs.length > 0
        ? backend.KubeconfigDiscoveryState.KubeconfigDiscoveryStateAvailable
        : backend.KubeconfigDiscoveryState.KubeconfigDiscoveryStateNoKubeconfigs,
    searchPaths: ['/kube'],
  }));
  rpc.answer('GetClusterWorkspaceStateForWindow', () => workspaceState());
  // Mirrors backend/workspace_state.go ApplyClusterWorkspace: a selection
  // update replaces the window's selections; visibility follows the command.
  rpc.answer('ApplyClusterWorkspace', (command) => {
    if (command.updateSelectedKubeconfigs) {
      session.workspace.selectedKubeconfigs = [...(command.selectedKubeconfigs ?? [])];
    }
    session.workspace.visibleClusterId = command.visibleClusterId;
    return { state: workspaceState() };
  });
  rpc.answer('QueryPermissions', (queries) => ({
    results: (queries ?? []).map((query) =>
      permissionResult(
        query,
        session.decide ? session.decide(query) : !deniedBy(query, session.denials)
      )
    ),
    diagnostics: [],
  }));
  rpc.answer('GetAppInfo', () => ({
    version: '0.0.0-test',
    buildTime: '',
    gitCommit: '',
    isBeta: false,
  }));
  rpc.answer('GetZoomLevel', () => 100);
  rpc.answer('ListRuntimeOperations', () => []);
  rpc.answer('ListShellSessions', () => []);
  rpc.answer('ListPortForwards', () => []);
  rpc.answer('GetFavorites', () => []);
  rpc.answer('GetClusterTabOrder', () => []);
  rpc.answer('GetGridTablePersistence', () => ({}));
  // Tables save their layout 250 ms after a change (useGridTablePersistence.ts).
  rpc.answer('SetGridTablePersistence', () => undefined);
  rpc.answer('SetClusterTabOrder', () => undefined);
  rpc.answer('MatchThemeForCluster', () => null);
  rpc.answer('GetClusterAllowedNamespaces', () => []);
  rpc.answer('PublishDockedPanels', () => undefined);
  rpc.answer('AcknowledgePanelWorkspaceReady', () => undefined);
  rpc.answer('PublishPanelWindowGroup', () => undefined);
  rpc.answer('SetAppLogsPanelVisible', () => undefined);
  rpc.answer('SetSidebarVisible', () => undefined);
  rpc.answer('LogAppLogsFromFrontend', () => undefined);
  rpc.answer('LogAppLogsFromFrontendWithCluster', () => undefined);
};

// Inputs for owner-level refresh tests that drive the orchestrator without
// mounting the shell. Mounted tests seed lifecycle and preferences through the
// boundary instead (cluster fixtures, `preferences`).

/** The event-bus lifecycle input adapter (core/refresh/clusterReadiness.ts). */
export const markClusterReady = (clusterId: string): void => {
  eventBus.emit('cluster:lifecycle', { clusterId, state: 'ready' });
};

/** The app's auto-refresh toggle; preference subscribers are notified. */
export const setAutoRefresh = (enabled: boolean): void => {
  setAppPreferencesForTesting({ autoRefreshEnabled: enabled });
};

/**
 * Settles queued promise continuations without advancing timers: ten chained
 * steps, each one microtask turn.
 */
export const flushRefreshWork = (): Promise<void> =>
  Array.from({ length: 10 }).reduce<Promise<void>>(
    (settled) => settled.then(() => undefined),
    Promise.resolve()
  );

let ownersRef: AppOwners | null = null;

// The surface provider mode renders inside the shell; `show` replaces it.
const surface = {
  ui: null as ReactNode,
  listeners: new Set<() => void>(),
  set(ui: ReactNode) {
    surface.ui = ui;
    surface.listeners.forEach((listener) => {
      listener();
    });
  },
  subscribe(listener: () => void) {
    surface.listeners.add(listener);
    return () => surface.listeners.delete(listener);
  },
};

// The leases a test holds; the host renders a holder for each.
const leaseStore = {
  leases: [] as Array<HarnessLease & { key: number }>,
  nextKey: 0,
  hostMounted: false,
  listeners: new Set<() => void>(),
  set(leases: Array<HarnessLease & { key: number }>) {
    leaseStore.leases = leases;
    leaseStore.listeners.forEach((listener) => {
      listener();
    });
  },
  subscribe(listener: () => void) {
    leaseStore.listeners.add(listener);
    return () => leaseStore.listeners.delete(listener);
  },
};

function HarnessLeaseHolder({
  domain,
  scope,
  preserveState,
  demand,
  fetchOnEnable,
}: Readonly<HarnessLease>) {
  useScopedRefreshDomainLifecycle({
    domain,
    scope,
    enabled: true,
    preserveState,
    demand,
    fetchOnEnable,
  });
  return null;
}

function HarnessLeases() {
  const leases = useSyncExternalStore(
    leaseStore.subscribe,
    () => leaseStore.leases,
    () => leaseStore.leases
  );
  useEffect(() => {
    leaseStore.hostMounted = true;
    return () => {
      leaseStore.hostMounted = false;
    };
  }, []);
  return leases.map(({ key, ...lease }) => <HarnessLeaseHolder key={key} {...lease} />);
}

function HarnessSurface() {
  return useSyncExternalStore(
    surface.subscribe,
    () => surface.ui,
    () => surface.ui
  );
}

function HarnessBridge() {
  ownersRef = {
    kubeconfig: useKubeconfig(),
    viewState: useOptionalViewState(),
    namespace: useNamespace(),
    objectPanel: useObjectPanel(),
    objectPanels: useObjectPanelState(),
  };
  return null;
}

/**
 * Applies a synchronous update through React's async act, which settles the
 * work the update starts (effects, a lazily imported surface suspending)
 * before it resolves; a sync act warns when a surface suspends.
 */
const applyInAct = (update: () => void): Promise<void> =>
  act(() => {
    update();
    return Promise.resolve();
  });

// Runs `step` `count` times, each after the previous one settles.
const repeatInOrder = (count: number, step: () => Promise<unknown>): Promise<void> =>
  Array.from({ length: count }).reduce<Promise<void>>(
    (previous) => previous.then(step).then(() => undefined),
    Promise.resolve()
  );

// One settling turn: lazy imports, zero-delay fake timers, queued microtasks.
const settleTurn = async (): Promise<void> => {
  await vi.dynamicImportSettled();
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(0);
  }
  await repeatInOrder(10, () => Promise.resolve());
};

const settleWork = async (): Promise<void> => {
  await act(() => repeatInOrder(3, settleTurn));
};

// Waits for show/settle work, including work started while waiting.
const drainInFlight = async (inFlight: ReadonlySet<Promise<unknown>>): Promise<void> => {
  if (inFlight.size === 0) {
    return;
  }
  await Promise.allSettled(inFlight);
  await drainInFlight(inFlight);
};

const withoutKeys = <T extends { key: number }>(items: readonly T[], keys: ReadonlySet<number>) =>
  items.filter(({ key }) => !keys.has(key));

// Releases leases a test holds, as an unmounting view releases its own.
const releaseLeases = async (held: ReadonlyArray<{ key: number }>): Promise<void> => {
  const keys = new Set(held.map(({ key }) => key));
  await applyInAct(() => {
    leaseStore.set(withoutKeys(leaseStore.leases, keys));
  });
  await settleWork();
};

/**
 * Installs the harness for every test in the calling file: boundary fakes and
 * error capture before each test; unmount, error assertion, fake removal, and
 * module-state reset after it.
 */
export const installAppStateHarness = (
  options: { windowName?: string; streams?: StreamAcknowledgement } = {}
): AppStateHarness => {
  const windowName = options.windowName ?? DEFAULT_WINDOW_NAME;
  let session: Session | null = null;

  const current = (): Session => {
    if (!session) {
      throw new Error('The app-state harness is used outside a test');
    }
    return session;
  };

  // A test may fire a view update without awaiting it (an onClose that
  // re-renders); teardown waits for it, so it cannot run into the next test.
  const track = <T,>(work: Promise<T>): Promise<T> => {
    const { inFlight } = current();
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work)).catch(() => undefined);
    return work;
  };

  beforeEach(() => {
    const transport = installTransport(windowName, options.streams);
    session = {
      transport,
      errors: installErrorCapture(),
      kubeconfigs: [],
      clusters: new Map(),
      workspace: { selectedKubeconfigs: [], visibleClusterId: '' },
      settings: {},
      denials: [],
      decide: null,
      panelWindows: new Map(),
      mounted: [],
      inFlight: new Set(),
    };
    answerBootRpcs(session);
    answerPanelDirectory(session);
  });

  afterEach(async () => {
    const ending = current();
    await drainInFlight(ending.inFlight);
    session = null;
    ownersRef = null;
    surface.ui = null;
    leaseStore.leases = [];
    try {
      ending.mounted.forEach(({ root, container, preparation }) => {
        act(() => root.unmount());
        container.remove();
        disposeWindowPreparation(preparation);
      });
      ending.errors.assertNoneUnexpected();
      // A caller may swallow the rejection, so an unanswered RPC fails here.
      const unfaked = ending.transport.backend.unfaked();
      if (unfaked.length > 0) {
        throw new Error(`Unfaked RPCs: ${[...new Set(unfaked)].join(', ')}`);
      }
    } finally {
      ending.errors.restore();
      // Reset while the fakes are installed: stopping streams, polls, and
      // demand sends requests, which must not reach the real fetch.
      resetAppModuleState();
      ending.transport.uninstall();
    }
  });

  // The sidebar marks each entry with what it targets (ui/layout/Sidebar.tsx).
  const sidebarSelector = (kind: string, view?: string, namespace?: string) =>
    [
      `[data-sidebar-target-kind="${kind}"]`,
      view ? `[data-sidebar-target-view="${view}"]` : '',
      namespace ? `[data-sidebar-target-namespace="${namespace}"]` : '',
    ].join('');

  const clickSidebar = async (container: HTMLElement, selector: string) => {
    const entry = container.querySelector<HTMLElement>(selector);
    if (!entry) {
      throw new Error(`The sidebar has no entry ${selector}`);
    }
    await applyInAct(() => {
      entry.click();
    });
    await settleWork();
  };

  const mount = async (
    element: (
      prepared: Awaited<ReturnType<typeof prepareWindow>>
    ) => ReactElement | Promise<ReactElement>
  ) => {
    const active = current();
    const preparation = createWindowPreparation();
    const prepared = await prepareWindow(TEST_REPORTING_CONFIG, preparation);
    const tree = await element(prepared);
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root | null = null;
    await applyInAct(() => {
      root = renderWindowRoot(container, tree, active.errors.rootOptions);
    });
    if (!root) {
      throw new Error('The window root did not render');
    }
    const mountedRoot: Root = root;
    active.mounted.push({ root: mountedRoot, container, preparation });
    await settleWork();
    const owners = () => {
      if (!ownersRef) {
        throw new Error('Owners are not available in a panel window');
      }
      return ownersRef;
    };
    return {
      container,
      openPanels: () =>
        Array.from(owners().objectPanels.openPanels.values()).map((target) =>
          isIdentityPanelRef(target)
            ? { ...target }
            : {
                clusterId: target.clusterId,
                clusterName: target.clusterName ?? undefined,
                group: target.group,
                version: target.version,
                kind: target.kind,
                namespace: target.namespace ?? '',
                name: target.name,
              }
        ),
      owners() {
        if (!ownersRef) {
          throw new Error('Owners are not available in a panel window');
        }
        return ownersRef;
      },
      show: (ui) =>
        track(
          (async () => {
            await applyInAct(() => {
              surface.set(ui);
            });
            await settleWork();
          })()
        ),
      clear() {
        act(() => surface.set(null));
      },
      selectCluster: (cluster) =>
        track(
          (async () => {
            await applyInAct(() => {
              owners().kubeconfig.setActiveKubeconfig(cluster.selection);
            });
            await settleWork();
            if (owners().kubeconfig.selectedClusterId !== cluster.clusterId) {
              throw new Error(`The workspace did not switch to ${cluster.clusterId}`);
            }
          })()
        ),
      goTo: (target) =>
        track(
          (async () => {
            const clusterId = owners().kubeconfig.selectedClusterId;
            if ('namespace' in target) {
              const key = `${clusterId}|${target.namespace}`;
              const viewSelector = sidebarSelector('namespace-view', target.view, key);
              if (!container.querySelector(viewSelector)) {
                await clickSidebar(container, sidebarSelector('namespace-toggle', undefined, key));
              }
              await clickSidebar(container, viewSelector);
            } else if ('clusterView' in target) {
              await clickSidebar(
                container,
                target.clusterView === 'overview'
                  ? sidebarSelector('overview')
                  : sidebarSelector('cluster-view', target.clusterView)
              );
            } else {
              await clickSidebar(container, sidebarSelector('global-view', target.globalView));
            }
          })()
        ),
      lease: (...leases) =>
        track(
          (async () => {
            if (!leaseStore.hostMounted) {
              throw new Error(
                'This mount holds no leases: lease from provider mode or the full workspace'
              );
            }
            const held = leases.map((lease, index) => ({
              ...lease,
              key: leaseStore.nextKey + index,
            }));
            leaseStore.nextKey += leases.length;
            await applyInAct(() => {
              leaseStore.set([...leaseStore.leases, ...held]);
            });
            await settleWork();
            return () => releaseLeases(held);
          })()
        ),
      unmount() {
        act(() => mountedRoot.unmount());
      },
    } satisfies MountedApp;
  };

  const objectOf = (cluster: TestCluster, identity: ObjectIdentity): TestObject => {
    const ref = { ...identity, clusterId: cluster.clusterId, clusterName: cluster.clusterName };
    return { ref, scopes: getObjectPanelScopes(ref) };
  };

  return {
    get backend() {
      return current().transport.backend;
    },
    get events() {
      return current().transport.events;
    },
    get streams() {
      return current().transport.streams;
    },
    get snapshots() {
      return current().transport.snapshots;
    },
    get errors() {
      return current().errors;
    },
    windowName,
    focusedWindows: () => current().transport.focusedWindows(),
    cluster({ name, context, lifecycle, auth, health, open = true }) {
      const active = current();
      const info: KubeconfigInfo = {
        name,
        path: `/kube/${name}`,
        context,
        isDefault: false,
        isCurrentContext: false,
        invalid: false,
        invalidReason: '',
      };
      active.kubeconfigs.push(info);
      const selection = `${info.path}:${context}`;
      const meta = resolveClusterMeta(selection, active.kubeconfigs);
      const cluster: TestCluster = { selection, clusterId: meta.id, clusterName: meta.name };
      if (open) {
        active.workspace.selectedKubeconfigs.push(selection);
        active.clusters.set(
          cluster.clusterId,
          workspaceClusterState(
            cluster,
            lifecycle ?? backend.ClusterLifecycleState.ClusterStateReady,
            auth,
            health
          )
        );
        active.workspace.visibleClusterId ||= cluster.clusterId;
      }
      return cluster;
    },
    setClusterState: (cluster, change) =>
      track(
        (async () => {
          const active = current();
          // A cluster the window opened mid-test is connecting until its
          // lifecycle moves (backend workspace_state.go reports it at once).
          const opened = active.workspace.selectedKubeconfigs.includes(cluster.selection)
            ? workspaceClusterState(cluster, backend.ClusterLifecycleState.ClusterStateConnecting)
            : undefined;
          const state = active.clusters.get(cluster.clusterId) ?? opened;
          if (!state) {
            throw new Error(`The workspace does not have ${cluster.clusterId} open`);
          }
          const { next, events } = applyClusterChange(state, change);
          active.clusters.set(cluster.clusterId, next);
          await applyInAct(() => {
            for (const [name, payload] of events) {
              active.transport.events.emit(name, payload);
            }
          });
          await settleWork();
        })()
      ),
    object: objectOf,
    servePanel(cluster, identity, detail = {}) {
      const { snapshots } = current().transport;
      const object = objectOf(cluster, identity);
      const meta = { clusterId: cluster.clusterId, clusterName: cluster.clusterName };
      snapshots.serve('object-details', object.scopes.detailScope ?? '', {
        ...meta,
        detailType: identity.kind.toLowerCase(),
        details: {},
        ...detail,
      } as DomainPayloadMap['object-details']);
      const namespace = identity.namespace?.trim();
      const apiVersion = identity.group
        ? `${identity.group}/${identity.version}`
        : identity.version;
      snapshots.serve('object-yaml', object.scopes.detailScope ?? '', {
        ...meta,
        yaml: [
          `apiVersion: ${apiVersion}`,
          `kind: ${identity.kind}`,
          'metadata:',
          `  name: ${identity.name}`,
          ...(namespace ? [`  namespace: ${namespace}`] : []),
        ].join('\n'),
      });
      if (object.scopes.eventsScope) {
        snapshots.serve('object-events', object.scopes.eventsScope, { ...meta, events: [] });
      }
      if (object.scopes.podsScope) {
        snapshots.serve('pods', object.scopes.podsScope, makePodSnapshotPayload(meta));
      }
      if (namespace) {
        const selector = { kind: 'namespace', namespace } as const;
        snapshots.serve(
          'pods',
          buildRefreshScope('pods', { clusterId: cluster.clusterId, selector }),
          makePodSnapshotPayload(meta)
        );
        snapshots.serve(
          'namespace-workloads',
          buildRefreshScope('namespace-workloads', { clusterId: cluster.clusterId, selector }),
          makeNamespaceWorkloadSnapshotPayload(meta)
        );
      }
      return object;
    },
    namespaces(cluster, names) {
      const { snapshots } = current().transport;
      const scope = buildClusterRefreshScope('namespaces', cluster.clusterId);
      const namespaces: DomainPayloadMap['namespaces'] = {
        clusterId: cluster.clusterId,
        clusterName: cluster.clusterName,
        namespaces: names.map((name) => namespaceSummary(cluster.clusterId, name)),
      };
      const metrics: DomainPayloadMap['namespace-metrics'] = {
        clusterId: cluster.clusterId,
        clusterName: cluster.clusterName,
        namespaces: [],
        metrics: { stale: false, successCount: 1, failureCount: 0 },
        metricsState: 'available',
      };
      snapshots.serve('namespaces', scope, namespaces, names.length);
      snapshots.serve('namespace-metrics', scope, metrics, 0);
    },
    serveTable(cluster, domain, payload = {}) {
      return current().transport.snapshots.answer((request) => {
        if (request.domain !== domain || !request.scope.startsWith(`${cluster.clusterId}|`)) {
          return undefined;
        }
        const rows = (payload as { rows?: unknown[] }).rows ?? [];
        return {
          clusterId: cluster.clusterId,
          clusterName: cluster.clusterName,
          provider: 'typed-resource',
          table: domain,
          total: rows.length,
          unfilteredTotal: rows.length,
          totalIsExact: true,
          facetsExact: true,
          capabilities: {
            sortableFields: [],
            filterableFields: [],
            searchableFields: [],
            kindVocabulary: [],
          },
          rows,
          ...payload,
        };
      });
    },
    startScreen(cluster) {
      const { snapshots } = current().transport;
      const identity = { clusterId: cluster.clusterId, clusterName: cluster.clusterName };
      snapshots.serve(
        'cluster-overview',
        buildClusterRefreshScope('cluster-overview', cluster.clusterId),
        makeClusterOverviewSnapshotPayload(identity)
      );
      snapshots.serve(
        'cluster-attention',
        buildClusterRefreshScope('cluster-attention', cluster.clusterId),
        makeClusterAttentionSnapshot(identity)
      );
      // The discovered-families read (core/navigation/useAvailableResourceViews.ts).
      snapshots.serve(
        'catalog',
        buildRefreshScope('catalog', {
          clusterId: cluster.clusterId,
          selector: CLUSTER_SELECTOR,
          query: 'limit=1',
        }),
        makeCatalogSnapshotPayload(identity)
      );
    },
    preferences(settings) {
      const active = current();
      active.settings = { ...active.settings, ...settings };
    },
    permissions(decide) {
      current().decide = decide;
    },
    denyPermissions(denials) {
      current().denials.push(...denials);
    },
    panelWindow(cluster, { name = 'panel-1', transferId = '', tabs = [] } = {}) {
      const active = current();
      const descriptor: PanelWindowDescriptor = {
        windowName: name,
        clusterId: cluster.clusterId,
        groupId: 'right',
        state: panelwindow.WindowState.WindowStateLive,
        transferId,
        group: {
          clusterId: cluster.clusterId,
          groupId: 'right',
          tabs,
          activePanelId: tabs[0]?.panelId ?? '',
        },
      };
      active.panelWindows.set(name, descriptor);
      active.transport.setWindowName(name);
      return descriptor;
    },
    render(ui) {
      surface.ui = ui;
      return mount((prepared) => {
        const panel = prepared.descriptor.panel;
        if (prepared.descriptor.role === panelwindow.NativeRole.NativeRolePanel && panel) {
          return (
            <PanelWindowShell descriptor={panel}>
              <HarnessBridge />
              <HarnessLeases />
              <HarnessSurface />
            </PanelWindowShell>
          );
        }
        return (
          <AppShell>
            <HarnessBridge />
            <HarnessLeases />
            <HarnessSurface />
          </AppShell>
        );
      });
    },
    mountApp(probes) {
      return mount(async (prepared) => {
        if (prepared.descriptor.role === panelwindow.NativeRole.NativeRolePanel) {
          return loadWindowRoot(prepared.descriptor);
        }
        // Exactly what App renders (App.tsx), plus the bridge and probes beside the layout.
        return (
          <AppShell>
            <AppLayout />
            <HarnessBridge />
            <HarnessLeases />
            {probes}
          </AppShell>
        );
      });
    },
    settle: () => track(settleWork()),
  };
};
