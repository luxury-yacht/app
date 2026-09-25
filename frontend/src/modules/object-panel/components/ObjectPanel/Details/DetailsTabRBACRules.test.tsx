/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabRBACRules.test.tsx
 */

import { KeyboardProvider } from '@ui/shortcuts';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import RBACRules from './DetailsTabRBACRules';

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@core/contexts/ZoomContext', () => ({ useZoom: () => ({ zoomLevel: 100 }) }));

describe('DetailsTabRBACRules', () => {
  const render = async (ui: React.ReactElement) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    await act(async () => {
      root.render(<KeyboardProvider>{ui}</KeyboardProvider>);
      await Promise.resolve();
    });
    return {
      container,
      cleanup: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  };
  const rowTexts = (container: HTMLElement) =>
    [...container.querySelectorAll('.gridtable-row[data-row-key]')].map(
      (row) => row.textContent ?? ''
    );

  it('returns null when there are no rules', async () => {
    const { container, cleanup } = await render(<RBACRules />);
    expect(container.textContent).toBe('');
    cleanup();
  });

  it('shows one permission row per resource with every verb any rule grants it', async () => {
    const { container, cleanup } = await render(
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
    cleanup();
  });

  it('marks a grant limited to named objects in the resource cell', async () => {
    const { container, cleanup } = await render(
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
    cleanup();
  });

  it('flags the wildcard verb with the unhealthy variant', async () => {
    const { container, cleanup } = await render(
      <RBACRules policyRules={[{ resources: ['*'], verbs: ['*'] }]} />
    );

    const wildcardVerbChip = Array.from(
      container.querySelectorAll<HTMLElement>('.status-chip--unhealthy')
    ).find((el) => el.textContent?.trim() === '* (all)');
    expect(wildcardVerbChip).toBeTruthy();
    cleanup();
  });
});
