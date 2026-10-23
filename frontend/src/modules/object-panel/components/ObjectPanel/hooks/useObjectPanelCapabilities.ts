/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.ts
 *
 * - Computes and provides capability states and permissions for the object panel.
 * - Utilizes capability descriptors and user permissions to determine allowed actions.
 * - Handles dynamic capability evaluation based on object data and feature support.
 * - Returns structured capability states, computed capabilities, and reasons for capability restrictions.
 */

import {
  buildObjectActionCapabilityDescriptor,
  type MutatingObjectActionId,
  OBJECT_ACTION_IDS,
} from '@shared/actions/objectActionContract';
import { lookupKindFacets } from '@shared/kinds/kindFacets';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type CapabilityDescriptor,
  NODE_SHELL_PERMISSIONS,
  queryNamespacesPermissions,
  useCapabilities,
} from '@/core/capabilities';
import {
  discoverNodeLogs,
  getCachedNodeLogDiscovery,
  type NodeLogSource,
} from '../NodeLogs/nodeLogsApi';
import { NODE_SHELL_POD_NAMESPACE } from '../Shell/nodeShell';

import {
  type CapabilityReasons,
  type CapabilityState,
  type CapabilityStates,
  type ComputedCapabilities,
  createEmptyCapabilityIdMap,
  type FeatureSupport,
  type PanelObjectData,
} from '../types';

interface UseObjectPanelCapabilitiesOptions {
  objectData: PanelObjectData | null;
  detailScope: string | null;
  featureSupport: FeatureSupport;
}

export interface ObjectPanelCapabilitiesResult {
  capabilityStates: CapabilityStates;
  capabilities: ComputedCapabilities;
  capabilityReasons: CapabilityReasons;
  nodeLogsState: CapabilityState;
  nodeLogSources: NodeLogSource[];
}

const createCapabilityState = (override?: Partial<CapabilityState>): CapabilityState => ({
  allowed: false,
  pending: false,
  reason: undefined,
  ...override,
});

type CapabilityIdMap = ReturnType<typeof createEmptyCapabilityIdMap>;
// Slots that hold one capability id; the shell requirement lists hold several.
type CapabilityIdSlot = Exclude<keyof CapabilityIdMap, 'shellAllOf' | 'shellAnyOf'>;

type CapabilityDescriptorContext = {
  clusterId: string;
  group: string;
  version: string;
  resourceKind: string;
  namespace: string | undefined;
  name: string;
};

type CapabilityDescriptorAccumulator = {
  descriptors: CapabilityDescriptor[];
  idMap: CapabilityIdMap;
  context: CapabilityDescriptorContext;
};

const normalizeOptionalIdentity = (value: string | null | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized || undefined;
};

const buildCapabilityDescriptorContext = (
  objectData: PanelObjectData | null
): CapabilityDescriptorContext | null => {
  if (!objectData) {
    return null;
  }
  const resourceKind = normalizeOptionalIdentity(objectData.kind);
  const clusterId = normalizeOptionalIdentity(objectData.clusterId);
  const version = normalizeOptionalIdentity(objectData.version);
  const name = normalizeOptionalIdentity(objectData.name);
  // The empty group identifies core resources; only an absent group is incomplete.
  const group = objectData.group?.trim();
  if (!resourceKind || !clusterId || !version || !name || group === undefined) {
    return null;
  }
  return {
    resourceKind,
    clusterId,
    group,
    version,
    name,
    namespace: normalizeOptionalIdentity(objectData.namespace),
  };
};

const addCapabilityDescriptor = (
  accumulator: CapabilityDescriptorAccumulator,
  descriptor: Pick<CapabilityDescriptor, 'id' | 'verb'> & Partial<CapabilityDescriptor>,
  key?: CapabilityIdSlot
): void => {
  accumulator.descriptors.push({ ...accumulator.context, ...descriptor });
  if (key) {
    accumulator.idMap[key] = descriptor.id;
  }
};

const addObjectActionCapability = (
  accumulator: CapabilityDescriptorAccumulator,
  actionId: MutatingObjectActionId,
  key: CapabilityIdSlot
): void => {
  const descriptor = buildObjectActionCapabilityDescriptor(actionId, {
    ...accumulator.context,
    kind: accumulator.context.resourceKind,
  });
  if (descriptor) {
    addCapabilityDescriptor(accumulator, descriptor, key);
  }
};

const addYamlCapabilityDescriptors = (accumulator: CapabilityDescriptorAccumulator): void => {
  addCapabilityDescriptor(accumulator, { id: 'view-yaml', verb: 'get' }, 'viewYaml');
  addCapabilityDescriptor(accumulator, { id: 'edit-yaml', verb: 'patch' }, 'editYaml');
};

