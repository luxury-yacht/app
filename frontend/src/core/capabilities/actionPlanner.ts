/**
 * frontend/src/core/capabilities/actionPlanner.ts
 *
 * Namespace-scoped action capability planner and registrar.
 * Provides functions to plan and register capabilities for
 * namespace-scoped actions such as pod deletion and workload restarts.
 */

import { DEFAULT_CAPABILITY_TTL_MS, registerNamespaceCapabilityDefinitions } from './bootstrap';
import type { CapabilityDefinition } from './catalog';
import { createCapabilityKey, normalizeDescriptor } from './utils';

const NODES_ACTION_FEATURE = 'Nodes pod actions';

const RESTARTABLE_OWNER_KIND_LOOKUP = {
  deployment: 'Deployment',
  statefulset: 'StatefulSet',
  daemonset: 'DaemonSet',
} as const;

export type RestartableOwnerKind =
  (typeof RESTARTABLE_OWNER_KIND_LOOKUP)[keyof typeof RESTARTABLE_OWNER_KIND_LOOKUP];

export const resolveRestartableOwnerKind = (
  value: string | null | undefined
): RestartableOwnerKind | null => {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return (
    RESTARTABLE_OWNER_KIND_LOOKUP[normalized as keyof typeof RESTARTABLE_OWNER_KIND_LOOKUP] ?? null
  );
};

export const isRestartableOwnerKind = (
  value: string | null | undefined
): value is RestartableOwnerKind => resolveRestartableOwnerKind(value) != null;

const podDeleteDefinition = (namespace: string): CapabilityDefinition => {
  const descriptorId = `namespace:pods:delete:${namespace}`;
  return {
    id: descriptorId,
    scope: 'namespace',
    feature: NODES_ACTION_FEATURE,
    descriptor: {
      id: descriptorId,
      resourceKind: 'Pod',
      verb: 'delete',
      namespace,
    },
  };
};

const ownerRestartDefinition = (
  namespace: string,
  ownerKind: RestartableOwnerKind
): CapabilityDefinition | null => {
  const baseIdMap: Record<RestartableOwnerKind, string> = {
    Deployment: 'namespace:workloads',
    StatefulSet: 'namespace:statefulsets',
    DaemonSet: 'namespace:daemonsets',
  };

  const baseId = baseIdMap[ownerKind];
  if (!baseId) {
    return null;
  }

  const descriptorId = `${baseId}:patch:${namespace}`;
  return {
    id: descriptorId,
    scope: 'namespace',
    feature: NODES_ACTION_FEATURE,
    descriptor: {
      id: descriptorId,
      resourceKind: ownerKind,
      verb: 'patch',
      namespace,
    },
  };
};

export type CapabilityActionId = 'core.nodes.pod.delete' | 'core.nodes.workload.restart';

interface NamespaceActionBuildContext {
  namespace: string;
  ownerKinds: ReadonlySet<RestartableOwnerKind>;
}

interface NamespaceActionDefinition {
  id: CapabilityActionId;
  build: (context: NamespaceActionBuildContext) => CapabilityDefinition[];
}

const ACTION_REGISTRY = new Map<CapabilityActionId, NamespaceActionDefinition>();

const registerNamespaceAction = (definition: NamespaceActionDefinition) => {
  ACTION_REGISTRY.set(definition.id, definition);
};

registerNamespaceAction({
  id: 'core.nodes.pod.delete',
  build: ({ namespace }) => [podDeleteDefinition(namespace)],
});

registerNamespaceAction({
  id: 'core.nodes.workload.restart',
  build: ({ namespace, ownerKinds }) => {
    if (ownerKinds.size === 0) {
      return [];
    }

    const definitions: CapabilityDefinition[] = [];
    ownerKinds.forEach((ownerKind) => {
      const definition = ownerRestartDefinition(namespace, ownerKind);
      if (definition) {
        definitions.push(definition);
      }
    });
    return definitions;
  },
});

const DEFAULT_ACTIONS: CapabilityActionId[] = [
  'core.nodes.pod.delete',
  'core.nodes.workload.restart',
];

interface PlanNamespaceActionsInput {
  namespace: string;
  ownerKinds: ReadonlySet<RestartableOwnerKind>;
  actions: CapabilityActionId[];
  clusterId?: string | null;
}

const planNamespaceActionDefinitions = ({
  namespace,
  ownerKinds,
  actions,
  clusterId,
}: PlanNamespaceActionsInput): CapabilityDefinition[] => {
  const collected = new Map<string, CapabilityDefinition>();

  const addDefinition = (definition: CapabilityDefinition) => {
    const normalized = normalizeDescriptor({
      ...definition.descriptor,
      clusterId: definition.descriptor.clusterId ?? clusterId ?? undefined,
      namespace: definition.descriptor.namespace ?? namespace,
    });
    const key = createCapabilityKey(normalized);
    if (collected.has(key)) {
      return;
    }
    collected.set(key, {
      ...definition,
      descriptor: {
        id: normalized.id,
        verb: normalized.verb,
        resourceKind: normalized.resourceKind,
        namespace: normalized.namespace,
        name: normalized.name,
        subresource: normalized.subresource,
      },
    });
  };

  actions.forEach((actionId) => {
    const definition = ACTION_REGISTRY.get(actionId);
    if (!definition) {
      return;
    }
    const definitions = definition.build({ namespace, ownerKinds });
    definitions.forEach(addDefinition);
  });

  addDefinition(podDeleteDefinition(namespace));

  return Array.from(collected.values());
};

export interface EnsureNamespaceActionCapabilitiesOptions {
  namespace: string;
  ownerKinds?: Iterable<string | null | undefined>;
  actions?: CapabilityActionId[];
  force?: boolean;
  ttlMs?: number;
  clusterId?: string | null;
}

export const ensureNamespaceActionCapabilities = ({
  namespace,
  ownerKinds,
  actions = DEFAULT_ACTIONS,
  force = false,
  ttlMs,
  clusterId,
}: EnsureNamespaceActionCapabilitiesOptions): void => {
  const trimmed = namespace?.trim();
  if (!trimmed) {
    return;
  }

  const normalizedOwners = new Set<RestartableOwnerKind>();
  if (ownerKinds) {
    for (const owner of ownerKinds) {
      const normalized = resolveRestartableOwnerKind(owner);
      if (normalized) {
        normalizedOwners.add(normalized);
      }
    }
  }

  const definitions = planNamespaceActionDefinitions({
    namespace: trimmed,
    ownerKinds: normalizedOwners,
    actions,
    clusterId,
  });

  if (definitions.length === 0) {
    return;
  }

  const resolvedClusterId = clusterId?.trim();
  registerNamespaceCapabilityDefinitions(trimmed, definitions, {
    force,
    ttlMs: ttlMs ?? DEFAULT_CAPABILITY_TTL_MS,
    ...(resolvedClusterId ? { clusterId: resolvedClusterId } : {}),
  });
};

export const __testUtils = {
  planNamespaceActionDefinitions,
};
