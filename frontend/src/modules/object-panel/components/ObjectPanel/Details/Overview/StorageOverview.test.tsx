/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/StorageOverview.test.tsx
 *
 * Test suite for StorageOverview.
 * Covers key behaviors and edge cases for StorageOverview.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StorageOverview } from './StorageOverview';

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

const getValueForLabel = (container: HTMLElement, label: string) => {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('.overview-label')).find(
    (el) => el.textContent?.trim() === label
  );
  return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
};

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
    expect(getValueForLabel(container, 'Volume')?.textContent).toBe('pv-123');
    expect(getValueForLabel(container, 'Mounted By')?.textContent).toContain('pod-a');
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
    expect(getValueForLabel(container, 'Claim')?.textContent).toBe('default/cache');
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
    expect(getValueForLabel(container, 'Allow Expansion')?.textContent).toBe('Yes');
    expect(getValueForLabel(container, 'Default Class')?.textContent).toBe('No');
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
});
