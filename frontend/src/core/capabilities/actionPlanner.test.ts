/**
 * frontend/src/core/capabilities/actionPlanner.test.ts
 *
 * Test suite for actionPlanner.
 * Covers key behaviors and edge cases for actionPlanner.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./bootstrap', async () => {
  const actual = await vi.importActual<typeof import('./bootstrap')>('./bootstrap');
  return {
    ...actual,
    registerNamespaceCapabilityDefinitions: vi.fn(),
  };
});

import { registerNamespaceCapabilityDefinitions, DEFAULT_CAPABILITY_TTL_MS } from './bootstrap';
import {
  ensureNamespaceActionCapabilities,
  isRestartableOwnerKind,
  resolveRestartableOwnerKind,
  RestartableOwnerKind,
  __testUtils,
} from './actionPlanner';

const registerMock = vi.mocked(registerNamespaceCapabilityDefinitions);

describe('capability action planner', () => {
  beforeEach(() => {
    registerMock.mockReset();
  });

  it('always registers pod delete and portforward capabilities even without owner kinds', () => {
    ensureNamespaceActionCapabilities({ namespace: 'default' });

    expect(registerMock).toHaveBeenCalledTimes(1);
    const [namespaceArg, definitionsArg, optionsArg] = registerMock.mock.calls[0];
    expect(namespaceArg).toBe('default');
    expect(optionsArg).toEqual({ force: false, ttlMs: DEFAULT_CAPABILITY_TTL_MS });
    expect(definitionsArg).toHaveLength(2);

    const deleteDefinition = definitionsArg.find((d) => d.descriptor.verb === 'delete');
    expect(deleteDefinition?.descriptor.resourceKind).toBe('Pod');
    expect(deleteDefinition?.descriptor.namespace).toBe('default');

    const portForwardDefinition = definitionsArg.find(
      (d) => d.descriptor.subresource === 'portforward'
    );
    expect(portForwardDefinition?.descriptor.resourceKind).toBe('Pod');
    expect(portForwardDefinition?.descriptor.verb).toBe('create');
    expect(portForwardDefinition?.descriptor.namespace).toBe('default');
  });

  it('adds restart requirements for restartable owner kinds and dedupes them', () => {
    ensureNamespaceActionCapabilities({
      namespace: 'kube-system',
      ownerKinds: ['Deployment', 'deployment', 'StatefulSet', 'ReplicaSet'],
    });

    expect(registerMock).toHaveBeenCalledTimes(1);
    const [, definitionsArg] = registerMock.mock.calls[0];
    const kinds = definitionsArg.map((definition) => ({
      kind: definition.descriptor.resourceKind,
      verb: definition.descriptor.verb,
      subresource: definition.descriptor.subresource,
      id: definition.descriptor.id,
    }));

    expect(kinds).toContainEqual({
      kind: 'Pod',
      verb: 'delete',
      subresource: undefined,
      id: 'namespace:pods:delete:kube-system',
    });
    expect(kinds).toContainEqual({
      kind: 'Pod',
      verb: 'create',
      subresource: 'portforward',
      id: 'namespace:pods:portforward:kube-system',
    });
    expect(kinds).toContainEqual({
      kind: 'Deployment',
      verb: 'patch',
      subresource: undefined,
      id: 'namespace:workloads:patch:kube-system',
    });
    expect(kinds).toContainEqual({
      kind: 'StatefulSet',
      verb: 'patch',
      subresource: undefined,
      id: 'namespace:statefulsets:patch:kube-system',
    });
    // No duplicates for deployment despite mixed casing
    const deploymentDefinitions = definitionsArg.filter(
      (definition) => definition.descriptor.resourceKind === 'Deployment'
    );
    expect(deploymentDefinitions).toHaveLength(1);
  });

  it('passes through the force option to the registry helper', () => {
    ensureNamespaceActionCapabilities({
      namespace: 'apps',
      ownerKinds: [],
      force: true,
    });

    expect(registerMock).toHaveBeenCalledWith('apps', expect.any(Array), {
      force: true,
      ttlMs: DEFAULT_CAPABILITY_TTL_MS,
    });
  });

  it('detects restartable owner kinds', () => {
    expect(isRestartableOwnerKind('Deployment')).toBe(true);
    expect(isRestartableOwnerKind('statefulset')).toBe(true);
    expect(isRestartableOwnerKind('DaemonSet')).toBe(true);
    expect(isRestartableOwnerKind('ReplicaSet')).toBe(false);
    expect(isRestartableOwnerKind(undefined)).toBe(false);
    expect(resolveRestartableOwnerKind('deployment')).toBe('Deployment');
    expect(resolveRestartableOwnerKind(' STATEFULSET ')).toBe('StatefulSet');
    expect(resolveRestartableOwnerKind('replicaset')).toBeNull();
  });

  it('plans unique descriptors with feature metadata for namespace actions', () => {
    const definitions = __testUtils.planNamespaceActionDefinitions({
      namespace: 'alpha',
      ownerKinds: new Set<RestartableOwnerKind>(['Deployment', 'StatefulSet']),
      actions: ['core.nodes.pod.delete', 'core.nodes.workload.restart'],
    });

    expect(definitions).toHaveLength(3);
    const ids = new Set(definitions.map((definition) => definition.descriptor.id));
    expect(ids.size).toBe(definitions.length);

    const podDelete = definitions.find(
      (definition) => definition.descriptor.resourceKind === 'Pod'
    );
    expect(podDelete?.descriptor.verb).toBe('delete');
    expect(podDelete?.descriptor.namespace).toBe('alpha');
    definitions.forEach((definition) => {
      expect(definition.feature).toBe('Nodes pod actions');
    });
  });
});
