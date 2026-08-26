/**
 * frontend/src/modules/browse/components/BrowseView.stories.tsx
 *
 * Renders a realistic Browse view through the production GridTable surface.
 */

import type { Meta, StoryObj } from '@storybook/react';
import '@styles/components/gridtables.css';
import './BrowseView.css';
import CatalogPaginationFooter, {
  catalogPaginationPageKeyProps,
} from '@modules/browse/components/CatalogPaginationFooter';
import type { BrowseCatalogPagination } from '@modules/browse/hooks/useBrowseCatalog';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { FavoriteFilledIcon, FavoriteOutlineIcon } from '@shared/components/icons/FavoriteIcons';
import {
  createAgeColumn,
  createKindColumn,
  createResourceNameColumn,
  withAutoWidthColumns,
} from '@shared/components/tables/columnFactories';
import {
  type CustomMetadataColumnDefinition,
  createCustomMetadataColumnDefinition,
} from '@shared/components/tables/customMetadataColumns';
import GridTable, {
  type ColumnWidthState,
  type GridColumnDefinition,
} from '@shared/components/tables/GridTable';
import { useState } from 'react';
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
  metadata?: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
}

const ROWS: BrowseStoryRow[] = [
  {
    kind: 'ReplicaSet',
    name: 'nginx-deployment-7fb96c846b',
    ns: 'default',
    age: '3d',
    metadata: {
      labels: { 'app.kubernetes.io/managed-by': 'helm' },
      annotations: { 'example.com/revision': '7' },
    },
  },
  {
    kind: 'Deployment',
    name: 'nginx-deployment',
    ns: 'default',
    age: '3d',
    metadata: {
      labels: { 'app.kubernetes.io/managed-by': 'helm' },
      annotations: { 'example.com/revision': '8' },
    },
  },
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

const ROWS_WITHOUT_METADATA = ROWS.map((row) => ({ ...row, metadata: undefined }));

const COLUMNS: GridColumnDefinition<BrowseStoryRow>[] = [
  {
    ...createKindColumn<BrowseStoryRow>({ getKind: (row) => row.kind }),
    width: 160,
  },
  {
    ...createResourceNameColumn<BrowseStoryRow>((row) => row.name),
    width: 320,
  },
  { key: 'namespace', header: 'Namespace', render: (row) => row.ns, sortable: true, width: 220 },
  { ...createAgeColumn<BrowseStoryRow>(), width: 120 },
];

const createInitialCustomColumns = (): CustomMetadataColumnDefinition[] => [
  createCustomMetadataColumnDefinition({
    source: 'annotation',
    metadataKey: 'example.com/revision',
    header: 'Revision',
  }),
];

const LARGE_AUTO_WIDTH_ROWS: BrowseStoryRow[] = Array.from({ length: 609 }, (_value, index) => ({
  kind:
    index === 500
      ? 'PriorityLevelConfiguration'
      : index === 0
        ? 'ClusterRoleBinding'
        : index === 1
          ? 'ValidatingWebhook'
          : 'StorageClass',
  name:
    index === 1
      ? 'cert-manager-controller-certificatesigningrequests'
      : `resource-${String(index).padStart(3, '0')}`,
  ns: 'default',
  age: index === 1 ? '2mo' : '10mo',
}));

const AUTO_WIDTH_COLUMNS: GridColumnDefinition<BrowseStoryRow>[] = withAutoWidthColumns([
  createKindColumn<BrowseStoryRow>({ getKind: (row) => row.kind, onClick: noOp }),
  createResourceNameColumn<BrowseStoryRow>((row) => row.name),
  createAgeColumn<BrowseStoryRow>(),
]);

const persistedColumnWidth = (width: number): ColumnWidthState => ({
  width,
  unit: 'px',
  raw: width,
  rawValue: width,
  autoWidth: false,
  source: 'column',
  updatedAt: 0,
});

interface MockBrowseViewProps {
  isFavorited?: boolean;
  rows?: BrowseStoryRow[];
  initialCustomColumnDefinitions?: CustomMetadataColumnDefinition[];
}

function MockBrowseView({
  isFavorited = false,
  rows = ROWS,
  initialCustomColumnDefinitions = createInitialCustomColumns(),
}: MockBrowseViewProps) {
  const [customColumns, setCustomColumns] = useState<CustomMetadataColumnDefinition[]>(
    initialCustomColumnDefinitions
  );
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
      data={rows}
      columns={COLUMNS}
      customMetadataColumns={{ definitions: customColumns, onChange: setCustomColumns }}
      keyExtractor={(row) => `story|${row.kind}:${row.ns}:${row.name}`}
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

function PersistedAutoWidthView() {
  const [pageIndex, setPageIndex] = useState(1);
  const [columnWidths, setColumnWidths] = useState<Record<string, ColumnWidthState>>({
    kind: persistedColumnWidth(160),
    name: persistedColumnWidth(320),
  });
  const pageSize = 500;
  const pageRows = LARGE_AUTO_WIDTH_ROWS.slice((pageIndex - 1) * pageSize, pageIndex * pageSize);
  const pagination: BrowseCatalogPagination = {
    pageIndex,
    pageLimit: pageSize,
    pageLimitOptions: [pageSize],
    setPageLimit: noOp,
    totalCount: LARGE_AUTO_WIDTH_ROWS.length,
    totalIsExact: true,
    previousToken: pageIndex > 1 ? 'page-1' : null,
    continueToken: pageIndex < 2 ? 'page-2' : null,
    queryPending: false,
    hasMore: pageIndex < 2,
    hasPrevious: pageIndex > 1,
    isRequestingMore: false,
    onRequestMore: () => setPageIndex(2),
    onRequestPrevious: () => setPageIndex(1),
    onJumpToPage: (page) => setPageIndex(Math.max(1, Math.min(2, page))),
  };
  return (
    <GridTable
      data={pageRows}
      columns={AUTO_WIDTH_COLUMNS}
      keyExtractor={(row) => `story|${row.kind}:${row.name}`}
      columnWidths={columnWidths}
      onColumnWidthsChange={setColumnWidths}
      className="gridtable-browse"
      tableClassName="gridtable-browse"
      paginationControls={
        <CatalogPaginationFooter
          idPrefix="persisted-auto-width-story"
          visibleItemCount={pageRows.length}
          pagination={pagination}
        />
      }
      {...catalogPaginationPageKeyProps(pagination)}
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

/** Custom-column editor when the loaded rows expose no labels or annotations. */
export const NoMetadataKeys: Story = {
  render: () => <MockBrowseView rows={ROWS_WITHOUT_METADATA} initialCustomColumnDefinitions={[]} />,
};

/** Cached widths are remeasured after each backend-style page transition. */
export const PersistedAutomaticWidth: Story = {
  render: () => <PersistedAutoWidthView />,
};
