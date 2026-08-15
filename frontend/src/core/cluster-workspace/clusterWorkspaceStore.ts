import { GetClusterWorkspaceStateForWindow } from '@/core/backend-api';
import type { ClusterLifecycleState } from '@/core/contexts/clusterLifecycleState';
import { parseClusterLifecycleState } from '@/core/contexts/clusterLifecycleState';
import {
  type DesktopEventHandler,
  type DesktopEventPayload,
  onEvent,
} from '@/core/desktop-runtime';
import { eventBus } from '@/core/events';
import { logAppLogsInfo } from '@/core/logging/appLogsClient';
import { getWindowIdentity } from '@/core/window-identity';
import { reportOperationalError } from '@/utils/errorHandler';

export type ClusterHealthStatus = 'healthy' | 'degraded' | 'unknown';
export type AuthErrorClass = 'auth' | 'connectivity' | '';

export interface ClusterAuthState {
  hasError: boolean;
  reason: string;
  clusterName: string;
  isRecovering: boolean;
  secondsUntilRetry: number;
  errorClass: AuthErrorClass;
  execCommand: string;
  diagnosticKind: string;
  diagnosticSummary: string;
}

export const DEFAULT_CLUSTER_AUTH_STATE: ClusterAuthState = {
  hasError: false,
  reason: '',
  clusterName: '',
  isRecovering: false,
  secondsUntilRetry: 0,
  errorClass: '',
  execCommand: '',
  diagnosticKind: '',
  diagnosticSummary: '',
};

export type AuthEventPayload = Partial<DesktopEventPayload<'cluster:auth:failed'>>;
export type AuthProgressPayload = Partial<DesktopEventPayload<'cluster:auth:progress'>>;

const normalizeAuthErrorClass = (value: unknown): AuthErrorClass =>
  value === 'auth' || value === 'connectivity' ? value : '';

export const isConfirmedAuthFailure = (state: ClusterAuthState): boolean =>
  state.hasError && (!state.isRecovering || state.errorClass === 'auth');

const failedAuthState = (
  existing: ClusterAuthState | undefined,
  payload: AuthEventPayload
): ClusterAuthState => ({
  hasError: true,
  reason: payload.reason || 'Authentication failed',
  clusterName: payload.clusterName || payload.clusterId || '',
  isRecovering: false,
  secondsUntilRetry: existing?.secondsUntilRetry || 0,
  errorClass: 'auth',
  execCommand: payload.execCommand || existing?.execCommand || '',
  diagnosticKind: payload.kind || existing?.diagnosticKind || '',
  diagnosticSummary: payload.summary || existing?.diagnosticSummary || '',
});

const recoveringAuthState = (
  existing: ClusterAuthState | undefined,
  payload: AuthEventPayload
): ClusterAuthState => ({
  hasError: true,
  reason: existing?.reason || payload.reason || 'Authentication failed',
  clusterName: existing?.clusterName || payload.clusterName || payload.clusterId || '',
  isRecovering: true,
  secondsUntilRetry: existing?.secondsUntilRetry || 0,
  errorClass: existing?.errorClass ?? '',
  execCommand: existing?.execCommand || payload.execCommand || '',
  diagnosticKind: existing?.diagnosticKind || payload.kind || '',
  diagnosticSummary: existing?.diagnosticSummary || payload.summary || '',
});

const progressedAuthState = (
  existing: ClusterAuthState | undefined,
  payload: AuthProgressPayload
): ClusterAuthState | undefined => {
  if (!existing?.hasError) {
    return existing;
  }
  return {
    ...existing,
    clusterName: payload.clusterName || existing.clusterName,
    secondsUntilRetry: payload.secondsUntilRetry ?? existing.secondsUntilRetry,
    errorClass: normalizeAuthErrorClass(payload.errorClass) || existing.errorClass,
    execCommand: payload.execCommand || existing.execCommand,
    diagnosticKind: payload.kind || existing.diagnosticKind,
    diagnosticSummary: payload.summary || existing.diagnosticSummary,
  };
};

