/**
 * frontend/src/modules/browse/hooks/useBrowseColumns.test.tsx
 *
 * Verifies the Browse table's row projection and column wiring: catalog rows
 * keep the action facts their context menus read, All Namespaces adds a
 * Namespace column that opens the row's namespace in its own cluster, and
 * Alt+click on a name navigates the workspace to the object's view. The hook
 * runs inside the production shell over a faked backend (test-utils/appState).
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogItem } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { type BrowseTableRow, toTableRows, useBrowseColumns } from './useBrowseColumns';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;
let columnKeys: string[] = [];

const catalogItem = (namespace: string): CatalogItem => ({
  ref: {
    clusterId: dev.clusterId,
    group: 'batch',
    version: 'v1',
    kind: 'CronJob',
    resource: 'cronjobs',
    namespace,
    name: 'nightly',
    uid: `${namespace}-nightly`,
  },
  resourceVersion: '7',
  creationTimestamp: '2026-08-04T12:00:00Z',
  scope: 'Namespace',
  actionFacts: { status: 'Suspended' },
});

/** Renders one row's cells the way GridTable renders each column. */
function ColumnsProbe({
  showNamespaceColumn,
  row,
  onRowClick,
  onNamespaceClick,
}: Readonly<{
  showNamespaceColumn: boolean;
  row: BrowseTableRow;
  onRowClick: (row: BrowseTableRow) => void;
  onNamespaceClick: (namespace: string | null, clusterId: string | null) => void;
}>) {
  const columns = useBrowseColumns({ showNamespaceColumn, onRowClick, onNamespaceClick });
  columnKeys = columns.map((column) => column.key);
  return (
    <div>
      {columns.map((column) => (
        <span key={column.key} data-column={column.key}>
          {column.render(row)}
        </span>
      ))}
    </div>
  );
}

const showColumns = async (showNamespaceColumn: boolean) => {
  const onRowClick = vi.fn();
  const onNamespaceClick = vi.fn();
  const [row] = toTableRows([catalogItem('team-a')], false);
  await view.show(
    <ColumnsProbe
      showNamespaceColumn={showNamespaceColumn}
      row={requireValue(row, 'expected a Browse row')}
      onRowClick={onRowClick}
      onNamespaceClick={onNamespaceClick}
    />
  );
  return { onRowClick, onNamespaceClick };
};

const clickCell = async (key: string, init: MouseEventInit = {}) => {
  const control = requireValue(
    view.container.querySelector<HTMLElement>(`[data-column="${key}"] button`),
    `expected an interactive ${key} cell`
  );
  await act(async () => {
    control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  });
  await app.settle();
};

beforeEach(async () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
  view = await app.render(null);
});

describe('toTableRows', () => {
  // Browse context menus offer Resume, Scale, and Trigger from these facts.
  it('keeps catalog action facts and API identity on each row', () => {
    const [row] = toTableRows([catalogItem('team-a')], false);

    expect(row).toEqual(
      expect.objectContaining({
        apiDisplay: 'batch/v1',
        namespaceDisplay: 'team-a',
        ageTimestamp: Date.parse('2026-08-04T12:00:00Z'),
        actionFacts: { status: 'Suspended' },
      })
    );
  });
});

describe('toTableRows kind labels', () => {
  // Short names belong to built-in kinds; a custom resource sharing a kind name
  // keeps its full kind.
  it('shortens only the built-in kind a row names', () => {
    const builtIn = catalogItem('team-a');
    const lookalike: CatalogItem = {
      ...builtIn,
      ref: { ...builtIn.ref, group: 'example.com', kind: 'Deployment', resource: 'deployments' },
    };
    const deployment: CatalogItem = {
      ...builtIn,
      ref: { ...builtIn.ref, group: 'apps', kind: 'Deployment', resource: 'deployments' },
    };

    const [shortLookalike, shortDeployment, shortCronJob] = toTableRows(
      [lookalike, deployment, builtIn],
      true
    );

    expect(shortLookalike?.kindDisplay).toBe('Deployment');
    expect(shortDeployment?.kindDisplay).toBe('deploy');
    expect(shortCronJob?.kindDisplay).toBe('cron');
    expect(toTableRows([deployment], false)[0]?.kindDisplay).toBe('Deployment');
  });
});

describe('useBrowseColumns', () => {
  it('adds a Namespace column only across namespaces, opening the row namespace in its cluster', async () => {
    await showColumns(false);
    expect(columnKeys).toEqual(['kind', 'name', 'api', 'age']);

    const { onNamespaceClick } = await showColumns(true);
    expect(columnKeys).toEqual(['kind', 'name', 'namespace', 'api', 'age']);
    await clickCell('namespace');

    expect(onNamespaceClick).toHaveBeenCalledWith('team-a', dev.clusterId);
  });

  it('opens the row from its name and navigates to its view on Alt+click', async () => {
    const { onRowClick } = await showColumns(true);

    await clickCell('name');
    expect(onRowClick).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: expect.objectContaining({
          clusterId: dev.clusterId,
          group: 'batch',
          version: 'v1',
          kind: 'CronJob',
          namespace: 'team-a',
          name: 'nightly',
        }),
      })
    );

    onRowClick.mockClear();
    await clickCell('name', { altKey: true });

    expect(onRowClick).not.toHaveBeenCalled();
    const owners = view.owners();
    expect(owners.viewState?.viewType).toBe('namespace');
    expect(owners.viewState?.activeNamespaceTab).toBe('workloads');
    expect(owners.namespace.selectedNamespace).toBe('team-a');
  });
});
