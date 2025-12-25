/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/registry.test.tsx
 *
 * Test suite for registry.
 * Covers key behaviors and edge cases for registry.
 */

import React from 'react';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const makeComponentMock = (name: string) =>
  vi.fn((props: unknown) =>
    React.createElement('div', { 'data-component': name, 'data-props': JSON.stringify(props) })
  );

type ComponentMock = ReturnType<typeof vi.fn>;

const componentMocks: Record<string, ComponentMock> = {};

const registerMock = (name: string) => {
  const mock = makeComponentMock(name);
  componentMocks[name] = mock;
  return mock;
};

vi.mock('./ClusterResourceOverview', () => ({
  ClusterResourceOverview: registerMock('ClusterResourceOverview'),
}));

vi.mock('./NodeOverview', () => ({
  NodeOverview: registerMock('NodeOverview'),
}));

vi.mock('./ConfigMapOverview', () => ({
  ConfigMapOverview: registerMock('ConfigMapOverview'),
}));

vi.mock('./SecretOverview', () => ({
  SecretOverview: registerMock('SecretOverview'),
}));

vi.mock('./EndpointsOverview', () => ({
  EndpointSliceOverview: registerMock('EndpointSliceOverview'),
}));

vi.mock('./IngressOverview', () => ({
  IngressOverview: registerMock('IngressOverview'),
}));

vi.mock('./NetworkPolicyOverview', () => ({
  NetworkPolicyOverview: registerMock('NetworkPolicyOverview'),
}));

vi.mock('./ServiceOverview', () => ({
  ServiceOverview: registerMock('ServiceOverview'),
}));

vi.mock('./StorageOverview', () => ({
  StorageOverview: registerMock('StorageOverview'),
}));

vi.mock('./JobOverview', () => ({
  JobOverview: registerMock('JobOverview'),
}));

vi.mock('./PodOverview', () => ({
  PodOverview: registerMock('PodOverview'),
}));

vi.mock('./WorkloadOverview', () => ({
  WorkloadOverview: registerMock('WorkloadOverview'),
}));

vi.mock('./HelmOverview', () => ({
  HelmOverview: registerMock('HelmOverview'),
}));

vi.mock('./PolicyOverview', () => ({
  PolicyOverview: registerMock('PolicyOverview'),
}));

vi.mock('./RBACOverview', () => ({
  RBACOverview: registerMock('RBACOverview'),
}));

vi.mock('./GenericOverview', () => ({
  GenericOverview: registerMock('GenericOverview'),
}));

let registryModule: typeof import('./registry');

beforeAll(async () => {
  registryModule = await import('./registry');
});

beforeEach(() => {
  Object.values(componentMocks).forEach((mock) => mock.mockClear());
});

describe('overviewRegistry', () => {
  it('returns the generic overview when no component is registered for the kind', () => {
    const element = registryModule.overviewRegistry.renderComponent({
      kind: 'CustomResource',
      foo: 'bar',
    });

    expect(element.type).toBe(componentMocks.GenericOverview);
    expect(element.props).toMatchObject({ kind: 'CustomResource', foo: 'bar' });
  });

  it('maps config resources props before rendering', () => {
    const element = registryModule.overviewRegistry.renderComponent({
      kind: 'Secret',
      name: 'db-creds',
      namespace: 'prod',
    });

    expect(element.type).toBe(componentMocks.SecretOverview);
    expect(element.props).toEqual({
      secretDetails: {
        kind: 'Secret',
        name: 'db-creds',
        namespace: 'prod',
      },
    });
  });

  it('prefers provided detail props when mapping config resources', () => {
    const element = registryModule.overviewRegistry.renderComponent({
      kind: 'ConfigMap',
      configMapDetails: { name: 'settings', data: { mode: 'prod' } },
      namespace: 'prod',
    });

    expect(element.type).toBe(componentMocks.ConfigMapOverview);
    expect(element.props).toEqual({
      configMapDetails: { name: 'settings', data: { mode: 'prod' } },
    });
  });

  it('maps service, ingress, endpoint slices, and network policy payloads', () => {
    const serviceElement = registryModule.overviewRegistry.renderComponent({
      kind: 'Service',
      metadata: { name: 'api' },
      ports: [{ port: 80 }],
    });
    expect(serviceElement.type).toBe(componentMocks.ServiceOverview);
    expect(serviceElement.props).toEqual({
      serviceDetails: {
        kind: 'Service',
        metadata: { name: 'api' },
        ports: [{ port: 80 }],
      },
    });

    const ingressElement = registryModule.overviewRegistry.renderComponent({
      kind: 'Ingress',
      spec: { rules: [] },
    });
    expect(ingressElement.type).toBe(componentMocks.IngressOverview);
    expect(ingressElement.props).toEqual({
      ingressDetails: {
        kind: 'Ingress',
        spec: { rules: [] },
      },
    });

    const endpointsElement = registryModule.overviewRegistry.renderComponent({
      kind: 'EndpointSlice',
      slices: [],
    });
    expect(endpointsElement.type).toBe(componentMocks.EndpointSliceOverview);
    expect(endpointsElement.props).toEqual({
      endpointSliceDetails: {
        kind: 'EndpointSlice',
        slices: [],
      },
    });

    const networkPolicyElement = registryModule.overviewRegistry.renderComponent({
      kind: 'NetworkPolicy',
      spec: { podSelector: { app: 'web' } },
    });
    expect(networkPolicyElement.type).toBe(componentMocks.NetworkPolicyOverview);
    expect(networkPolicyElement.props).toEqual({
      networkPolicyDetails: {
        kind: 'NetworkPolicy',
        spec: { podSelector: { app: 'web' } },
      },
    });
  });

  it('exposes capabilities for registered kinds and defaults to delete for unknown kinds', () => {
    expect(registryModule.getResourceCapabilities('Secret')).toEqual({
      delete: true,
      edit: true,
    });
    expect(registryModule.getResourceCapabilities('Pod')).toEqual({
      delete: true,
      logs: true,
      exec: true,
    });
    expect(registryModule.getResourceCapabilities('custom.foo')).toEqual({ delete: true });
  });
});