const addFinalizerRemovalCapabilityDescriptors = (
  accumulator: CapabilityDescriptorAccumulator
): void => {
  addObjectActionCapability(accumulator, OBJECT_ACTION_IDS.removeFinalizer, 'removeFinalizer');

  const { group, version, resourceKind: kind } = accumulator.context;
  if (lookupKindFacets({ group, version, kind })?.actions.removeNamespaceFinalizer) {
    addObjectActionCapability(
      accumulator,
      OBJECT_ACTION_IDS.removeNamespaceFinalizer,
      'removeNamespaceFinalizer'
    );
  }
};

// Container logs are read from the pod itself, or from the pods the object owns.
const addLogsCapabilityDescriptor = (
  accumulator: CapabilityDescriptorAccumulator,
  featureSupport: FeatureSupport
): void => {
  if (featureSupport.logs !== 'pod' && featureSupport.logs !== 'owned-pods') {
    return;
  }
  const isPod = featureSupport.logs === 'pod';
  addCapabilityDescriptor(
    accumulator,
    {
      id: 'view-logs',
      verb: 'get',
      group: isPod ? accumulator.context.group : '',
      version: isPod ? accumulator.context.version : 'v1',
      resourceKind: isPod ? accumulator.context.resourceKind : 'Pod',
      name: isPod ? accumulator.context.name : undefined,
      subresource: 'log',
    },
    'viewObjPanelLogs'
  );
};

const addShellPermission = (
  accumulator: CapabilityDescriptorAccumulator,
  descriptor: Pick<CapabilityDescriptor, 'id' | 'verb'> & Partial<CapabilityDescriptor>,
  requirement: 'shellAllOf' | 'shellAnyOf'
): void => {
  addCapabilityDescriptor(accumulator, descriptor);
  accumulator.idMap[requirement].push(descriptor.id);
};

// A pod shell execs into the pod. Websocket exec upgrades a GET and SPDY a
// POST, so either verb on pods/exec suffices.
const addPodShellCapabilityDescriptors = (accumulator: CapabilityDescriptorAccumulator): void => {
  (['get', 'create'] as const).forEach((verb) => {
    addShellPermission(
      accumulator,
      { id: `shell-exec-${verb}`, verb, subresource: 'exec' },
      'shellAnyOf'
    );
  });
};

// A node shell creates, polls, attaches to, and finally deletes a debug pod in
// NODE_SHELL_POD_NAMESPACE — the backend's checks before it creates anything.
// The pod has no name yet, so these resolve from the namespace permission store
// (see useNodeShellPermissionQuery); the attach verbs are alternatives.
const addNodeShellCapabilityDescriptors = (accumulator: CapabilityDescriptorAccumulator): void => {
  NODE_SHELL_PERMISSIONS.specs.forEach(({ kind, verb, subresource }) => {
    addShellPermission(
      accumulator,
      {
        id: `node-shell-${subresource ?? 'pod'}-${verb}`,
        verb,
        group: '',
        version: 'v1',
        resourceKind: kind,
        namespace: NODE_SHELL_POD_NAMESPACE,
        name: undefined,
        subresource,
      },
      subresource ? 'shellAnyOf' : 'shellAllOf'
    );
  });
};

const nodeShellPermissionClusterId = (
  objectData: PanelObjectData | null,
  featureSupport: FeatureSupport
): string | null => {
  const context = buildCapabilityDescriptorContext(objectData);
  return featureSupport.shell === 'node' && context ? context.clusterId : null;
};

// Node panels never query the debug pod namespace for their own data, so the
// node shell checks are queried here, as the Pods tab does for node-scoped pods.
const useNodeShellPermissionQuery = (clusterId: string | null): void => {
  useEffect(() => {
    if (!clusterId) {
      return;
    }
    void queryNamespacesPermissions([{ namespace: NODE_SHELL_POD_NAMESPACE, clusterId }], {
      specLists: [NODE_SHELL_PERMISSIONS],
    });
  }, [clusterId]);
};

const addShellCapabilityDescriptors = (
  accumulator: CapabilityDescriptorAccumulator,
  featureSupport: FeatureSupport
): void => {
  if (featureSupport.shell === 'node') {
    addNodeShellCapabilityDescriptors(accumulator);
  } else if (featureSupport.shell === 'exec') {
    addPodShellCapabilityDescriptors(accumulator);
  }
};

const addDebugCapabilityDescriptor = (
  accumulator: CapabilityDescriptorAccumulator,
  featureSupport: FeatureSupport
): void => {
  if (!featureSupport.debug) {
    return;
  }
  addCapabilityDescriptor(
    accumulator,
    {
      id: 'debug-ephemeral',
      verb: 'update',
      group: '',
      version: 'v1',
      resourceKind: 'Pod',
      subresource: 'ephemeralcontainers',
    },
    'debug'
  );
};

