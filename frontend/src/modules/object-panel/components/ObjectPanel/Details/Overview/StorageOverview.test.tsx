/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/StorageOverview.test.tsx
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StorageOverview } from './StorageOverview';

const openWithObjectMock = vi.fn();
const defaultClusterId = 'alpha:ctx';

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: openWithObjectMock,
    objectData: { clusterId: defaultClusterId, clusterName: 'alpha' },
  }),
}));

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: any) => <>{children}</>,
}));

vi.mock('@shared/components/kubernetes/ResourceHeader', () => ({
  ResourceHeader: (props: any) => (
    <div data-testid="resource-header">
      {props.kind}:{props.name}
    </div>
  ),
}));

vi.mock('@shared/components/kubernetes/ResourceStatus', () => ({
  ResourceStatus: (props: any) => <div data-testid="resource-status">{props.status}</div>,
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
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
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof StorageOverview>) => {
    await act(async () => {
      root.render(<StorageOverview {...props} />);
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    openWithObjectMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders PVC-specific fields', async () => {
    await renderComponent({
      kind: 'PersistentVolumeClaim',
      name: 'data',
      namespace: 'storage',
      status: 'Bound',
      volumeName: 'pv-123',
      capacity: '20Gi',
      accessModes: ['ReadWriteOnce'],
      storageClass: 'standard',
      volumeMode: 'Filesystem',
      mountedBy: ['pod-a', 'pod-b'],
      labels: { team: 'platform' },
      annotations: { owner: 'storage-admins' },
    });

    // Status renders as a chip with the semantically-mapped variant.
    const statusRow = getValueForLabel(container, 'Status');
    expect(statusRow?.textContent).toBe('Bound');
    expect(statusRow?.querySelector('.status-chip--healthy')).toBeTruthy();
    // Access modes render as chips, not a comma-joined string.
    const accessModes = getValueForLabel(container, 'Access Modes');
    expect(accessModes?.textContent).toBe('ReadWriteOnce');
    expect(accessModes?.querySelector('.status-chip--info')).toBeTruthy();
    const volumeLink = getLinkByText(container, 'pv-123');
    expect(volumeLink).not.toBeUndefined();
    act(() => {
      volumeLink?.click();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'persistentvolume',
        name: 'pv-123',
        clusterId: defaultClusterId,
      })
    );

    const storageClassLink = getLinkByText(container, 'standard');
    expect(storageClassLink).not.toBeUndefined();
    act(() => {
      storageClassLink?.click();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'storageclass',
        name: 'standard',
        clusterId: defaultClusterId,
      })
    );

    const mountedByLink = getLinkByText(container, 'pod-a');
    expect(mountedByLink).not.toBeUndefined();
    act(() => {
      mountedByLink?.click();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'pod',
        name: 'pod-a',
        namespace: 'storage',
        clusterId: defaultClusterId,
      })
    );

    expect(container.textContent).toContain('Labels');
    expect(container.textContent).toContain('team:');
    expect(container.textContent).toContain('platform');
    expect(container.textContent).toContain('Annotations');
    expect(container.textContent).toContain('owner:');
    expect(container.textContent).toContain('storage-admins');
  });

  it('surfaces the PVC data source when set (snapshot restore)', async () => {
    await renderComponent({
      kind: 'PersistentVolumeClaim',
      name: 'restored',
      namespace: 'storage',
      status: 'Pending',
      capacity: '20Gi',
      accessModes: ['ReadWriteOnce'],
      dataSource: { kind: 'VolumeSnapshot', name: 'nightly-2026-04-27' },
    });

    const dataSource = getValueForLabel(container, 'Data Source');
    expect(dataSource?.textContent).toBe('VolumeSnapshot/nightly-2026-04-27');
    // Pending → info chip on Status.
    const statusRow = getValueForLabel(container, 'Status');
    expect(statusRow?.querySelector('.status-chip--info')).toBeTruthy();
  });

  it('renders PV-specific fields including claim reference', async () => {
    await renderComponent({
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
    act(() => {
      storageClassLink?.click();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'storageclass',
        name: 'nfs',
        clusterId: defaultClusterId,
      })
    );

    const claimLink = getLinkByText(container, 'default/cache');
    expect(claimLink).not.toBeUndefined();
    act(() => {
      claimLink?.click();
    });
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'persistentvolumeclaim',
        name: 'cache',
        namespace: 'default',
        clusterId: defaultClusterId,
      })
    );

    expect(container.textContent).toContain('Labels');
    expect(container.textContent).toContain('env:');
    expect(container.textContent).toContain('prod');
    expect(container.textContent).toContain('Annotations');
    expect(container.textContent).toContain('owner:');
    expect(container.textContent).toContain('storage-team');
  });

  it('shows the PV status chip and volume source for a CSI-backed PV', async () => {
    await renderComponent({
      kind: 'PersistentVolume',
      name: 'pv-csi',
      status: 'Bound',
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

    // Status: Bound → healthy chip
    const statusRow = getValueForLabel(container, 'Status');
    expect(statusRow?.textContent).toBe('Bound');
    expect(statusRow?.querySelector('.status-chip--healthy')).toBeTruthy();
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
    await renderComponent({
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
    await renderComponent({
      kind: 'StorageClass',
      name: 'standard',
      provisioner: 'ebs.csi.aws.com',
      reclaimPolicy: 'Retain',
      volumeBindingMode: 'WaitForFirstConsumer',
      allowVolumeExpansion: false,
      isDefault: true,
      persistentVolumesCount: 247,
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
