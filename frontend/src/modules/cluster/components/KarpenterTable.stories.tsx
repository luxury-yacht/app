import {
  type CustomResourceGridRow,
  useCustomResourceGridParts,
} from '@modules/browse/components/CustomResourceGridView';
import GridTable from '@shared/components/tables/GridTable';
import type { Meta, StoryObj } from '@storybook/react';
import { SidebarProvidersDecorator } from '../../../../.storybook/decorators/SidebarProvidersDecorator';
import { karpenterColumns } from './karpenterColumns';
import './ClusterViewCustom.css';

const ref = { clusterId: 'story-cluster', group: 'karpenter.sh', version: 'v1', namespace: '' };
const nodeClassRef = {
  ...ref,
  group: 'karpenter.k8s.aws',
  kind: 'EC2NodeClass',
  resource: 'ec2nodeclasses',
  name: 'general-purpose',
};
const rows: CustomResourceGridRow[] = [
  {
    ref: {
      ...ref,
      kind: 'EC2NodeClass',
      resource: 'ec2nodeclasses',
      group: 'karpenter.k8s.aws',
      name: 'general-purpose',
    },
    status: 'Ready',
    statusPresentation: 'ready',
    age: '12d',
  },
  {
    ref: { ...ref, kind: 'NodePool', resource: 'nodepools', name: 'general-purpose' },
    status: 'Ready',
    statusPresentation: 'ready',
    age: '12d',
    karpenter: {
      capacity: { cpu: '85', memory: '768Gi' },
      limits: { cpu: '100', memory: '1Ti' },
      nodeClass: {
        ref: nodeClassRef,
      },
    },
  },
  ...['4scmp', '7bhs2', 'm5gr6'].map((suffix) => ({
    ref: { ...ref, kind: 'NodeClaim', resource: 'nodeclaims', name: `general-purpose-${suffix}` },
    status: 'Ready',
    statusPresentation: 'ready',
    age: '2d',
    karpenter: {
      nodePool: {
        ref: { ...ref, kind: 'NodePool', resource: 'nodepools', name: 'general-purpose' },
      },
      nodeClass: {
        ref: nodeClassRef,
      },
      instanceType: 'm7g.2xlarge',
      capacityType: 'spot',
    },
  })),
];
function KarpenterTablePreview({ data = rows }: Readonly<{ data?: CustomResourceGridRow[] }>) {
  const parts = useCustomResourceGridParts();
  return (
    <GridTable
      data={data}
      columns={karpenterColumns(parts)}
      keyExtractor={parts.keyExtractor}
      tableClassName="cluster-custom-table"
    />
  );
}
const meta: Meta<typeof KarpenterTablePreview> = {
  title: 'Views/Karpenter Table',
  component: KarpenterTablePreview,
  decorators: [SidebarProvidersDecorator],
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj<typeof KarpenterTablePreview>;
export const Populated: Story = {};
export const Empty: Story = { args: { data: [] } };
