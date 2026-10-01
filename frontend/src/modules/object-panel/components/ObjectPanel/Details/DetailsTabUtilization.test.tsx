/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabUtilization.test.tsx
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import Utilization from './DetailsTabUtilization';

const MIB = 1024 ** 2;

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

  it('renders CPU and Memory utilization details', async () => {
    const { container, cleanup } = await render(
      <Utilization
        cpu={{ usage: 200, request: 100, limit: 400, allocatable: 800 }}
        memory={{
          usage: 1536 * MIB,
          request: 512 * MIB,
          limit: 2048 * MIB,
          allocatable: 4096 * MIB,
        }}
      />
    );

    expect(container.textContent).toContain('CPU');
    expect(container.textContent).toContain('200m');
    expect(container.textContent).toContain('Memory');
    expect(container.textContent).toContain('1.5Gi');
    expect(container.querySelectorAll('[data-testid="resource-bar"]').length).toBe(2);
    cleanup();
  });

  it('shows allocatable row for node metrics mode', async () => {
    const { container, cleanup } = await render(
      <Utilization cpu={{ usage: 2000, allocatable: 4000 }} mode="nodeMetrics" />
    );

    expect(container.textContent).toContain('allocatable');
    cleanup();
  });

  it('shows pod count in section title for workload resources', async () => {
    const { container, cleanup } = await render(
      <Utilization cpu={{ usage: 400, request: 200, limit: 800 }} podCount={3} readyPodCount={3} />
    );
    expect(container.textContent).toContain('3/3 pods');
    cleanup();
  });

  it('shows only total pod count when readyPodCount is not provided', async () => {
    const { container, cleanup } = await render(
      <Utilization cpu={{ usage: 400, request: 200, limit: 800 }} podCount={5} />
    );
    expect(container.textContent).toContain('5 pods');
    // The "X/Y pods" form should not appear when readyPodCount is absent.
    expect(container.textContent).not.toMatch(/\d+\/\d+\s+pods/);
    cleanup();
  });

  it('does not show pod count when podCount is zero', async () => {
    const { container, cleanup } = await render(
      <Utilization cpu={{ usage: 400, request: 200, limit: 800 }} podCount={0} />
    );
    expect(container.textContent).not.toContain('pods');
    cleanup();
  });

  it('displays empty state when no utilization data is provided', async () => {
    const { container, cleanup } = await render(<Utilization />);
    expect(container.textContent).toContain('No resource utilization data available');
    cleanup();
  });
});