const computeCapabilityDescriptors = (
  objectData: PanelObjectData | null,
  featureSupport: FeatureSupport
) => {
  const context = buildCapabilityDescriptorContext(objectData);
  if (!context) {
    return {
      descriptors: [] as CapabilityDescriptor[],
      idMap: createEmptyCapabilityIdMap(),
    };
  }
  const accumulator: CapabilityDescriptorAccumulator = {
    descriptors: [],
    idMap: createEmptyCapabilityIdMap(),
    context,
  };
  addYamlCapabilityDescriptors(accumulator);
  addFinalizerRemovalCapabilityDescriptors(accumulator);
  addLogsCapabilityDescriptor(accumulator, featureSupport);
  addShellCapabilityDescriptors(accumulator, featureSupport);
  addDebugCapabilityDescriptor(accumulator, featureSupport);
  return { descriptors: accumulator.descriptors, idMap: accumulator.idMap };
};

type NodeLogDiscoveryTarget = { clusterId: string; nodeName: string };

type NodeLogDiscoveryResponse = {
  supported: boolean;
  sources?: NodeLogSource[] | null;
  reason?: string | null;
};

type NodeLogCapabilityResult = {
  sources: NodeLogSource[];
  state: CapabilityState;
};

const resolveNodeLogDiscoveryTarget = (
  objectData: PanelObjectData | null,
  enabled: boolean
): NodeLogDiscoveryTarget | null => {
  const clusterId = objectData?.clusterId?.trim() ?? '';
  const nodeName = objectData?.name?.trim() ?? '';
  return enabled && clusterId && nodeName ? { clusterId, nodeName } : null;
};

const nodeLogCapabilityResult = (response: NodeLogDiscoveryResponse): NodeLogCapabilityResult => {
  const sources = Array.isArray(response.sources) ? response.sources : [];
  const allowed = Boolean(response.supported && sources.length > 0);
  return {
    sources,
    state: createCapabilityState({
      allowed,
      reason: allowed
        ? undefined
        : (response.reason ?? 'Node logs are not available for this node'),
    }),
  };
};

const nodeLogCapabilityFailure = (error: unknown): NodeLogCapabilityResult => ({
  sources: [],
  state: createCapabilityState({
    reason: error instanceof Error ? error.message : 'Failed to discover node logs',
  }),
});

// The shell is allowed when every required permission and at least one
// alternative is allowed; the reason names the first denial.
const combineShellCapabilityStates = (
  allOf: CapabilityState[],
  anyOf: CapabilityState[]
): CapabilityState => {
  const states = [...allOf, ...anyOf];
  const deniedRequirement = allOf.find((state) => !state.allowed);
  const anyAllowed = anyOf.length === 0 || anyOf.some((state) => state.allowed);
  const allowed = states.length > 0 && !deniedRequirement && anyAllowed;
  return createCapabilityState({
    allowed,
    pending: states.some((state) => state.pending),
    reason: allowed
      ? undefined
      : (deniedRequirement?.reason ?? anyOf.find((state) => state.reason)?.reason),
  });
};

const capabilityReason = (state: CapabilityState): string | undefined =>
  state.allowed ? undefined : state.reason;

const computeCapabilityReasons = (
  capabilityStates: CapabilityStates,
  nodeLogsCapabilityState: CapabilityState
): CapabilityReasons => ({
  nodeLogs: capabilityReason(nodeLogsCapabilityState),
  editYaml: capabilityReason(capabilityStates.editYaml),
  shell: capabilityReason(capabilityStates.shell),
  debug: capabilityReason(capabilityStates.debug),
});

