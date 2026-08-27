/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabUtilization.test.tsx
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import Utilization from './DetailsTabUtilization';

vi.mock('@shared/components/ResourceBar', () => ({
  __esModule: true,
  default: vi.fn(() => <div data-testid="resource-bar" />),
}));

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('DetailsTabUtilization', () => {
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

  it('covers DetailsTabUtilization scenarios', async () => {
    {
      // Scenario: renders CPU and Memory utilization details
      const { container, cleanup } = await render(
        <Utilization
          cpu={{ usage: '200m', request: '100m', limit: '400m', allocatable: '800m' }}
          memory={{ usage: '1Gi', request: '512Mi', limit: '2Gi', allocatable: '4Gi' }}
        />
      );

      expect(container.textContent).toContain('CPU');
      expect(container.textContent).toContain('200m');
      expect(container.textContent).toContain('Memory');
      expect(container.textContent).toContain('1Gi');
      expect(container.querySelectorAll('[data-testid="resource-bar"]').length).toBe(2);
      cleanup();
    }

    {
      // Scenario: shows allocatable row for node metrics mode
      const { container, cleanup } = await render(
        <Utilization cpu={{ usage: '2', allocatable: '4' }} mode="nodeMetrics" />
      );

      expect(container.textContent).toContain('allocatable');
      cleanup();
    }

    {
      // Scenario: shows pod count in section title for workload resources
      const { container, cleanup } = await render(
        <Utilization
          cpu={{ usage: '400m', request: '200m', limit: '800m' }}
          podCount={3}
          readyPodCount={3}
        />
      );
      expect(container.textContent).toContain('3/3 pods');
      cleanup();
    }

    {
      // Scenario: shows only total pod count when readyPodCount is not provided
      const { container, cleanup } = await render(
        <Utilization cpu={{ usage: '400m', request: '200m', limit: '800m' }} podCount={5} />
      );
      expect(container.textContent).toContain('5 pods');
      // The "X/Y pods" form should not appear when readyPodCount is absent.
      expect(container.textContent).not.toMatch(/\d+\/\d+\s+pods/);
      cleanup();
    }

    {
      // Scenario: does not show pod count when podCount is zero
      const { container, cleanup } = await render(
        <Utilization cpu={{ usage: '400m', request: '200m', limit: '800m' }} podCount={0} />
      );
      expect(container.textContent).not.toContain('pods');
      cleanup();
    }

    {
      // Scenario: displays empty state when no utilization data is provided
      const { container, cleanup } = await render(<Utilization />);
      expect(container.textContent).toContain('No resource utilization data available');
      cleanup();
    }
  });
});
