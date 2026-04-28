/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabRBACRules.test.tsx
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
import RBACRules from './DetailsTabRBACRules';

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: any) => <>{children}</>,
}));

describe('DetailsTabRBACRules', () => {
  const render = async (ui: React.ReactElement) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    await act(async () => {
      root.render(ui);
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

  it('returns null when there are no rules', async () => {
    const { container, cleanup } = await render(<RBACRules />);
    expect(container.firstChild).toBeNull();
    cleanup();
  });

  it('renders a card per rule with verb chips and resource title', async () => {
    const { container, cleanup } = await render(
      <RBACRules
        policyRules={[
          {
            apiGroups: ['', 'apps'],
            resources: ['deployments', 'pods'],
            verbs: ['get', 'list', '*'],
          },
          {
            nonResourceURLs: ['/healthz'],
            verbs: ['get'],
          },
        ]}
      />
    );

    expect(container.textContent).toContain('Rules');
    expect(container.textContent).toContain('deployments');
    expect(container.textContent).toContain('pods');
    expect(container.textContent).toContain('* (all)');
    expect(container.textContent).toContain('/healthz');
    // empty-string apiGroup renders as `core`, not `""`
    expect(container.textContent).toContain('core');
    expect(container.textContent).not.toContain('""');
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
