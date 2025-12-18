import { useCallback, useMemo } from 'react';

import { useCapabilities, useUserPermission, type CapabilityDescriptor } from '@/core/capabilities';

import {
  CapabilityReasons,
  CapabilityState,
  CapabilityStates,
  ComputedCapabilities,
  FeatureSupport,
  PanelObjectData,
  createEmptyCapabilityIdMap,
} from '../types';

interface UseObjectPanelCapabilitiesOptions {
  objectData: PanelObjectData | null;
  objectKind: string | null;
  detailScope: string | null;
  featureSupport: FeatureSupport;
  workloadKindApiNames: Record<string, string>;
}

export interface ObjectPanelCapabilitiesResult {
  capabilityStates: CapabilityStates;
  capabilities: ComputedCapabilities;
  capabilityReasons: CapabilityReasons;
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
});

const computeCapabilityDescriptors = (
  objectData: PanelObjectData | null,
  objectKind: string | null,
  featureSupport: FeatureSupport,
  workloadKindApiNames: Record<string, string>
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

  const descriptors: CapabilityDescriptor[] = [];
  const idMap = createEmptyCapabilityIdMap();

  const add = (descriptor: CapabilityDescriptor, key?: keyof typeof idMap) => {
    descriptors.push(descriptor);
    if (key) {
      idMap[key] = descriptor.id;
    }
  };

  add(
    {
      id: 'view-yaml',
      verb: 'get',
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
        resourceKind,
        namespace,
        name: resourceName,
      },
      'delete'
    );
  }

  if (featureSupport.restart) {
    const restartResourceKind = workloadKindApiNames[objectKind] ?? resourceKind;
    add(
      {
        id: 'restart',
        verb: 'patch',
        resourceKind: restartResourceKind,
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
          resourceKind,
          namespace,
          name: resourceName,
          subresource: 'log',
        },
        'viewLogs'
      );
    } else {
      add(
        {
          id: 'view-logs',
          verb: 'get',
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
        id: 'shell-exec',
        verb: 'create',
        resourceKind,
        namespace,
        name: resourceName,
        subresource: 'exec',
      },
      'shell'
    );
  }

  if (featureSupport.manifest) {
    add(
      {
        id: 'view-manifest',
        verb: 'get',
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
  workloadKindApiNames,
}: UseObjectPanelCapabilitiesOptions): ObjectPanelCapabilitiesResult => {
  const capabilityDescriptorInfo = useMemo(
    () =>
      computeCapabilityDescriptors(objectData, objectKind, featureSupport, workloadKindApiNames),
    [featureSupport, objectData, objectKind, workloadKindApiNames]
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
    return {
      viewYaml: getCapabilityState(capabilityDescriptorInfo.idMap.viewYaml),
      editYaml: getCapabilityState(capabilityDescriptorInfo.idMap.editYaml),
      viewManifest: getCapabilityState(capabilityDescriptorInfo.idMap.viewManifest),
      viewValues: getCapabilityState(capabilityDescriptorInfo.idMap.viewValues),
      delete: getCapabilityState(capabilityDescriptorInfo.idMap.delete),
      restart: getCapabilityState(capabilityDescriptorInfo.idMap.restart),
      scale: getCapabilityState(capabilityDescriptorInfo.idMap.scale),
      shell: getCapabilityState(capabilityDescriptorInfo.idMap.shell),
    };
  }, [capabilityDescriptorInfo.idMap, capabilitiesEnabled, getCapabilityState]);

  const viewLogsPermission = useUserPermission('Pod', 'get', objectData?.namespace ?? null, 'log');

  const capabilities = useMemo<ComputedCapabilities>(() => {
    const hasLogs =
      featureSupport.logs &&
      !(viewLogsPermission && !viewLogsPermission.pending && viewLogsPermission.allowed === false);

    return {
      hasLogs,
      hasShell: featureSupport.shell && capabilityStates.shell.allowed,
      hasManifest: featureSupport.manifest,
      hasValues: featureSupport.values,
      canDelete: featureSupport.delete && capabilityStates.delete.allowed,
      canRestart: featureSupport.restart && capabilityStates.restart.allowed,
      canScale: featureSupport.scale && capabilityStates.scale.allowed,
      canEditYaml: featureSupport.edit && capabilityStates.editYaml.allowed,
    };
  }, [capabilityStates, featureSupport, viewLogsPermission]);

  const capabilityReasons = useMemo<CapabilityReasons>(
    () => ({
      delete: capabilityStates.delete.reason,
      restart: capabilityStates.restart.reason,
      scale: capabilityStates.scale.reason,
      editYaml: capabilityStates.editYaml.reason,
      shell: capabilityStates.shell.reason,
    }),
    [
      capabilityStates.delete.reason,
      capabilityStates.editYaml.reason,
      capabilityStates.restart.reason,
      capabilityStates.scale.reason,
      capabilityStates.shell.reason,
    ]
  );

  return {
    capabilityStates,
    capabilities,
    capabilityReasons,
  };
};
