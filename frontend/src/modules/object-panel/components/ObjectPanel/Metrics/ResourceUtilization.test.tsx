/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/ResourceUtilization.test.tsx
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import Utilization from './ResourceUtilization';

const MIB = 1024 ** 2;

vi.mock('@shared/components/ResourceBar', () => ({
  __esModule: true,
  default: vi.fn(() => <div data-testid="resource-bar" />),
}));

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('ResourceUtilization', () => {
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

  it("renders one resource's usage against its requests and limits", async () => {
    const cpu = await render(
      <Utilization data={{ usage: 200, request: 100, limit: 400, allocatable: 800 }} type="cpu" />
    );
    expect(cpu.container.textContent).toContain('200m');
    expect(cpu.container.querySelectorAll('[data-testid="resource-bar"]').length).toBe(1);
    cpu.cleanup();

    const memory = await render(
      <Utilization
        data={{ usage: 1536 * MIB, request: 512 * MIB, limit: 2048 * MIB }}
        type="memory"
      />
    );
    expect(memory.container.textContent).toContain('1.5Gi');
    memory.cleanup();
  });

  it('shows the peak usage next to the current usage when the chart has one', async () => {
    const withPeak = await render(<Utilization data={{ usage: 250 }} type="cpu" peak={300} />);
    const peakItem = Array.from(withPeak.container.querySelectorAll('.metric-legend__item')).find(
      (item) => item.textContent?.includes('peak')
    );
    expect(peakItem?.textContent).toContain('300m');
    withPeak.cleanup();

    const withoutPeak = await render(<Utilization data={{ usage: 250 }} type="cpu" />);
    expect(withoutPeak.container.textContent).not.toContain('peak');
    withoutPeak.cleanup();
  });

  it('shows allocatable row for node metrics mode', async () => {
    const { container, cleanup } = await render(
      <Utilization data={{ usage: 2000, allocatable: 4000 }} type="cpu" mode="nodeMetrics" />
    );

    expect(container.textContent).toContain('allocatable');
    cleanup();
  });
});