const updateAuthMap = (
  prev: Map<string, ClusterAuthState>,
  payload: AuthEventPayload,
  update: (existing: ClusterAuthState | undefined) => ClusterAuthState | undefined
): Map<string, ClusterAuthState> => {
  if (!payload.clusterId) {
    return prev;
  }
  const state = update(prev.get(payload.clusterId));
  if (!state) {
    return prev;
  }
  const next = new Map(prev);
  next.set(payload.clusterId, state);
  return next;
};

export const applyAuthFailedEvent = (
  prev: Map<string, ClusterAuthState>,
  payload: AuthEventPayload
): Map<string, ClusterAuthState> =>
  updateAuthMap(prev, payload, (existing) => failedAuthState(existing, payload));

export const applyAuthRecoveringEvent = (
  prev: Map<string, ClusterAuthState>,
  payload: AuthEventPayload
): Map<string, ClusterAuthState> =>
  updateAuthMap(prev, payload, (existing) => recoveringAuthState(existing, payload));

export const applyAuthProgressEvent = (
  prev: Map<string, ClusterAuthState>,
  payload: AuthProgressPayload
): Map<string, ClusterAuthState> =>
  updateAuthMap(prev, payload, (existing) => progressedAuthState(existing, payload));

type BackendWorkspaceState = Awaited<ReturnType<typeof GetClusterWorkspaceStateForWindow>>;
type BackendWorkspaceClusters = NonNullable<BackendWorkspaceState['clusters']>;
type BackendWorkspaceClusterState = NonNullable<BackendWorkspaceClusters[string]>;
type BackendWorkspaceAuthState = BackendWorkspaceClusterState['auth'];
interface ClusterWorkspaceWireAuthState extends Partial<BackendWorkspaceAuthState> {
  state: string;
}
interface ClusterWorkspaceWireClusterState
  extends Omit<BackendWorkspaceClusterState, 'auth' | 'health' | 'lifecycle' | 'convertValues'> {
  lifecycle?: string;
  auth: ClusterWorkspaceWireAuthState;
  health: string;
}
export interface ClusterWorkspaceWireState
  extends Omit<BackendWorkspaceState, 'clusters' | 'convertValues'> {
  clusters: Record<string, ClusterWorkspaceWireClusterState | undefined> | null;
}

export interface ClusterWorkspaceClusterState {
  clusterId: string;
  clusterName: string;
  lifecycle?: ClusterLifecycleState;
  auth: ClusterAuthState;
  health: ClusterHealthStatus;
  scopeRevision: number;
}

export interface ClusterWorkspaceSnapshot {
  selectedKubeconfigs: readonly string[];
  visibleClusterId: string;
  clusters: ReadonlyMap<string, ClusterWorkspaceClusterState>;
}

type ClusterWorkspaceEventName =
  | 'cluster:lifecycle'
  | 'cluster:auth:failed'
  | 'cluster:auth:recovering'
  | 'cluster:auth:recovered'
  | 'cluster:auth:progress'
  | 'cluster:health:healthy'
  | 'cluster:health:degraded'
  | 'cluster:scope:changed';

type ClusterWorkspaceEventSubscriber = <E extends ClusterWorkspaceEventName>(
  event: E,
  handler: DesktopEventHandler<E>
) => () => void;

interface ClusterWorkspaceStoreOptions {
  read: () => Promise<ClusterWorkspaceWireState>;
  onEvent: ClusterWorkspaceEventSubscriber;
}

const emptySnapshot = (): ClusterWorkspaceSnapshot => ({
  selectedKubeconfigs: [],
  visibleClusterId: '',
  clusters: new Map(),
});

const authStateFromWire = (
  wire: ClusterWorkspaceWireAuthState,
  clusterName: string
): ClusterAuthState => {
  if (wire.state !== 'invalid' && wire.state !== 'recovering') {
    return { ...DEFAULT_CLUSTER_AUTH_STATE, clusterName };
  }
  return {
    hasError: true,
    reason: wire.reason || 'Authentication failed',
    clusterName,
    isRecovering: wire.state === 'recovering',
    secondsUntilRetry: wire.secondsUntilRetry ?? 0,
    errorClass: wire.state === 'invalid' ? 'auth' : normalizeAuthErrorClass(wire.errorClass),
    execCommand: wire.execCommand || '',
    diagnosticKind: wire.kind || '',
    diagnosticSummary: wire.summary || '',
  };
};

