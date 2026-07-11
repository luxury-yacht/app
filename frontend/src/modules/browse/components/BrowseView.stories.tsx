/**
 * frontend/src/modules/browse/components/BrowseView.stories.tsx
 *
 * Renders a realistic Browse view through the production GridTable surface.
 */

import type { Meta, StoryObj } from '@storybook/react';
import '@styles/components/gridtables.css';
import './BrowseView.css';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { FavoriteFilledIcon, FavoriteOutlineIcon } from '@shared/components/icons/FavoriteIcons';
import GridTable, { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { KeyboardProviderDecorator } from '../../../../.storybook/decorators/KeyboardProviderDecorator';

const noOp = () => undefined;

const KINDS = [
  { value: 'Deployment', label: 'Deployment' },
  { value: 'Pod', label: 'Pod' },
  { value: 'ReplicaSet', label: 'ReplicaSet' },
  { value: 'Service', label: 'Service' },
  { value: 'DaemonSet', label: 'DaemonSet' },
  { value: 'StatefulSet', label: 'StatefulSet' },
];

interface BrowseStoryRow {
  kind: string;
  name: string;
  ns: string;
  age: string;
}

const ROWS: BrowseStoryRow[] = [
  {
    kind: 'ReplicaSet',
    name: 'nginx-deployment-7fb96c846b',
    ns: 'default',
    age: '3d',
  },
  { kind: 'Deployment', name: 'nginx-deployment', ns: 'default', age: '3d' },
  { kind: 'StatefulSet', name: 'redis-master-0', ns: 'default', age: '5d' },
  { kind: 'ReplicaSet', name: 'coredns-5dd5756b68', ns: 'kube-system', age: '30d' },
  { kind: 'Deployment', name: 'coredns', ns: 'kube-system', age: '30d' },
  { kind: 'Pod', name: 'etcd-control-plane', ns: 'kube-system', age: '30d' },
  { kind: 'Pod', name: 'kube-apiserver', ns: 'kube-system', age: '30d' },
  { kind: 'DaemonSet', name: 'kube-proxy-xk9df', ns: 'kube-system', age: '30d' },
  { kind: 'ReplicaSet', name: 'metrics-server-6d94bc8694', ns: 'kube-system', age: '14d' },
  { kind: 'Deployment', name: 'cert-manager-webhook', ns: 'cert-manager', age: '10d' },
  { kind: 'Deployment', name: 'cert-manager-cainjector', ns: 'cert-manager', age: '10d' },
  { kind: 'Deployment', name: 'ingress-nginx-controller', ns: 'ingress-nginx', age: '7d' },
];

const COLUMNS: GridColumnDefinition<BrowseStoryRow>[] = [
  { key: 'kind', header: 'Kind', render: (row) => row.kind, sortable: true, width: 160 },
  { key: 'name', header: 'Name', render: (row) => row.name, sortable: true, width: 320 },
  { key: 'namespace', header: 'Namespace', render: (row) => row.ns, sortable: true, width: 220 },
  { key: 'age', header: 'Age', render: (row) => row.age, sortable: true, width: 120 },
];

function MockBrowseView({ isFavorited = false }: { isFavorited?: boolean }) {
  const favoriteAction: IconBarItem = {
    type: 'toggle',
    id: 'favorite',
    icon: isFavorited ? <FavoriteFilledIcon /> : <FavoriteOutlineIcon />,
    active: isFavorited,
    onClick: noOp,
    title: isFavorited ? 'Update or remove favorite' : 'Save as favorite',
  };
  return (
    <GridTable
      data={ROWS}
      columns={COLUMNS}
      keyExtractor={(row) => `${row.kind}:${row.ns}:${row.name}`}
      className="gridtable-browse"
      tableClassName="gridtable-browse"
      onSort={noOp}
      filters={{
        enabled: true,
        accessors: {
          getSearchText: (row) => [row.kind, row.name, row.ns],
          getKind: (row) => row.kind,
          getNamespace: (row) => row.ns,
        },
        options: {
          kinds: KINDS.map((kind) => kind.value),
          showKindDropdown: true,
          showNamespaceDropdown: false,
          preActions: [favoriteAction],
        },
      }}
    />
  );
}

const meta: Meta = {
  title: 'Views/BrowseView',
  decorators: [KeyboardProviderDecorator],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj;

/** Browse view — not favorited (outline heart). */
export const Default: Story = {
  render: () => <MockBrowseView />,
};

/** Browse view — favorited (filled heart, active state). */
export const Favorited: Story = {
  render: () => <MockBrowseView isFavorited />,
};
