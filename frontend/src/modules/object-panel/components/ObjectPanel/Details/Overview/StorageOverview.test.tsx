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

    expect(container.textContent).toContain('Bound');
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

    expect(getValueForLabel(container, 'Reclaim Policy')?.textContent).toBe('Retain');
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
    const allowExpansion = getValueForLabel(container, 'Allow Expansion');
    expect(allowExpansion?.textContent).toBe('True');
    expect(allowExpansion?.querySelector('.status-chip--healthy')).toBeTruthy();
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