const fieldKey = (clusterId: string, field: string): string => `${clusterId}\0${field}`;
const serviceableStates = new Set<ClusterLifecycleState>(['loading', 'loading_slow', 'ready']);

const isWireFieldLive = (
  liveFields: ReadonlySet<string> | undefined,
  clusterId: string,
  field: string
): boolean => liveFields?.has(fieldKey(clusterId, field)) ?? false;

const clusterHasLiveField = (liveFields: ReadonlySet<string>, clusterId: string): boolean => {
  const prefix = `${clusterId}\0`;
  for (const key of liveFields) {
    if (key.startsWith(prefix)) {
      return true;
    }
  }
  return false;
};

const retainLiveClusters = (
  current: ReadonlyMap<string, ClusterWorkspaceClusterState>,
  liveFields?: ReadonlySet<string>
): Map<string, ClusterWorkspaceClusterState> => {
  const retained = new Map<string, ClusterWorkspaceClusterState>();
  if (!liveFields) {
    return retained;
  }
  for (const [clusterId, cluster] of current) {
    if (clusterHasLiveField(liveFields, clusterId)) {
      retained.set(clusterId, cluster);
    }
  }
  return retained;
};

const resolveWireHealth = (
  rawHealth: string,
  previous: ClusterWorkspaceClusterState | undefined,
  live: boolean
): ClusterHealthStatus => {
  if (live) {
    return previous?.health ?? 'unknown';
  }
  return rawHealth === 'healthy' || rawHealth === 'degraded' ? rawHealth : 'unknown';
};

interface MergedWireCluster {
  state: ClusterWorkspaceClusterState;
  parsedLifecycle?: ClusterLifecycleState;
  lifecycleIsLive: boolean;
}

const mergeWireCluster = (
  clusterId: string,
  raw: ClusterWorkspaceWireClusterState,
  previous: ClusterWorkspaceClusterState | undefined,
  liveFields?: ReadonlySet<string>
): MergedWireCluster => {
  const clusterName = raw.clusterName || previous?.clusterName || clusterId;
  const parsedLifecycle = parseClusterLifecycleState(raw.lifecycle);
  const lifecycleIsLive = isWireFieldLive(liveFields, clusterId, 'lifecycle');
  const authIsLive = isWireFieldLive(liveFields, clusterId, 'auth');
  const healthIsLive = isWireFieldLive(liveFields, clusterId, 'health');
  const scopeIsLive = isWireFieldLive(liveFields, clusterId, 'scope');
  return {
    state: {
      clusterId,
      clusterName,
      lifecycle: lifecycleIsLive ? previous?.lifecycle : parsedLifecycle,
      auth: authIsLive
        ? (previous?.auth ?? DEFAULT_CLUSTER_AUTH_STATE)
        : authStateFromWire(raw.auth ?? { state: 'unknown' }, raw.clusterName || clusterId),
      health: resolveWireHealth(raw.health, previous, healthIsLive),
      scopeRevision: scopeIsLive ? (previous?.scopeRevision ?? 0) : (raw.scopeRevision ?? 0),
    },
    parsedLifecycle,
    lifecycleIsLive,
  };
};

const shouldEmitHydratedLifecycle = (
  merged: MergedWireCluster,
  previous: ClusterWorkspaceClusterState | undefined,
  liveFields?: ReadonlySet<string>
): merged is MergedWireCluster & { parsedLifecycle: ClusterLifecycleState } =>
  Boolean(
    liveFields &&
      merged.parsedLifecycle &&
      !merged.lifecycleIsLive &&
      previous?.lifecycle !== merged.parsedLifecycle
  );

const mergeWireClusters = (
  wireClusters: Record<string, ClusterWorkspaceWireClusterState | undefined> | null | undefined,
  current: ReadonlyMap<string, ClusterWorkspaceClusterState>,
  liveFields?: ReadonlySet<string>
): Map<string, ClusterWorkspaceClusterState> => {
  const next = retainLiveClusters(current, liveFields);
  for (const [clusterId, raw] of Object.entries(wireClusters ?? {})) {
    if (!raw) {
      continue;
    }
    const previous = next.get(clusterId) ?? current.get(clusterId);
    const merged = mergeWireCluster(clusterId, raw, previous, liveFields);
    next.set(clusterId, merged.state);
    if (shouldEmitHydratedLifecycle(merged, previous, liveFields)) {
      eventBus.emit('cluster:lifecycle', { clusterId, state: merged.parsedLifecycle });
    }
  }
  return next;
};

