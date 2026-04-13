/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.ts
 *
 * - Computes and provides capability states and permissions for the object panel.
 * - Utilizes capability descriptors and user permissions to determine allowed actions.
 * - Handles dynamic capability evaluation based on object data and feature support.
 * - Returns structured capability states, computed capabilities, and reasons for capability restrictions.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useCapabilities, useUserPermission, type CapabilityDescriptor } from '@/core/capabilities';
import {
  discoverNodeLogs,
  getCachedNodeLogDiscovery,
  type NodeLogSource,
} from '../NodeLogs/nodeLogsApi';

import {
  CapabilityReasons,
  CapabilityState,
  CapabilityStates,
  ComputedCapabilities,
  FeatureSupport,
  NodeLogsState,
  PanelObjectData,
  createEmptyCapabilityIdMap,
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
  shell: createCapabilityState(),
  debug: createCapabilityState(),
});

const computeCapabilityDescriptors = (
  objectData: PanelObjectData | null,
  objectKind: string | null,
  featureSupport: FeatureSupport
) => {
  if (!objectData || !objectKind) {
    return {
      descriptors: [] as CapabilityDescriptor[],
      idMap: createEmptyCapabilityIdMap(),
    };
  }

  const resourceKind = (objectData.kind ?? '').trim();
  if (!resourceKind) {
    return {
      descriptors: [] as CapabilityDescriptor[],
      idMap: createEmptyCapabilityIdMap(),
    };
  }

  const namespace =
    objectData.namespace && objectData.namespace.trim().length > 0
      ? objectData.namespace.trim()
      : undefined;
  const resourceName =
    objectData.name && objectData.name.trim().length > 0 ? objectData.name.trim() : undefined;

  // Group/version from the panel's object identity. When populated these
  // travel through every capability descriptor below so the backend's
  // permission resolver disambiguates colliding kinds (e.g. two different
  // DBInstance CRDs). Empty for legacy callers; the backend falls back
  // to kind-only resolution in that case.
  const objectGroup = objectData.group?.trim() ?? undefined;
  const objectVersion = objectData.version?.trim() ?? undefined;
  // Core/v1 Pod is hardcoded for a few cross-resource checks (log on a
  // non-pod workload, debug ephemeral containers). Those descriptors
  // target Pod regardless of what kind the object panel is showing, so
  // they use this fixed GVK rather than the object's group/version.
  const corePodGroup = '';
  const corePodVersion = 'v1';

  const descriptors: CapabilityDescriptor[] = [];
  const idMap = createEmptyCapabilityIdMap();
  const clusterId = objectData?.clusterId?.trim() || undefined;

  const add = (descriptor: CapabilityDescriptor, key?: keyof typeof idMap) => {
    descriptors.push(clusterId ? { ...descriptor, clusterId } : descriptor);
    if (key) {
      idMap[key] = descriptor.id;
    }
  };

  add(
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

  add(
    {
      id: 'edit-yaml',
      verb: 'update',
      group: objectGroup,
      version: objectVersion,
      resourceKind,
      namespace,
      name: resourceName,
    },
    'editYaml'
  );

  if (featureSupport.delete) {
    add(
      {
        id: 'delete',
        verb: 'delete',
        group: objectGroup,
        version: objectVersion,
        resourceKind,
        namespace,
        name: resourceName,
      },
      'delete'
    );
  }

  if (featureSupport.restart) {
    // resourceKind is the original-case Kind from PanelObjectData (e.g.
    // "Deployment"). The previous fallback through WORKLOAD_KIND_API_NAMES
    // existed only as a casing safety net for callers that supplied
    // lowercase kinds; that map is retired now that every entry point
    // threads PascalCase kinds via the data source.
    add(
      {
        id: 'restart',
        verb: 'patch',
        group: objectGroup,
        version: objectVersion,
        resourceKind,
        namespace,
        name: resourceName,
      },
      'restart'
    );
  }

  if (featureSupport.scale) {
    add(
      {
        id: 'scale',
        verb: 'patch',
        group: objectGroup,
        version: objectVersion,
        resourceKind,
        namespace,
        name: resourceName,
        subresource: 'scale',
      },
      'scale'
    );
  }

  if (featureSupport.logs) {
    if (objectKind === 'pod') {
      add(
        {
          id: 'view-logs',
          verb: 'get',
          group: objectGroup,
          version: objectVersion,
          resourceKind,
          namespace,
          name: resourceName,
          subresource: 'log',
        },
        'viewLogs'
      );
    } else {
      // Non-pod workloads get a pod-log check against core/v1 Pod.
      add(
        {
          id: 'view-logs',
          verb: 'get',
          group: corePodGroup,
          version: corePodVersion,
          resourceKind: 'Pod',
          namespace,
          subresource: 'log',
        },
        'viewLogs'
      );
    }
  }

  if (featureSupport.shell) {
    add(
      {
        id: 'shell-exec-get',
        verb: 'get',
        group: objectGroup,
        version: objectVersion,
        resourceKind,
        namespace,
        name: resourceName,
        subresource: 'exec',
      },
      'shellExecGet'
    );
    add(
      {
        id: 'shell-exec-create',
        verb: 'create',
        group: objectGroup,
        version: objectVersion,
        resourceKind,
        namespace,
        name: resourceName,
        subresource: 'exec',
      },
      'shellExecCreate'
    );
  }

  if (featureSupport.debug) {
    // Debug ephemeral containers always targets core/v1 Pod, regardless
    // of what kind the panel is displaying.
    add(
      {
        id: 'debug-ephemeral',
        verb: 'update',
        group: corePodGroup,
        version: corePodVersion,
        resourceKind: 'Pod',
        namespace,
        name: resourceName,
        subresource: 'ephemeralcontainers',
      },
      'debug'
    );
  }

  if (featureSupport.manifest) {
    add(
      {
        id: 'view-manifest',
        verb: 'get',
        group: objectGroup,
        version: objectVersion,
        resourceKind,
        namespace,
        name: resourceName,
      },
      'viewManifest'
    );
  }

  if (featureSupport.values) {
    add(
      {
        id: 'view-values',
        verb: 'get',
        group: objectGroup,
        version: objectVersion,
        resourceKind,
        namespace,
        name: resourceName,
      },
      'viewValues'
    );
  }

  return { descriptors, idMap };
};

export const useObjectPanelCapabilities = ({
  objectData,
  objectKind,
  detailScope,
  featureSupport,
}: UseObjectPanelCapabilitiesOptions): ObjectPanelCapabilitiesResult => {
  const [nodeLogSources, setNodeLogSources] = useState<NodeLogSource[]>([]);
  const [nodeLogsCapabilityState, setNodeLogsCapabilityState] =
    useState<CapabilityState>(createCapabilityState());
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
      shell: createCapabilityState({
        allowed: shellAllowed,
        pending: shellPending,
        reason: shellReason,
      }),
      debug: getCapabilityState(capabilityDescriptorInfo.idMap.debug),
    };
  }, [capabilityDescriptorInfo.idMap, capabilitiesEnabled, getCapabilityState]);

  const viewLogsPermission = useUserPermission(
    'Pod',
    'get',
    objectData?.namespace ?? null,
    'log',
    objectData?.clusterId ?? null
  );
  const nodeLogsPermission = useUserPermission(
    'Node',
    'get',
    null,
    'proxy',
    objectData?.clusterId ?? null
  );
  const nodeLogsPermissionPending = Boolean(nodeLogsPermission?.pending);
  const nodeLogsPermissionAllowed = nodeLogsPermission?.allowed;
  const nodeLogsPermissionReason = nodeLogsPermission?.reason;

  useEffect(() => {
    const isNodePanel = objectKind === 'node';
    const clusterId = objectData?.clusterId?.trim() ?? '';
    const nodeName = objectData?.name?.trim() ?? '';

    if (!isNodePanel || !featureSupport.nodeLogs || !clusterId || !nodeName) {
      setNodeLogSources([]);
      setNodeLogsCapabilityState(createCapabilityState());
      return;
    }

    if (nodeLogsPermissionPending) {
      setNodeLogSources([]);
      setNodeLogsCapabilityState(createCapabilityState({ pending: true }));
      return;
    }

    if (nodeLogsPermissionAllowed === false) {
      setNodeLogSources([]);
      setNodeLogsCapabilityState(
        createCapabilityState({
          reason:
            nodeLogsPermissionReason ?? 'Node logs are not accessible with the current permissions',
        })
      );
      return;
    }

    const cachedDiscovery = getCachedNodeLogDiscovery(clusterId, nodeName);
    if (cachedDiscovery) {
      const sources = Array.isArray(cachedDiscovery.sources) ? cachedDiscovery.sources : [];
      setNodeLogSources(sources);
      setNodeLogsCapabilityState(
        createCapabilityState({
          allowed: Boolean(cachedDiscovery.supported && sources.length > 0),
          pending: false,
          reason:
            cachedDiscovery.supported && sources.length > 0
              ? undefined
              : (cachedDiscovery.reason ?? 'Node logs are not available for this node'),
        })
      );
      return;
    }

    let cancelled = false;
    setNodeLogSources([]);
    setNodeLogsCapabilityState(createCapabilityState({ pending: true }));

    void discoverNodeLogs(clusterId, nodeName)
      .then((response) => {
        if (cancelled) {
          return;
        }
        const sources = Array.isArray(response.sources) ? response.sources : [];
        setNodeLogSources(sources);
        setNodeLogsCapabilityState(
          createCapabilityState({
            allowed: Boolean(response.supported && sources.length > 0),
            pending: false,
            reason:
              response.supported && sources.length > 0
                ? undefined
                : (response.reason ?? 'Node logs are not available for this node'),
          })
        );
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setNodeLogSources([]);
        setNodeLogsCapabilityState(
          createCapabilityState({
            reason: error instanceof Error ? error.message : 'Failed to discover node logs',
          })
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    featureSupport.nodeLogs,
    nodeLogsPermissionAllowed,
    nodeLogsPermissionPending,
    nodeLogsPermissionReason,
    objectData?.clusterId,
    objectData?.name,
    objectKind,
  ]);

  const capabilities = useMemo<ComputedCapabilities>(() => {
    const hasLogs =
      objectKind === 'node'
        ? featureSupport.nodeLogs
        : featureSupport.logs &&
          !(
            viewLogsPermission &&
            !viewLogsPermission.pending &&
            viewLogsPermission.allowed === false
          );

    return {
      hasLogs,
      hasNodeLogs: featureSupport.nodeLogs && nodeLogsCapabilityState.allowed,
      hasShell: featureSupport.shell && capabilityStates.shell.allowed,
      hasManifest: featureSupport.manifest,
      hasValues: featureSupport.values,
      canDelete: featureSupport.delete && capabilityStates.delete.allowed,
      canRestart: featureSupport.restart && capabilityStates.restart.allowed,
      canScale: featureSupport.scale && capabilityStates.scale.allowed,
      canEditYaml: featureSupport.edit && capabilityStates.editYaml.allowed,
      canTrigger: featureSupport.trigger,
      canSuspend: featureSupport.suspend,
    };
  }, [
    capabilityStates,
    featureSupport,
    nodeLogsCapabilityState.allowed,
    objectKind,
    viewLogsPermission,
  ]);

  const capabilityReasons = useMemo<CapabilityReasons>(
    () => ({
      nodeLogs: nodeLogsCapabilityState.allowed ? undefined : nodeLogsCapabilityState.reason,
      delete: capabilityStates.delete.allowed ? undefined : capabilityStates.delete.reason,
      restart: capabilityStates.restart.allowed ? undefined : capabilityStates.restart.reason,
      scale: capabilityStates.scale.allowed ? undefined : capabilityStates.scale.reason,
      editYaml: capabilityStates.editYaml.allowed ? undefined : capabilityStates.editYaml.reason,
      shell: capabilityStates.shell.allowed ? undefined : capabilityStates.shell.reason,
      debug: capabilityStates.debug.allowed ? undefined : capabilityStates.debug.reason,
    }),
    [
      capabilityStates.delete.allowed,
      capabilityStates.delete.reason,
      capabilityStates.debug.allowed,
      capabilityStates.debug.reason,
      capabilityStates.editYaml.allowed,
      capabilityStates.editYaml.reason,
      capabilityStates.restart.allowed,
      capabilityStates.restart.reason,
      capabilityStates.scale.allowed,
      capabilityStates.scale.reason,
      capabilityStates.shell.allowed,
      capabilityStates.shell.reason,
      nodeLogsCapabilityState.allowed,
      nodeLogsCapabilityState.reason,
    ]
  );

  return {
    capabilityStates,
    capabilities,
    capabilityReasons,
    nodeLogsState: nodeLogsCapabilityState,
    nodeLogSources,
  };
};
