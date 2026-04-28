/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/SecretOverview.test.tsx
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SecretOverview } from './SecretOverview';

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

vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({
  ResourceMetadata: () => <div data-testid="resource-metadata" />,
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

describe('SecretOverview', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof SecretOverview>) => {
    await act(async () => {
      root.render(<SecretOverview {...props} />);
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

  it('renders secret type as a chip', async () => {
    await renderComponent({
      secretDetails: {
        name: 'tls-secret',
        namespace: 'prod',
        age: '1h',
        secretType: 'kubernetes.io/tls',
        dataKeys: ['tls.crt', 'tls.key'],
        usedBy: [],
        labels: {},
        annotations: {},
      } as any,
    });

    const typeValue = getValueForLabel(container, 'Type');
    expect(typeValue?.textContent).toBe('kubernetes.io/tls');
    // Now renders as an info-variant StatusChip rather than a legacy .status-badge.
    expect(typeValue?.querySelector('.status-chip--info')).toBeTruthy();
    // Data Keys row is intentionally not surfaced — DataSection covers it.
    expect(getValueForLabel(container, 'Data Keys')).toBeNull();
  });

  it('navigates to pods that consume the secret', async () => {
    await renderComponent({
      secretDetails: {
        name: 'service-token',
        namespace: 'team',
        age: '3h',
        secretType: 'kubernetes.io/service-account-token',
        dataKeys: ['token'],
        usedBy: ['pod-x'],
        labels: {},
        annotations: {},
      } as any,
    });

    const podLink = getLinkByText(container, 'pod-x');
    expect(podLink).not.toBeUndefined();
    act(() => {
      podLink?.click();
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'pod',
        name: 'pod-x',
        namespace: 'team',
        clusterId: defaultClusterId,
      })
    );
  });

  it('shows “Not in use” when there are no consumers', async () => {
    await renderComponent({
      secretDetails: {
        name: 'unused-secret',
        namespace: 'env',
        age: '5m',
        secretType: 'Opaque',
        dataKeys: [],
        usedBy: [],
        labels: {},
        annotations: {},
      } as any,
    });

    const usedByValue = getValueForLabel(container, 'Used By');
    expect(usedByValue?.textContent).toContain('Not in use');
    expect(openWithObjectMock).not.toHaveBeenCalled();
  });
});