export class ClusterWorkspaceStore {
  private readonly options: ClusterWorkspaceStoreOptions;
  private snapshot = emptySnapshot();
  private readonly listeners = new Set<() => void>();
  private readonly serviceableListeners = new Set<(clusterId: string) => void>();
  private readonly activationListeners = new Set<(clusterId: string) => void>();
  private readonly foregroundActivations = new Map<string, number>();
  private readonly pendingHydrationFields = new Set<Set<string>>();
  private disposers: Array<() => void> = [];
  private references = 0;
  private generation = 0;
  private authoritativeGeneration = 0;
  private nextReadSequence = 0;
  private appliedReadSequence = 0;
  private hydrationPromise: Promise<ClusterWorkspaceWireState> | null = null;

  constructor(options: ClusterWorkspaceStoreOptions) {
    this.options = options;
  }

  readonly getSnapshot = (): ClusterWorkspaceSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getCluster(clusterId: string): ClusterWorkspaceClusterState | undefined {
    return this.snapshot.clusters.get(clusterId);
  }

  getAuth(clusterId: string): ClusterAuthState {
    return this.getCluster(clusterId)?.auth ?? DEFAULT_CLUSTER_AUTH_STATE;
  }

  getHealth(clusterId: string): ClusterHealthStatus {
    return this.getCluster(clusterId)?.health ?? 'unknown';
  }

  acquire(): () => void {
    this.references++;
    if (this.references === 1) {
      this.start();
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.references--;
      if (this.references === 0) {
        this.stop();
      }
    };
  }

  applyWireState(wire: ClusterWorkspaceWireState): void {
    this.authoritativeGeneration++;
    this.pendingHydrationFields.clear();
    this.mergeWireState(wire);
  }

  hydrate(): Promise<ClusterWorkspaceWireState> {
    if (this.hydrationPromise) {
      return this.hydrationPromise;
    }
    return this.readAndMerge();
  }

  refresh(): Promise<ClusterWorkspaceWireState> {
    return this.readAndMerge();
  }

  private readAndMerge(): Promise<ClusterWorkspaceWireState> {
    const generation = this.generation;
    const authoritativeGeneration = this.authoritativeGeneration;
    const readSequence = ++this.nextReadSequence;
    const liveFields = new Set<string>();
    this.pendingHydrationFields.add(liveFields);
    const pending = this.options.read().then((wire) => {
      if (
        this.references > 0 &&
        generation === this.generation &&
        authoritativeGeneration === this.authoritativeGeneration &&
        readSequence >= this.appliedReadSequence &&
        wire
      ) {
        this.appliedReadSequence = readSequence;
        this.mergeWireState(wire, liveFields);
      }
      return wire;
    });
    this.hydrationPromise = pending;
    void pending.then(
      () => {
        this.pendingHydrationFields.delete(liveFields);
      },
      () => {
        this.pendingHydrationFields.delete(liveFields);
        if (this.hydrationPromise === pending) {
          this.hydrationPromise = null;
        }
      }
    );
    return pending;
  }

  private mergeWireState(wire: ClusterWorkspaceWireState, liveFields?: ReadonlySet<string>): void {
    this.publish({
      selectedKubeconfigs: [...(wire.selectedKubeconfigs ?? [])],
      visibleClusterId: wire.visibleClusterId ?? '',
      clusters: mergeWireClusters(wire.clusters, this.snapshot.clusters, liveFields),
    });
  }

  private start(): void {
    this.generation++;
    this.pendingHydrationFields.clear();
    const on = <E extends ClusterWorkspaceEventName>(event: E, handler: DesktopEventHandler<E>) => {
      try {
        this.disposers.push(this.options.onEvent(event, handler));
      } catch (error) {
        this.reportIsolationError(`Failed to subscribe to ${event}`, error);
      }
    };

    on('cluster:lifecycle', (payload) => this.handleLifecycle(payload));
    on('cluster:auth:failed', (payload) => this.handleAuthFailed(payload));
    on('cluster:auth:recovering', (payload) => this.handleAuthRecovering(payload));
    on('cluster:auth:recovered', (payload) => this.handleAuthRecovered(payload));
    on('cluster:auth:progress', (payload) => this.handleAuthProgress(payload));
    on('cluster:health:healthy', (payload) => this.handleHealth(payload, 'healthy'));
    on('cluster:health:degraded', (payload) => this.handleHealth(payload, 'degraded'));
    on('cluster:scope:changed', (payload) => this.handleScopeChanged(payload));

    void this.hydrate().catch((error) => {
      reportOperationalError(error, {
        source: 'ClusterWorkspaceStore',
        action: 'hydrateClusterWorkspace',
      });
    });
  }

