import { CurrentObjectPanelContext } from '@modules/object-panel/hooks/useObjectPanel';
import type { Meta, StoryObj } from '@storybook/react';
import type { CustomResourceDetails } from '@/core/refresh/types';
import { SidebarProvidersDecorator } from '../../../../../../../.storybook/decorators/SidebarProvidersDecorator';
import { getOverviewDescriptor } from './descriptorRegistry';
import { OverviewRenderer } from './OverviewRenderer';
import '../DetailsTab.css';
import '../../shared.css';
import '@/App.css';

function KarpenterOverviewPreview({ detail }: Readonly<{ detail: CustomResourceDetails }>) {
  const descriptor = getOverviewDescriptor(detail.kind, detail);
  return (
    <CurrentObjectPanelContext.Provider
      value={{ objectData: null, panelId: null, creationTimestamp: '2026-09-01T12:00:00Z' }}
    >
      <div className="app">
        <div className="object-panel-section">
          <div className="object-panel-section-title">Overview</div>
          <div className="object-panel-section-grid">
            {descriptor && <OverviewRenderer descriptor={descriptor} data={detail as never} />}
          </div>
        </div>
      </div>
    </CurrentObjectPanelContext.Provider>
  );
}

const base: CustomResourceDetails = {
  ref: {
    clusterId: 'story-cluster',
    group: 'karpenter.sh',
    version: 'v1',
    kind: 'NodePool',
    name: 'general-purpose',
  },
  kind: 'NodePool',
  name: 'general-purpose',
  resourceFamily: 'karpenter',
  status: 'Ready',
  statusPresentation: 'ready',
  statusState: 'true',
  labels: { 'app.kubernetes.io/managed-by': 'Helm', team: 'platform' },
};
const pool: CustomResourceDetails = {
  ...base,
  karpenter: {
    nodeClass: {
      display: {
        clusterId: 'story-cluster',
        group: 'karpenter.k8s.aws',
        kind: 'EC2NodeClass',
        name: 'general-purpose',
      },
    },
    weight: 10,
    capacity: { cpu: '64', memory: '256Gi', nodes: '8', pods: '880' },
    limits: { cpu: '1000', memory: '2Ti' },
    requirements: [
      { key: 'kubernetes.io/arch', operator: 'In', values: ['amd64', 'arm64'] },
      { key: 'karpenter.sh/capacity-type', operator: 'In', values: ['spot', 'on-demand'] },
      { key: 'karpenter.k8s.aws/instance-category', operator: 'In', values: ['c', 'm', 'r'] },
      { key: 'karpenter.k8s.aws/instance-generation', operator: 'Gt', values: ['5'] },
    ],
    consolidationPolicy: 'WhenEmptyOrUnderutilized',
    consolidateAfter: '30s',
    expireAfter: '720h',
    terminationGracePeriod: '48h',
    budgets: [
      { nodes: '10%', reasons: ['Underutilized', 'Empty'] },
      { nodes: '0', reasons: ['Drifted'], schedule: '0 9 * * mon-fri', duration: '8h' },
    ],
    startupTaints: [{ key: 'node.cilium.io/agent-not-ready', value: 'true', effect: 'NoExecute' }],
  },
  conditions: [
    {
      type: 'Ready',
      status: 'True',
      reason: 'Ready',
      message: 'All dependencies are ready',
      lastTransitionTime: null,
    },
  ],
};

const meta: Meta<typeof KarpenterOverviewPreview> = {
  title: 'Object Panel/Karpenter Overview',
  component: KarpenterOverviewPreview,
  decorators: [SidebarProvidersDecorator],
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<typeof KarpenterOverviewPreview>;
export const NodePool: Story = { args: { detail: pool } };
export const SchedulingConstraints: Story = {
  args: {
    detail: {
      ...pool,
      karpenter: {
        ...pool.karpenter,
        requirements: [
          { key: 'kubernetes.io/arch', operator: 'In', values: ['amd64', 'arm64'] },
          { key: 'karpenter.k8s.aws/instance-category', operator: 'NotIn', values: ['t', 'a'] },
          { key: 'karpenter.k8s.aws/instance-generation', operator: 'Gt', values: ['5'] },
          { key: 'karpenter.k8s.aws/instance-cpu', operator: 'Lt', values: ['64'] },
          {
            key: 'node.kubernetes.io/instance-type',
            operator: 'In',
            values: [
              'm7g.large',
              'm7g.xlarge',
              'm7g.2xlarge',
              'c7g.large',
              'c7g.xlarge',
              'r7g.large',
            ],
            minValues: 2,
          },
          { key: 'topology.kubernetes.io/region', operator: 'Exists' },
          { key: 'workloads.example.com/do-not-schedule', operator: 'DoesNotExist' },
        ],
        taints: [
          { key: 'dedicated', value: 'batch', effect: 'NoSchedule' },
          {
            key: 'workloads.example.com/reserved-for-platform-services',
            effect: 'PreferNoSchedule',
          },
        ],
      },
    },
  },
};
export const NodeClaim: Story = {
  args: {
    detail: {
      ...base,
      kind: 'NodeClaim',
      name: 'general-purpose-7bhs2',
      ref: { ...base.ref, kind: 'NodeClaim', name: 'general-purpose-7bhs2' },
      karpenter: {
        nodePool: { ref: { ...base.ref } },
        nodeClass: pool.karpenter?.nodeClass,
        node: {
          ref: {
            clusterId: 'story-cluster',
            group: '',
            version: 'v1',
            kind: 'Node',
            name: 'ip-10-24-106-78.ec2.internal',
          },
        },
        instanceType: 'm7g.2xlarge',
        capacityType: 'spot',
        zone: 'us-west-2a',
        architecture: 'arm64',
        capacity: { cpu: '8', memory: '31326296Ki', pods: '58' },
        allocatable: { cpu: '7910m', memory: '29230744Ki', pods: '58' },
        providerID: 'aws:///us-west-2a/i-0123456789abcdef0',
        imageID: 'ami-0123456789abcdef0',
        expireAfter: '720h',
      },
      conditions: [
        {
          type: 'Ready',
          status: 'False',
          reason: 'NodeNotReady',
          message:
            'Node registered but has not reported Ready. Waiting for the network plugin to initialize and remove the startup taint.',
          lastTransitionTime: null,
        },
      ],
      status: 'NodeNotReady',
      statusPresentation: 'warning',
    },
  },
};
export const NodeClass: Story = {
  args: {
    detail: {
      ...base,
      kind: 'EC2NodeClass',
      ref: { ...base.ref, kind: 'EC2NodeClass', group: 'karpenter.k8s.aws' },
      karpenter: {
        imageFamily: 'AL2023',
        role: 'KarpenterNodeRole-production-us-west-2',
        instanceProfile: 'production_1234567890123456789',
        subnets: [
          'subnet-0123456789abcdef0',
          'subnet-abcdef01234567890',
          'subnet-0987654321abcdef0',
        ],
        securityGroups: ['sg-0123456789abcdef0', 'sg-abcdef01234567890'],
        images: ['ami-0123456789abcdef0', 'ami-abcdef01234567890'],
        tags: {
          Environment: 'production',
          'karpenter.sh/discovery': 'production-us-west-2',
          'cost-center': 'engineering-platform',
        },
      },
      conditions: pool.conditions,
    },
  },
};
export const NewlyCreated: Story = {
  args: {
    detail: {
      ...base,
      karpenter: {},
      labels: {},
      status: 'Unknown',
      statusPresentation: 'unknown',
    },
  },
};
