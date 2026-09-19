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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type CapabilityDescriptor, useCapabilities, useUserPermission } from '@/core/capabilities';
import {
  discoverNodeLogs,
  getCachedNodeLogDiscovery,
  type NodeLogSource,
} from '../NodeLogs/nodeLogsApi';

import {
  type CapabilityReasons,
  type CapabilityState,
  type CapabilityStates,
  type ComputedCapabilities,
  createEmptyCapabilityIdMap,
  type FeatureSupport,
  type NodeLogsState,
  type PanelObjectData,
} from '../types';

interface UseObjectPanelCapabilitiesOptions {
  objectData: PanelObjectData | null;
  objectKind: string | null;
  detailScope: string | null;
  featureSupport: FeatureSupport;
}

export interface ObjectPanelCapabilitiesResult {
  capabilityStates: CapabilityStates;
  capabilities: ComputedCapabilities;
  capabilityReasons: CapabilityReasons;
  nodeLogsState: NodeLogsState;
  nodeLogSources: NodeLogSource[];
}

const createCapabilityState = (override?: Partial<CapabilityState>): CapabilityState => ({
  allowed: false,
  pending: false,
  reason: undefined,
  ...override,
});

type CapabilityIdMap = ReturnType<typeof createEmptyCapabilityIdMap>;

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
  objectData: PanelObjectData | null,
  objectKind: string | null
): CapabilityDescriptorContext | null => {
  if (!objectData || !objectKind) {
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
  key?: keyof CapabilityIdMap
): void => {
  accumulator.descriptors.push({ ...accumulator.context, ...descriptor });
  if (key) {
    accumulator.idMap[key] = descriptor.id;
  }
};

const addObjectActionCapability = (
  accumulator: CapabilityDescriptorAccumulator,
  actionId: MutatingObjectActionId,
  key: keyof CapabilityIdMap
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

const addMutatingCapabilityDescriptors = (
  accumulator: CapabilityDescriptorAccumulator,
  featureSupport: FeatureSupport
): void => {
  if (featureSupport.delete) {
    addObjectActionCapability(accumulator, OBJECT_ACTION_IDS.delete, 'delete');
  }
  if (featureSupport.restart) {
    addObjectActionCapability(accumulator, OBJECT_ACTION_IDS.restart, 'restart');
  }
  if (featureSupport.scale) {
    addObjectActionCapability(accumulator, OBJECT_ACTION_IDS.scale, 'scale');
  }
  if (featureSupport.trigger) {
    addObjectActionCapability(accumulator, OBJECT_ACTION_IDS.triggerNow, 'trigger');
  }
  if (featureSupport.suspend) {
    addObjectActionCapability(accumulator, OBJECT_ACTION_IDS.suspend, 'suspend');
  }
};

const addFinalizerRemovalCapabilityDescriptors = (
  accumulator: CapabilityDescriptorAccumulator
): void => {
  addObjectActionCapability(accumulator, OBJECT_ACTION_IDS.removeFinalizer, 'removeFinalizer');

  const { group, version, resourceKind } = accumulator.context;
  const isCoreNamespace = group === '' && version === 'v1' && resourceKind === 'Namespace';
  if (isCoreNamespace) {
    addObjectActionCapability(
      accumulator,
      OBJECT_ACTION_IDS.removeNamespaceFinalizer,
      'removeNamespaceFinalizer'
    );
  }
};

const addLogsCapabilityDescriptor = (
  accumulator: CapabilityDescriptorAccumulator,
  objectKind: string,
  featureSupport: FeatureSupport
): void => {
  if (!featureSupport.objPanelLogs) {
    return;
  }
  const isPod = objectKind === 'pod';
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

const addShellCapabilityDescriptors = (
  accumulator: CapabilityDescriptorAccumulator,
  featureSupport: FeatureSupport
): void => {
  if (!featureSupport.shell) {
    return;
  }
  (['get', 'create'] as const).forEach((verb) => {
    addCapabilityDescriptor(
      accumulator,
      {
        id: `shell-exec-${verb}`,
        verb,
        subresource: 'exec',
      },
      verb === 'get' ? 'shellExecGet' : 'shellExecCreate'
    );
  });
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

const addHelmCapabilityDescriptors = (
  accumulator: CapabilityDescriptorAccumulator,
  featureSupport: FeatureSupport
): void => {
  const addRead = (id: string, key: keyof CapabilityIdMap): void => {
    addCapabilityDescriptor(
      accumulator,
      {
        id,
        verb: 'get',
      },
      key
    );
  };
  if (featureSupport.manifest) {
    addRead('view-manifest', 'viewManifest');
  }
  if (featureSupport.values) {
    addRead('view-values', 'viewValues');
  }
};

const computeCapabilityDescriptors = (
  objectData: PanelObjectData | null,
  objectKind: string | null,
  featureSupport: FeatureSupport
) => {
  const context = buildCapabilityDescriptorContext(objectData, objectKind);
  if (!context || !objectKind) {
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
  addMutatingCapabilityDescriptors(accumulator, featureSupport);
  addLogsCapabilityDescriptor(accumulator, objectKind, featureSupport);
  addShellCapabilityDescriptors(accumulator, featureSupport);
  addDebugCapabilityDescriptor(accumulator, featureSupport);
  addHelmCapabilityDescriptors(accumulator, featureSupport);
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
  objectKind: string | null,
  enabled: boolean
): NodeLogDiscoveryTarget | null => {
  const clusterId = objectData?.clusterId?.trim() ?? '';
  const nodeName = objectData?.name?.trim() ?? '';
  return objectKind === 'node' && enabled && clusterId && nodeName ? { clusterId, nodeName } : null;
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

const capabilityReason = (state: CapabilityState): string | undefined =>
  state.allowed ? undefined : state.reason;

const computeCapabilityReasons = (
  capabilityStates: CapabilityStates,
  nodeLogsCapabilityState: CapabilityState
): CapabilityReasons => ({
  nodeLogs: capabilityReason(nodeLogsCapabilityState),
  delete: capabilityReason(capabilityStates.delete),
  restart: capabilityReason(capabilityStates.restart),
  scale: capabilityReason(capabilityStates.scale),
  trigger: capabilityReason(capabilityStates.trigger),
  suspend: capabilityReason(capabilityStates.suspend),
  editYaml: capabilityReason(capabilityStates.editYaml),
  shell: capabilityReason(capabilityStates.shell),
  debug: capabilityReason(capabilityStates.debug),
});

export const useObjectPanelCapabilities = ({
  objectData,
  objectKind,
  detailScope,
  featureSupport,
}: UseObjectPanelCapabilitiesOptions): ObjectPanelCapabilitiesResult => {
  const [nodeLogSources, setNodeLogSources] = useState<NodeLogSource[]>([]);
  const [nodeLogsCapabilityState, setNodeLogsCapabilityState] = useState<CapabilityState>(
    createCapabilityState()
  );
  const capabilityDescriptorInfo = useMemo(
    () => computeCapabilityDescriptors(objectData, objectKind, featureSupport),
    [featureSupport, objectData, objectKind]
  );

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
    const shellExecGet = getCapabilityState(capabilityDescriptorInfo.idMap.shellExecGet);
    const shellExecCreate = getCapabilityState(capabilityDescriptorInfo.idMap.shellExecCreate);
    const shellAllowed = shellExecGet.allowed || shellExecCreate.allowed;
    const shellPending = shellExecGet.pending || shellExecCreate.pending;
    const shellReason = shellAllowed
      ? undefined
      : (shellExecGet.reason ?? shellExecCreate.reason ?? undefined);
    return {
      viewYaml: getCapabilityState(capabilityDescriptorInfo.idMap.viewYaml),
      editYaml: getCapabilityState(capabilityDescriptorInfo.idMap.editYaml),
      viewManifest: getCapabilityState(capabilityDescriptorInfo.idMap.viewManifest),
      viewValues: getCapabilityState(capabilityDescriptorInfo.idMap.viewValues),
      delete: getCapabilityState(capabilityDescriptorInfo.idMap.delete),
      restart: getCapabilityState(capabilityDescriptorInfo.idMap.restart),
      scale: getCapabilityState(capabilityDescriptorInfo.idMap.scale),
      trigger: getCapabilityState(capabilityDescriptorInfo.idMap.trigger),
      suspend: getCapabilityState(capabilityDescriptorInfo.idMap.suspend),
      shell: createCapabilityState({
        allowed: shellAllowed,
        pending: shellPending,
        reason: shellReason,
      }),
      debug: getCapabilityState(capabilityDescriptorInfo.idMap.debug),
      removeFinalizer: getCapabilityState(capabilityDescriptorInfo.idMap.removeFinalizer),
      removeNamespaceFinalizer: getCapabilityState(
        capabilityDescriptorInfo.idMap.removeNamespaceFinalizer
      ),
    };
  }, [capabilityDescriptorInfo.idMap, getCapabilityState]);

  const viewObjPanelLogsPermission = useUserPermission(
    'Pod',
    'get',
    objectData?.namespace ?? null,
    'log',
    objectData?.clusterId ?? null,
    '',
    'v1'
  );

  const nodeLogDiscoveryTarget = useMemo(
    () => resolveNodeLogDiscoveryTarget(objectData, objectKind, featureSupport.nodeLogs),
    [featureSupport.nodeLogs, objectData, objectKind]
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

  const capabilities = useMemo<ComputedCapabilities>(() => {
    const hasObjPanelLogs =
      objectKind === 'node'
        ? featureSupport.nodeLogs
        : featureSupport.objPanelLogs &&
          !(
            viewObjPanelLogsPermission &&
            !viewObjPanelLogsPermission.pending &&
            viewObjPanelLogsPermission.allowed === false
          );

    return {
      hasObjPanelLogs,
      hasNodeLogs: featureSupport.nodeLogs && nodeLogsCapabilityState.allowed,
      hasShell: featureSupport.shell && capabilityStates.shell.allowed,
      hasManifest: featureSupport.manifest,
      hasValues: featureSupport.values,
      canDelete: featureSupport.delete && capabilityStates.delete.allowed,
      canRestart: featureSupport.restart && capabilityStates.restart.allowed,
      canScale: featureSupport.scale && capabilityStates.scale.allowed,
      canEditYaml: featureSupport.edit && capabilityStates.editYaml.allowed,
      canTrigger: featureSupport.trigger && capabilityStates.trigger.allowed,
      canSuspend: featureSupport.suspend && capabilityStates.suspend.allowed,
    };
  }, [
    capabilityStates,
    featureSupport,
    nodeLogsCapabilityState.allowed,
    objectKind,
    viewObjPanelLogsPermission,
  ]);

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