  private stop(): void {
    this.generation++;
    for (const dispose of this.disposers) {
      try {
        dispose();
      } catch (error) {
        this.reportIsolationError('Failed to dispose a workspace event subscription', error);
      }
    }
    this.disposers = [];
    this.pendingHydrationFields.clear();
    this.foregroundActivations.clear();
    this.hydrationPromise = null;
    this.snapshot = emptySnapshot();
  }

  private updateCluster(
    clusterId: string,
    field: string,
    update: (current: ClusterWorkspaceClusterState) => ClusterWorkspaceClusterState
  ): void {
    const key = fieldKey(clusterId, field);
    this.pendingHydrationFields.forEach((liveFields) => {
      liveFields.add(key);
    });
    const current =
      this.snapshot.clusters.get(clusterId) ??
      ({
        clusterId,
        clusterName: clusterId,
        auth: DEFAULT_CLUSTER_AUTH_STATE,
        health: 'unknown',
        scopeRevision: 0,
      } satisfies ClusterWorkspaceClusterState);
    const next = update(current);
    if (next === current) {
      return;
    }
    const clusters = new Map(this.snapshot.clusters);
    clusters.set(clusterId, next);
    this.publish({ ...this.snapshot, clusters });
  }

  private handleLifecycle(payload: DesktopEventPayload<'cluster:lifecycle'>): void {
    const lifecycle = parseClusterLifecycleState(payload?.state);
    if (!payload?.clusterId || !lifecycle) {
      return;
    }
    this.applyLifecycleState(payload.clusterId, lifecycle);
    eventBus.emit('cluster:lifecycle', { clusterId: payload.clusterId, state: lifecycle });
  }

  applyLifecycleState(clusterId: string, lifecycle: ClusterLifecycleState): void {
    if (!clusterId) {
      return;
    }
    const wasServiceable = this.isServiceable(clusterId);
    this.updateCluster(clusterId, 'lifecycle', (current) =>
      current.lifecycle === lifecycle ? current : { ...current, lifecycle }
    );
    if (!wasServiceable && this.isServiceable(clusterId)) {
      this.notifyListeners(
        this.serviceableListeners,
        (listener) => listener(clusterId),
        'A serviceability listener failed'
      );
    }
  }

  private handleAuthFailed(payload: DesktopEventPayload<'cluster:auth:failed'>): void {
    if (!payload?.clusterId) {
      console.warn('[AuthErrorContext] Received auth:failed without clusterId');
      return;
    }
    this.updateCluster(payload.clusterId, 'auth', (current) => ({
      ...current,
      auth: failedAuthState(current.auth, payload),
    }));
    eventBus.emit('cluster:auth:failed', { clusterId: payload.clusterId });
  }

  private handleAuthRecovering(payload: DesktopEventPayload<'cluster:auth:recovering'>): void {
    if (!payload?.clusterId) {
      console.warn('[AuthErrorContext] Received auth:recovering without clusterId');
      return;
    }
    this.updateCluster(payload.clusterId, 'auth', (current) => ({
      ...current,
      auth: recoveringAuthState(current.auth, payload),
    }));
  }

  private handleAuthProgress(payload: DesktopEventPayload<'cluster:auth:progress'>): void {
    if (!payload?.clusterId) {
      return;
    }
    this.updateCluster(payload.clusterId, 'auth', (current) => {
      const auth = progressedAuthState(current.auth, payload);
      return auth && auth !== current.auth ? { ...current, auth } : current;
    });
  }

