/**
 * frontend/src/modules/browse/components/BrowseView.stories.tsx
 *
 * Renders a realistic Browse view mockup using real GridTableFiltersBar
 * and GridTableLayout to verify the IconBar integration and heart icon placement.
 */

import type { Meta, StoryObj } from '@storybook/react';
import '@styles/components/gridtables.css';
import './BrowseView.css';
import GridTableFiltersBar from '@shared/components/tables/GridTableFiltersBar';
import GridTableLayout from '@shared/components/tables/GridTableLayout';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import {
  LoadMoreIcon,
  FavoriteOutlineIcon,
  FavoriteFilledIcon,
} from '@shared/components/icons/MenuIcons';
import { KeyboardProviderDecorator } from '../../../../.storybook/decorators/KeyboardProviderDecorator';

// Column widths matching the real BrowseView (from useBrowseColumns.tsx)
const COL_KIND = 160;
const COL_NAME = 320;
const COL_NS = 220;
const COL_AGE = 120;

const noOp = () => {};
const renderOption = (option: { value: string; label: string }) => <span>{option.label}</span>;
const renderValue = () => <span>All kinds</span>;
const renderColumnsValue = () => <span>Columns</span>;

const KINDS = [
  { value: 'Deployment', label: 'Deployment' },
  { value: 'Pod', label: 'Pod' },
  { value: 'ReplicaSet', label: 'ReplicaSet' },
  { value: 'Service', label: 'Service' },
  { value: 'DaemonSet', label: 'DaemonSet' },
  { value: 'StatefulSet', label: 'StatefulSet' },
];

const COLUMNS = [
  { value: 'kind', label: 'Kind' },
  { value: 'name', label: 'Name' },
  { value: 'namespace', label: 'Namespace' },
  { value: 'age', label: 'Age' },
];

const ROWS = [
  {
    kind: 'ReplicaSet',
    name: 'nginx-deployment-7fb96c846b',
    ns: 'default',
    age: '3d',
    focused: true,
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

function MockBrowseView({ isFavorited = false }: { isFavorited?: boolean }) {
  const favoriteAction: IconBarItem = {
    type: 'toggle',
    id: 'favorite',
    icon: isFavorited ? <FavoriteFilledIcon /> : <FavoriteOutlineIcon />,
    active: isFavorited,
    onClick: noOp,
    title: isFavorited ? 'Update or remove favorite' : 'Save as favorite',
  };
  const loadMoreAction: IconBarItem = {
    type: 'action',
    id: 'load-more',
    icon: <LoadMoreIcon />,
    onClick: noOp,
    title: 'Load more',
  };
  const filtersNode = (
    <GridTableFiltersBar
      activeFilters={{ search: '', kinds: [], namespaces: [], caseSensitive: false }}
      resolvedFilterOptions={{
        kinds: KINDS,
        namespaces: [],
        searchPlaceholder: 'Search resources',
      }}
      kindDropdownId="kind"
      namespaceDropdownId="ns"
      searchInputId="search"
      onKindsChange={noOp}
      onNamespacesChange={noOp}
      onSearchChange={noOp}
      onReset={noOp}
      onToggleCaseSensitive={noOp}
      renderOption={renderOption}
      renderKindsValue={renderValue}
      renderNamespacesValue={renderValue}
      renderColumnsValue={renderColumnsValue}
      showKindDropdown
      showColumnsDropdown
      columnOptions={COLUMNS}
      columnValue={['kind', 'name', 'namespace', 'age']}
      onColumnsChange={noOp}
      resultCount={{ displayed: ROWS.length, total: ROWS.length }}
      preActions={[favoriteAction]}
      postActions={[loadMoreAction]}
    />
  );

  const headerNode = (
    <div className="gridtable-header-container">
      <div className="gridtable gridtable--header gridtable-browse">
        <div className="gridtable-header">
          <div className="grid-cell-header" style={{ width: COL_KIND }} data-sortable="true">
            <div className="header-content">
              <span>Kind</span>
            </div>
          </div>
          <div className="grid-cell-header" style={{ width: COL_NAME }} data-sortable="true">
            <div className="header-content">
              <span>Name</span>
            </div>
          </div>
          <div className="grid-cell-header" style={{ width: COL_NS }} data-sortable="true">
            <div className="header-content">
              <span>Namespace</span>
            </div>
          </div>
          <div className="grid-cell-header" style={{ width: COL_AGE }} data-sortable="true">
            <div className="header-content">
              <span>Age</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const bodyNode = (
    <div className="gridtable-wrapper">
      <div className="gridtable gridtable--body gridtable-browse" role="grid">
        {ROWS.map((row, i) => (
          <div
            key={i}
            className={`gridtable-row${row.focused ? ' gridtable-row--focused' : ''}`}
            role="row"
          >
            <div className="grid-cell" style={{ width: COL_KIND }}>
              <span className="grid-cell-content">{row.kind}</span>
            </div>
            <div className="grid-cell" style={{ width: COL_NAME }}>
              <span className="grid-cell-content">{row.name}</span>
            </div>
            <div className="grid-cell" style={{ width: COL_NS }}>
              <span className="grid-cell-content">{row.ns}</span>
            </div>
            <div className="grid-cell" style={{ width: COL_AGE }}>
              <span className="grid-cell-content">{row.age}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <GridTableLayout
      embedded={false}
      className="gridtable-browse"
      loading={false}
      filters={filtersNode}
      header={headerNode}
      body={bodyNode}
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
