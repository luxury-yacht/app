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

const createDefaultCapabilityStates = (): CapabilityStates => ({
  viewYaml: createCapabilityState(),
  editYaml: createCapabilityState(),
  viewManifest: createCapabilityState(),
  viewValues: createCapabilityState(),
  delete: createCapabilityState(),
  restart: createCapabilityState(),
  scale: createCapabilityState(),
  trigger: createCapabilityState(),
  suspend: createCapabilityState(),
  shell: createCapabilityState(),
  debug: createCapabilityState(),
  removeFinalizer: createCapabilityState(),
  removeNamespaceFinalizer: createCapabilityState(),
});

type CapabilityIdMap = ReturnType<typeof createEmptyCapabilityIdMap>;

type CapabilityDescriptorContext = {
  resourceKind: string;
  namespace: string | undefined;
  resourceName: string | undefined;
  objectGroup: string | undefined;
  objectVersion: string | undefined;
  clusterId: string | undefined;
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
  if (!resourceKind) {
    return null;
  }
  return {
    resourceKind,
    namespace: normalizeOptionalIdentity(objectData.namespace),
    resourceName: normalizeOptionalIdentity(objectData.name),
    objectGroup: normalizeOptionalIdentity(objectData.group),
    objectVersion: normalizeOptionalIdentity(objectData.version),
    clusterId: normalizeOptionalIdentity(objectData.clusterId),
  };
};

const addCapabilityDescriptor = (
  accumulator: CapabilityDescriptorAccumulator,
  descriptor: CapabilityDescriptor,
  key?: keyof CapabilityIdMap
): void => {
  const { clusterId } = accumulator.context;
  accumulator.descriptors.push(clusterId ? { ...descriptor, clusterId } : descriptor);
  if (key) {
    accumulator.idMap[key] = descriptor.id;
  }
};

const addObjectActionCapability = (
  accumulator: CapabilityDescriptorAccumulator,
  actionId: MutatingObjectActionId,
  key: keyof CapabilityIdMap
): void => {
  const { clusterId, objectGroup, objectVersion, resourceKind, namespace, resourceName } =
    accumulator.context;
  const descriptor = buildObjectActionCapabilityDescriptor(actionId, {
    clusterId,
    group: objectGroup,
    version: objectVersion,
    kind: resourceKind,
    namespace,
    name: resourceName,
  });
  if (descriptor) {
    addCapabilityDescriptor(accumulator, descriptor, key);
  }
};

const addYamlCapabilityDescriptors = (accumulator: CapabilityDescriptorAccumulator): void => {
  const { objectGroup, objectVersion, resourceKind, namespace, resourceName } = accumulator.context;
  addCapabilityDescriptor(
    accumulator,
    {
      id: 'view-yaml',
      verb: 'get',
      group: objectGroup,
      version: objectVersion,
      resourceKind,
      namespace,
      name: resourceName,
    },
    'viewYaml'
  );
  addCapabilityDescriptor(
    accumulator,
    {
      id: 'edit-yaml',
      verb: 'patch',
      group: objectGroup,
      version: objectVersion,
      resourceKind,
      namespace,
      name: resourceName,
    },
    'editYaml'
  );
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

  const { objectGroup, objectVersion, resourceKind } = accumulator.context;
  const isCoreNamespace =
    (objectGroup ?? '') === '' && objectVersion === 'v1' && resourceKind === 'Namespace';
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
  const { objectGroup, objectVersion, resourceKind, namespace, resourceName } = accumulator.context;
  const isPod = objectKind === 'pod';
  addCapabilityDescriptor(
    accumulator,
    {
      id: 'view-logs',
      verb: 'get',
      group: isPod ? objectGroup : '',
      version: isPod ? objectVersion : 'v1',
      resourceKind: isPod ? resourceKind : 'Pod',
      namespace,
      name: isPod ? resourceName : undefined,
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
  const { objectGroup, objectVersion, resourceKind, namespace, resourceName } = accumulator.context;
  (['get', 'create'] as const).forEach((verb) => {
    addCapabilityDescriptor(
      accumulator,
      {
        id: `shell-exec-${verb}`,
        verb,
        group: objectGroup,
        version: objectVersion,
        resourceKind,
        namespace,
        name: resourceName,
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
      namespace: accumulator.context.namespace,
      name: accumulator.context.resourceName,
      subresource: 'ephemeralcontainers',
    },
    'debug'
  );
};

const addHelmCapabilityDescriptors = (
  accumulator: CapabilityDescriptorAccumulator,
  featureSupport: FeatureSupport
): void => {
  const { objectGroup, objectVersion, resourceKind, namespace, resourceName } = accumulator.context;
  const addRead = (id: string, key: keyof CapabilityIdMap): void => {
    addCapabilityDescriptor(
      accumulator,
      {
        id,
        verb: 'get',
        group: objectGroup,
        version: objectVersion,
        resourceKind,
        namespace,
        name: resourceName,
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
    if (!capabilitiesEnabled) {
      return createDefaultCapabilityStates();
    }
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
  }, [capabilityDescriptorInfo.idMap, capabilitiesEnabled, getCapabilityState]);

  const viewObjPanelLogsPermission = useUserPermission(
    'Pod',
    'get',
    objectData?.namespace ?? null,
    'log',
    objectData?.clusterId ?? null
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
