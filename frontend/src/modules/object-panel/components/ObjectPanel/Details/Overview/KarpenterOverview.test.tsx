import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CustomResourceDetails } from '@/core/refresh/types';
import { getOverviewDescriptor } from './descriptorRegistry';
import { OverviewRenderer } from './OverviewRenderer';

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: ({ kind, name }: { kind: string; name: string }) => (
    <span>
      {kind} {name}
    </span>
  ),
}));
vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({ ResourceMetadata: () => null }));
vi.mock('@shared/components/ObjectPanelLink', () => ({
  ObjectPanelLink: ({ objectRef }: { objectRef: { name: string } }) => (
    <button type="button">{objectRef.name}</button>
  ),
}));

const detail: CustomResourceDetails = {
  ref: { clusterId: 'a', group: 'karpenter.sh', version: 'v1', kind: 'NodePool', name: 'default' },
  kind: 'NodePool',
  name: 'default',
  resourceFamily: 'karpenter',
  status: 'Ready',
  statusState: 'true',
  statusPresentation: 'ready',
  karpenter: {
    weight: 0,
    replicas: 0,
    limits: { cpu: '1000' },
    consolidationPolicy: 'WhenEmptyOrUnderutilized',
    expireAfter: '720h',
    requirements: [{ key: 'kubernetes.io/arch', operator: 'In', values: ['arm64'] }],
  },
  conditions: [
    {
      type: 'Ready',
      status: 'True',
      reason: 'Ready',
      message: 'All dependencies ready',
      lastTransitionTime: null,
    },
  ],
};

describe('Karpenter overview', () => {
  it('renders backend resource fields including zero values and controller conditions', () => {
    const descriptor = getOverviewDescriptor('nodepool', detail);
    expect(descriptor).toBeDefined();
    if (!descriptor) {
      throw new Error('Karpenter descriptor missing');
    }
    const html = renderToStaticMarkup(
      <OverviewRenderer descriptor={descriptor} data={detail as never} />
    );
    for (const value of [
      'NodePool',
      'default',
      'Weight',
      'Replicas',
      '1000',
      'WhenEmptyOrUnderutilized',
      '720h',
      'arm64',
      'All dependencies ready',
    ]) {
      expect(html).toContain(value);
    }
  });
  it('renders claim relationships, capacities, constraints, and provider configuration', () => {
    const claim: CustomResourceDetails = {
      ...detail,
      kind: 'NodeClaim',
      karpenter: {
        nodePool: {
          ref: {
            clusterId: 'a',
            group: 'karpenter.sh',
            version: 'v1beta1',
            kind: 'NodePool',
            name: 'linked-pool',
          },
        },
        nodeClass: { display: { clusterId: 'a', kind: 'EC2NodeClass', name: 'display-class' } },
        capacity: { cpu: '4', memory: '16Gi' },
        allocatable: { cpu: '3920m' },
        instanceType: 'm7g.xlarge',
        capacityType: 'spot',
        zone: 'us-east-1a',
        taints: [{ key: 'dedicated', value: 'batch', effect: 'NoSchedule' }],
        startupTaints: [{ key: 'initializing', effect: 'NoExecute' }],
        budgets: [
          { nodes: '10%', reasons: ['Underutilized'], schedule: '0 9 * * *', duration: '1h' },
        ],
        subnets: ['subnet-123'],
        securityGroups: ['sg-123'],
        images: ['ami-123'],
        tags: { team: 'platform' },
      },
    };
    const descriptor = getOverviewDescriptor('NodeClaim', claim);
    if (!descriptor) {
      throw new Error('Karpenter descriptor missing');
    }
    const html = renderToStaticMarkup(
      <OverviewRenderer descriptor={descriptor} data={claim as never} />
    );
    for (const value of [
      'linked-pool',
      'display-class',
      '3920m',
      'm7g.xlarge',
      'spot',
      'dedicated=batch:NoSchedule',
      'initializing:NoExecute',
      '10%',
      'Underutilized',
      'subnet-123',
      'sg-123',
      'ami-123',
      'team: platform',
    ]) {
      expect(html).toContain(value);
    }
    expect(html).toContain('<button type="button">linked-pool</button>');
    expect(html).not.toContain('<button type="button">display-class</button>');
  });
  it('keeps colliding unknown kinds on the generic overview', () => {
    expect(getOverviewDescriptor('NodePool', { ...detail, resourceFamily: '' })).toBeUndefined();
  });
});