export const useObjectPanelCapabilities = ({
  objectData,
  detailScope,
  featureSupport,
}: UseObjectPanelCapabilitiesOptions): ObjectPanelCapabilitiesResult => {
  const [nodeLogSources, setNodeLogSources] = useState<NodeLogSource[]>([]);
  const [nodeLogsCapabilityState, setNodeLogsCapabilityState] = useState<CapabilityState>(
    createCapabilityState()
  );
  const capabilityDescriptorInfo = useMemo(
    () => computeCapabilityDescriptors(objectData, featureSupport),
    [featureSupport, objectData]
  );
  useNodeShellPermissionQuery(nodeShellPermissionClusterId(objectData, featureSupport));

  const capabilityRefreshKey = useMemo(() => {
    if (detailScope) {
      return detailScope;
    }
    const fallbackKind = objectData?.kind ?? '';
    const fallbackName = objectData?.name ?? '';
    return `${fallbackKind}:${fallbackName}`;
  }, [detailScope, objectData?.kind, objectData?.name]);

  const capabilitiesEnabled =
    capabilityDescriptorInfo.descriptors.length > 0 && Boolean(objectData);

  const { getState: getCapabilityStateEntry } = useCapabilities(
    capabilityDescriptorInfo.descriptors,
    {
      enabled: capabilitiesEnabled,
      refreshKey: capabilityRefreshKey,
    }
  );

  const getCapabilityState = useCallback(
    (id?: string): CapabilityState => {
      if (!id || !capabilitiesEnabled) {
        return createCapabilityState();
      }
      const state = getCapabilityStateEntry(id);
      return createCapabilityState({
        allowed: Boolean(state.allowed),
        pending: Boolean(state.pending),
        reason: state.reason,
      });
    },
    [capabilitiesEnabled, getCapabilityStateEntry]
  );

  const capabilityStates = useMemo<CapabilityStates>(() => {
    const { shellAllOf, shellAnyOf } = capabilityDescriptorInfo.idMap;
    return {
      viewYaml: getCapabilityState(capabilityDescriptorInfo.idMap.viewYaml),
      editYaml: getCapabilityState(capabilityDescriptorInfo.idMap.editYaml),
      shell: combineShellCapabilityStates(
        shellAllOf.map((id) => getCapabilityState(id)),
        shellAnyOf.map((id) => getCapabilityState(id))
      ),
      debug: getCapabilityState(capabilityDescriptorInfo.idMap.debug),
      removeFinalizer: getCapabilityState(capabilityDescriptorInfo.idMap.removeFinalizer),
      removeNamespaceFinalizer: getCapabilityState(
        capabilityDescriptorInfo.idMap.removeNamespaceFinalizer
      ),
    };
  }, [capabilityDescriptorInfo.idMap, getCapabilityState]);

  // The Logs tab hides only on a settled denial of `view-logs`: named for a
  // pod, so per-pod grants count, and Pod-level for workloads.
  const viewObjPanelLogs = capabilitiesEnabled
    ? getCapabilityState(capabilityDescriptorInfo.idMap.viewObjPanelLogs)
    : null;

  const nodeLogsSupported = featureSupport.logs === 'node';
  const nodeLogDiscoveryTarget = useMemo(
    () => resolveNodeLogDiscoveryTarget(objectData, nodeLogsSupported),
    [nodeLogsSupported, objectData]
  );

  useEffect(() => {
    const applyResult = (result: NodeLogCapabilityResult): void => {
      setNodeLogSources(result.sources);
      setNodeLogsCapabilityState(result.state);
    };
    if (!nodeLogDiscoveryTarget) {
      setNodeLogSources([]);
      setNodeLogsCapabilityState(createCapabilityState());
      return;
    }

    const cachedDiscovery = getCachedNodeLogDiscovery(
      nodeLogDiscoveryTarget.clusterId,
      nodeLogDiscoveryTarget.nodeName
    );
    if (cachedDiscovery) {
      applyResult(nodeLogCapabilityResult(cachedDiscovery));
      return;
    }

    let cancelled = false;
    setNodeLogSources([]);
    setNodeLogsCapabilityState(createCapabilityState({ pending: true }));

    void discoverNodeLogs(nodeLogDiscoveryTarget.clusterId, nodeLogDiscoveryTarget.nodeName)
      .then((response) => {
        if (cancelled) {
          return;
        }
        applyResult(nodeLogCapabilityResult(response));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        applyResult(nodeLogCapabilityFailure(error));
      });

    return () => {
      cancelled = true;
    };
  }, [nodeLogDiscoveryTarget]);

  // A node's Logs tab shows its discovery state itself; container logs hide
  // only on a settled denial.
  const capabilities = useMemo<ComputedCapabilities>(() => {
    const containerLogs = featureSupport.logs === 'pod' || featureSupport.logs === 'owned-pods';
    const hasObjPanelLogs =
      featureSupport.logs === 'node' ||
      (containerLogs &&
        !(viewObjPanelLogs && !viewObjPanelLogs.pending && !viewObjPanelLogs.allowed));

    return {
      hasObjPanelLogs,
      hasShell: featureSupport.shell !== 'none' && capabilityStates.shell.allowed,
      canEditYaml: featureSupport.edit && capabilityStates.editYaml.allowed,
    };
  }, [capabilityStates, featureSupport, viewObjPanelLogs]);

  const capabilityReasons = useMemo<CapabilityReasons>(
    () => computeCapabilityReasons(capabilityStates, nodeLogsCapabilityState),
    [capabilityStates, nodeLogsCapabilityState]
  );

  return {
    capabilityStates,
    capabilities,
    capabilityReasons,
    nodeLogsState: nodeLogsCapabilityState,
    nodeLogSources,
  };
};
