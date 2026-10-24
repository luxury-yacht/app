/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/StorageOverview.test.tsx
 *
 * Exercises the storage descriptors (PVC / PV / StorageClass) through the descriptor-driven
 * OverviewRenderer inside the real app shell: related-object links open panels through the real
 * panel owners. Only the backend boundary is faked (test-utils/appState).
 */

import type {
  persistentvolume,
  persistentvolumeclaim,
  storageclass,
} from '@core/backend-api/models';
import type React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { partialModelFixture } from '@/test-utils/partialModelFixture';
import { pvcDescriptor, pvDescriptor, storageClassDescriptor } from './descriptors/storage';
import { OverviewRenderer } from './OverviewRenderer';
import type { OverviewDescriptor } from './schema';

const app = installAppStateHarness();

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: { kind: string; name: string }) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceStatus', () => ({
  ResourceStatus: (props: {
    status?: string;
    statusState?: string;
    statusPresentation?: string;
  }) =>
    props.status ? (
      <div>
        <span className="overview-label">Status</span>
        <span className="overview-value">
          <span
            className={`status-text ${props.statusPresentation ?? props.statusState ?? 'unknown'}`}
            data-testid="resource-status"
            data-state={props.statusState}
            data-presentation={props.statusPresentation}
          >
            {props.status}
          </span>
        </span>
      </div>
    ) : null,
}));

const getValueForLabel = (container: HTMLElement, label: string) => {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('.overview-label')).find(
    (el) => el.textContent?.trim() === label
  );
  return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
};

const getLinkByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll<HTMLElement>('.object-panel-link')).find(
    (el) => el.textContent?.trim() === text
  );

