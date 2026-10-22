/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/SecretOverview.test.tsx
 *
 * Renders the Secret overview inside the real app shell (test-utils/appState).
 * The "Used By" links are the shared renderUsedByLinks path, covered once in
 * ConfigMapOverview.test.tsx.
 */

import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { secretDescriptor } from './descriptors/secret';
import { OverviewRenderer } from './OverviewRenderer';

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

vi.mock('@shared/components/kubernetes/ResourceMetadata', () => ({
  ResourceMetadata: () => <div data-testid="resource-metadata" />,
}));

const getValueForLabel = (container: HTMLElement, label: string) => {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('.overview-label')).find(
    (el) => el.textContent?.trim() === label
  );
  return labelElement?.parentElement?.querySelector<HTMLElement>('.overview-value') ?? null;
};

describe('SecretOverview', () => {
  let view: MountedApp;

  const renderComponent = async (props: { secretDetails: unknown }) => {
    await view.show(
      <OverviewRenderer descriptor={secretDescriptor} data={props.secretDetails as never} />
    );
  };

  beforeEach(async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['prod']);
    view = await app.render(null);
  });

  it('displays the secret type from the detail payload', async () => {
    await renderComponent({
      secretDetails: {
        name: 'tls-secret',
        namespace: 'prod',
        secretType: 'kubernetes.io/tls',
        dataKeys: ['tls.crt', 'tls.key'],
        usedBy: [],
        labels: {},
        annotations: {},
      } as unknown,
    });

    const typeValue = getValueForLabel(view.container, 'Type');
    expect(typeValue?.textContent).toBe('kubernetes.io/tls');
  });
});
