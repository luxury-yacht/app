/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabRBACRules.test.tsx
 *
 * Renders the RBAC permission rules table inside the real app shell (keyboard and zoom owners
 * included). Only the backend boundary is faked (test-utils/appState).
 */

import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import RBACRules from './DetailsTabRBACRules';

const app = installAppStateHarness();

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('DetailsTabRBACRules', () => {
  let view: MountedApp;

  // Shows the rules inside their own element so assertions see only the table.
  const render = async (ui: React.ReactElement) => {
    await view.show(<div data-testid="rbac-rules">{ui}</div>);
    const surface = view.container.querySelector<HTMLElement>('[data-testid="rbac-rules"]');
    if (!surface) {
      throw new Error('The rules surface did not render');
    }
    return surface;
  };
  const rowTexts = (container: HTMLElement) =>
    [...container.querySelectorAll('.gridtable-row[data-row-key]')].map(
      (row) => row.textContent ?? ''
    );

  beforeEach(async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default']);
    view = await app.render(null);
  });

  it('returns null when there are no rules', async () => {
    const container = await render(<RBACRules />);
    expect(container.textContent).toBe('');
  });

  it('shows one permission row per resource with every verb any rule grants it', async () => {
    const container = await render(
      <RBACRules
        policyRules={[
          { apiGroups: [''], resources: ['secrets'], verbs: ['get', 'list'] },
          { apiGroups: [''], resources: ['secrets'], verbs: ['delete'] },
          { nonResourceURLs: ['/healthz'], verbs: ['get'] },
        ]}
      />
    );

    const secrets = rowTexts(container).filter((text) => text.includes('secrets'));
    expect(secrets).toHaveLength(1);
    expect(secrets[0].toLowerCase()).toContain('getlistdelete');
    expect(rowTexts(container).some((text) => text.includes('/healthz'))).toBe(true);
  });

  it('marks a grant limited to named objects in the resource cell', async () => {
    const container = await render(
      <RBACRules
        policyRules={[
          {
            apiGroups: ['certificates.k8s.io'],
            resources: ['signers'],
            resourceNames: ['kubernetes.io/kubelet-serving', 'kubernetes.io/legacy-unknown'],
            verbs: ['sign'],
          },
        ]}
      />
    );

    const resourceCell = container.querySelector(
      '.gridtable-row[data-row-key] .grid-cell[data-column="resource"]'
    );
    expect(resourceCell?.textContent).toContain('signers');
    expect(resourceCell?.querySelector('.rbac-permission-names')?.textContent).toContain('2');
  });

  it('flags the wildcard verb with the unhealthy variant', async () => {
    const container = await render(
      <RBACRules policyRules={[{ resources: ['*'], verbs: ['*'] }]} />
    );

    const wildcardVerbChip = Array.from(
      container.querySelectorAll<HTMLElement>('.status-chip--unhealthy')
    ).find((el) => el.textContent?.trim() === '* (all)');
    expect(wildcardVerbChip).toBeTruthy();
  });
});