describe('StorageOverview', () => {
  let view: MountedApp;
  let dev: TestCluster;
  let container: HTMLElement;

  const podRef = (name: string, namespace: string) => ({
    clusterId: dev.clusterId,
    group: '',
    version: 'v1',
    kind: 'Pod',
    resource: 'pods',
    namespace,
    name,
  });

  // A panel the real panel state holds, in the overview's cluster.
  const panel = (identity: {
    group: string;
    version: string;
    kind: string;
    namespace: string;
    name: string;
  }) => ({ clusterId: dev.clusterId, clusterName: dev.clusterName, ...identity });

  const renderDescriptor = async <T,>(descriptor: OverviewDescriptor<T>, data: T) => {
    await view.show(
      <OverviewRenderer
        descriptor={descriptor}
        data={data}
        context={{ clusterId: dev.clusterId, clusterName: dev.clusterName }}
      />
    );
  };

  const renderPvc = (fixture: Partial<persistentvolumeclaim.PersistentVolumeClaimDetails>) =>
    renderDescriptor(
      pvcDescriptor,
      partialModelFixture<persistentvolumeclaim.PersistentVolumeClaimDetails>(fixture)
    );
  const renderPv = (fixture: Partial<persistentvolume.PersistentVolumeDetails>) =>
    renderDescriptor(
      pvDescriptor,
      partialModelFixture<persistentvolume.PersistentVolumeDetails>(fixture)
    );
  const renderStorageClass = (fixture: Partial<storageclass.StorageClassDetails>) =>
    renderDescriptor(
      storageClassDescriptor,
      partialModelFixture<storageclass.StorageClassDetails>(fixture)
    );

  const click = async (element: HTMLElement | undefined) => {
    await act(async () => {
      element?.click();
    });
    await app.settle();
  };

  beforeEach(async () => {
    dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['storage', 'claims', 'backups', 'default']);
    view = await app.render(null);
    container = view.container;
  });

  it('renders PVC-specific fields', async () => {
    await renderPvc({
      kind: 'PersistentVolumeClaim',
      name: 'data',
      namespace: 'storage',
      status: 'Bound',
      statusState: 'Bound',
      statusPresentation: 'ready',
      volumeName: 'pv-123',
      capacity: '20Gi',
      accessModes: ['ReadWriteOnce'],
      storageClass: 'standard',
      volumeMode: 'Filesystem',
      mountedBy: [podRef('pod-a', 'storage'), podRef('pod-b', 'storage')],
      labels: { team: 'platform' },
      annotations: { owner: 'storage-admins' },
    });

    // Status renders from backend statusPresentation rather than local phase mapping.
    const statusRow = getValueForLabel(container, 'Status');
    expect(statusRow?.textContent).toBe('Bound');
    expect(statusRow?.querySelector('.status-text.ready')).toBeTruthy();
    // Access modes render as chips, not a comma-joined string.
    const accessModes = getValueForLabel(container, 'Access Modes');
    expect(accessModes?.textContent).toBe('ReadWriteOnce');
    expect(accessModes?.querySelector('.status-chip--info')).toBeTruthy();

    const volumeLink = getLinkByText(container, 'pv-123');
    expect(volumeLink).not.toBeUndefined();
    await click(volumeLink);
    const storageClassLink = getLinkByText(container, 'standard');
    expect(storageClassLink).not.toBeUndefined();
    await click(storageClassLink);
    const mountedByLink = getLinkByText(container, 'pod-a');
    expect(mountedByLink).not.toBeUndefined();
    await click(mountedByLink);

    // Built-in kinds resolve their group/version and take the registry's kind spelling.
    expect(view.openPanels()).toEqual([
      panel({ group: '', version: 'v1', kind: 'PersistentVolume', namespace: '', name: 'pv-123' }),
      panel({
        group: 'storage.k8s.io',
        version: 'v1',
        kind: 'StorageClass',
        namespace: '',
        name: 'standard',
      }),
      panel({ group: '', version: 'v1', kind: 'Pod', namespace: 'storage', name: 'pod-a' }),
    ]);

    expect(container.textContent).toContain('Labels');
    expect(container.textContent).toContain('team:');
    expect(container.textContent).toContain('platform');
    expect(container.textContent).toContain('Annotations');
    expect(container.textContent).toContain('owner:');
    expect(container.textContent).toContain('storage-admins');
  });

  it('surfaces the PVC data source when set (snapshot restore)', async () => {
    await renderPvc({
      kind: 'PersistentVolumeClaim',
      name: 'restored',
      namespace: 'storage',
      status: 'Pending',
      statusState: 'Pending',
      statusPresentation: 'warning',
      capacity: '20Gi',
      accessModes: ['ReadWriteOnce'],
      dataSource: {
        display: {
          clusterId: dev.clusterId,
          group: 'snapshot.storage.k8s.io',
          kind: 'VolumeSnapshot',
          namespace: 'storage',
          name: 'nightly-2026-04-27',
        },
      },
    });

    const dataSource = getValueForLabel(container, 'Data Source');
    expect(dataSource?.textContent).toBe('VolumeSnapshot/nightly-2026-04-27');
    const statusRow = getValueForLabel(container, 'Status');
    expect(statusRow?.querySelector('.status-text.warning')).toBeTruthy();
  });

  it('opens a cross-namespace clone source and keeps unresolved custom sources unlinked', async () => {
    const ref = {
      clusterId: dev.clusterId,
      group: '',
      version: 'v1',
      kind: 'PersistentVolumeClaim',
      namespace: 'backups',
      name: 'original',
    };
    await renderPvc({ name: 'clone', namespace: 'claims', dataSource: { ref } });
    const link = getLinkByText(container, 'PersistentVolumeClaim/original');
    expect(link).toBeDefined();
    await click(link);
    expect(view.openPanels()).toEqual([
      panel({
        group: '',
        version: 'v1',
        kind: 'PersistentVolumeClaim',
        namespace: 'backups',
        name: 'original',
      }),
    ]);

    await renderPvc({
      name: 'clone',
      namespace: 'claims',
      dataSource: { display: { ...ref, group: 'custom.example.com', version: '' } },
    });
    expect(getValueForLabel(container, 'Data Source')?.textContent).toBe(
      'PersistentVolumeClaim/original'
    );
    expect(getLinkByText(container, 'PersistentVolumeClaim/original')).toBeUndefined();
  });

  it('renders PV-specific fields including claim reference', async () => {
    await renderPv({
      kind: 'PersistentVolume',
      name: 'pv-1',
      capacity: '50Gi',
      accessModes: ['ReadWriteMany'],
      reclaimPolicy: 'Retain',
      storageClass: 'nfs',
      volumeMode: 'Block',
      claimRef: { namespace: 'default', name: 'cache' },
      labels: { env: 'prod' },
      annotations: { owner: 'storage-team' },
    });

    const reclaim = getValueForLabel(container, 'Reclaim Policy');
    expect(reclaim?.textContent).toBe('Retain');
    expect(reclaim?.querySelector('.status-chip--info')).toBeTruthy();
    // Access modes render as chips, not a comma-joined string.
    const accessModes = getValueForLabel(container, 'Access Modes');
    expect(accessModes?.textContent).toBe('ReadWriteMany');
    expect(accessModes?.querySelector('.status-chip--info')).toBeTruthy();

    const storageClassLink = getLinkByText(container, 'nfs');
    expect(storageClassLink).not.toBeUndefined();
    await click(storageClassLink);
    const claimLink = getLinkByText(container, 'default/cache');
    expect(claimLink).not.toBeUndefined();
    await click(claimLink);

    expect(view.openPanels()).toEqual([
      panel({
        group: 'storage.k8s.io',
        version: 'v1',
        kind: 'StorageClass',
        namespace: '',
        name: 'nfs',
      }),
      panel({
        group: '',
        version: 'v1',
        kind: 'PersistentVolumeClaim',
        namespace: 'default',
        name: 'cache',
      }),
    ]);

    expect(container.textContent).toContain('Labels');
    expect(container.textContent).toContain('env:');
    expect(container.textContent).toContain('prod');
    expect(container.textContent).toContain('Annotations');
    expect(container.textContent).toContain('owner:');
    expect(container.textContent).toContain('storage-team');
  });

  it('shows the PV status chip and volume source for a CSI-backed PV', async () => {
    await renderPv({
      kind: 'PersistentVolume',
      name: 'pv-csi',
      status: 'Bound',
      statusState: 'Bound',
      statusPresentation: 'ready',
      capacity: '100Gi',
      accessModes: ['ReadWriteOnce'],
      reclaimPolicy: 'Delete',
      volumeMode: 'Filesystem',
      volumeSource: {
        type: 'CSI',
        details: {
          driver: 'ebs.csi.aws.com',
          volumeHandle: 'vol-0a1b2c3d',
          fsType: 'ext4',
        },
      },
      mountOptions: ['nosuid', 'noexec'],
      nodeAffinity: ['topology.kubernetes.io/zone in [us-east-1a]'],
    });

    // Status renders from backend statusPresentation.
    const statusRow = getValueForLabel(container, 'Status');
    expect(statusRow?.textContent).toBe('Bound');
    expect(statusRow?.querySelector('.status-text.ready')).toBeTruthy();
    // Reclaim Policy: Delete → warning chip
    const reclaim = getValueForLabel(container, 'Reclaim Policy');
    expect(reclaim?.querySelector('.status-chip--warning')).toBeTruthy();
    // Volume Source surfaces type + provider details
    const source = getValueForLabel(container, 'Source');
    expect(source?.textContent).toContain('CSI');
    expect(source?.textContent).toContain('ebs.csi.aws.com');
    expect(source?.textContent).toContain('vol-0a1b2c3d');
    // Mount options + node affinity
    expect(getValueForLabel(container, 'Mount Options')?.textContent).toBe('nosuid, noexec');
    expect(getValueForLabel(container, 'Node Affinity')?.textContent).toContain(
      'topology.kubernetes.io/zone'
    );
  });

  it('renders StorageClass-specific fields', async () => {
    await renderStorageClass({
      kind: 'StorageClass',
      name: 'fast',
      provisioner: 'kubernetes.io/aws-ebs',
      reclaimPolicy: 'Delete',
      volumeBindingMode: 'WaitForFirstConsumer',
      allowVolumeExpansion: true,
      isDefault: false,
      parameters: {
        type: 'gp3',
        encrypted: 'true',
      },
      labels: { env: 'prod' },
      annotations: { owner: 'storage-team' },
    });

    expect(getValueForLabel(container, 'Provisioner')?.textContent).toBe('kubernetes.io/aws-ebs');
    const expansion = getValueForLabel(container, 'Expansion');
    expect(expansion?.textContent).toBe('True');
    expect(expansion?.querySelector('.status-chip--healthy')).toBeTruthy();
    // Default = false renders as an "unhealthy" (red) "False" chip.
    const defaultRow = getValueForLabel(container, 'Default');
    expect(defaultRow?.textContent).toBe('False');
    expect(defaultRow?.querySelector('.status-chip--unhealthy')).toBeTruthy();
    // Reclaim Policy "Delete" renders as a warning chip.
    const reclaim = getValueForLabel(container, 'Reclaim Policy');
    expect(reclaim?.textContent).toBe('Delete');
    expect(reclaim?.querySelector('.status-chip--warning')).toBeTruthy();
    const params = getValueForLabel(container, 'Parameters');
    expect(params?.textContent).toContain('type');
    expect(params?.textContent).toContain('gp3');
    expect(container.textContent).toContain('Labels');
    expect(container.textContent).toContain('env:');
    expect(container.textContent).toContain('prod');
    expect(container.textContent).toContain('Annotations');
    expect(container.textContent).toContain('owner:');
    expect(container.textContent).toContain('storage-team');
  });

  it('shows the Default chip (True), provisioned count, and mount options', async () => {
    await renderStorageClass({
      kind: 'StorageClass',
      name: 'standard',
      provisioner: 'ebs.csi.aws.com',
      reclaimPolicy: 'Retain',
      volumeBindingMode: 'WaitForFirstConsumer',
      allowVolumeExpansion: false,
      isDefault: true,
      persistentVolumes: Array.from({ length: 247 }, (_, i) => `pv-${i}`),
      mountOptions: ['nfsvers=4.1', 'rsize=1048576'],
    });

    const defaultRow = getValueForLabel(container, 'Default');
    expect(defaultRow?.textContent).toBe('True');
    expect(defaultRow?.querySelector('.status-chip--healthy')).toBeTruthy();
    expect(getValueForLabel(container, 'Provisioned')?.textContent).toBe('247 PersistentVolumes');
    expect(getValueForLabel(container, 'Mount Options')?.textContent).toBe(
      'nfsvers=4.1, rsize=1048576'
    );
    // Retain is a non-Delete policy → info chip.
    const reclaim = getValueForLabel(container, 'Reclaim Policy');
    expect(reclaim?.querySelector('.status-chip--info')).toBeTruthy();
  });
});