  private handleAuthRecovered(payload: DesktopEventPayload<'cluster:auth:recovered'>): void {
    if (!payload?.clusterId) {
      console.warn('[AuthErrorContext] Received auth:recovered without clusterId');
      return;
    }
    this.updateCluster(payload.clusterId, 'auth', (current) => ({
      ...current,
      auth: { ...DEFAULT_CLUSTER_AUTH_STATE, clusterName: current.clusterName },
    }));
    eventBus.emit('cluster:auth:recovered', { clusterId: payload.clusterId });
  }

  private handleHealth(
    payload: DesktopEventPayload<'cluster:health:healthy'>,
    health: ClusterHealthStatus
  ): void {
    if (!payload?.clusterId) {
      console.warn(`[ClusterHealthListener] Received health:${health} without clusterId`);
      return;
    }
    this.updateCluster(payload.clusterId, 'health', (current) =>
      current.health === health ? current : { ...current, health }
    );
  }

  private handleScopeChanged(payload: DesktopEventPayload<'cluster:scope:changed'>): void {
    const clusterId = payload?.clusterId ?? '';
    logAppLogsInfo(`namespace-scope: cluster:scope:changed received for "${clusterId}"`);
    if (!clusterId) {
      return;
    }
    this.updateCluster(clusterId, 'scope', (current) => ({
      ...current,
      scopeRevision: current.scopeRevision + 1,
    }));
    eventBus.emit('cluster:scope-changed', { clusterId });
  }

  private publish(next: ClusterWorkspaceSnapshot): void {
    this.snapshot = next;
    this.notifyListeners(this.listeners, (listener) => listener(), 'A snapshot listener failed');
  }

  private notifyListeners<T>(
    listeners: ReadonlySet<T>,
    notify: (listener: T) => void,
    failureMessage: string
  ): void {
    for (const listener of listeners) {
      try {
        notify(listener);
      } catch (error) {
        this.reportIsolationError(failureMessage, error);
      }
    }
  }

  private reportIsolationError(message: string, error: unknown): void {
    reportOperationalError(error, { source: 'ClusterWorkspaceStore', action: message });
  }

  isServiceable(clusterId: string | null | undefined): boolean {
    if (!clusterId) {
      return true;
    }
    const lifecycle = this.getCluster(clusterId)?.lifecycle;
    if (!lifecycle) {
      return !this.foregroundActivations.has(clusterId);
    }
    return serviceableStates.has(lifecycle) && !this.foregroundActivations.has(clusterId);
  }

  beginForegroundActivation(clusterId: string): void {
    const normalized = clusterId.trim();
    if (!normalized) {
      return;
    }
    const pending = this.foregroundActivations.get(normalized) ?? 0;
    this.foregroundActivations.set(normalized, pending + 1);
    if (pending === 0) {
      this.notifyListeners(
        this.activationListeners,
        (listener) => listener(normalized),
        'A foreground activation listener failed'
      );
    }
  }

  endForegroundActivation(clusterId: string): void {
    const normalized = clusterId.trim();
    if (!normalized) {
      return;
    }
    const pending = this.foregroundActivations.get(normalized) ?? 0;
    if (pending <= 1) {
      this.foregroundActivations.delete(normalized);
      if (pending === 1 && this.isServiceable(normalized)) {
        this.notifyListeners(
          this.serviceableListeners,
          (listener) => listener(normalized),
          'A serviceability listener failed'
        );
      }
    } else {
      this.foregroundActivations.set(normalized, pending - 1);
    }
  }

  onBecameServiceable(listener: (clusterId: string) => void): () => void {
    this.serviceableListeners.add(listener);
    return () => this.serviceableListeners.delete(listener);
  }

  onForegroundActivationStarted(listener: (clusterId: string) => void): () => void {
    this.activationListeners.add(listener);
    return () => this.activationListeners.delete(listener);
  }

  resetForTests(): void {
    this.authoritativeGeneration++;
    this.pendingHydrationFields.clear();
    this.foregroundActivations.clear();
    this.snapshot = emptySnapshot();
  }
}

const readClusterWorkspaceState = async (): Promise<ClusterWorkspaceWireState> =>
  (await GetClusterWorkspaceStateForWindow(
    getWindowIdentity()
  )) as unknown as ClusterWorkspaceWireState;

export const clusterWorkspaceStore = new ClusterWorkspaceStore({
  read: readClusterWorkspaceState,
  onEvent,
});
