import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { DetailsSectionProvider } from '@core/contexts/DetailsSectionContext';
import Utilization from './DetailsTabUtilization';

vi.mock('@shared/components/ResourceBar', () => ({
  __esModule: true,
  default: vi.fn(() => <div data-testid="resource-bar" />),
}));

describe('DetailsTabUtilization', () => {
  const renderWithProvider = async (ui: React.ReactElement) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    await act(async () => {
      root.render(<DetailsSectionProvider>{ui}</DetailsSectionProvider>);
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
    const { container, cleanup } = await renderWithProvider(
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
  });

  it('shows allocatable row for node metrics mode', async () => {
    const { container, cleanup } = await renderWithProvider(
      <Utilization cpu={{ usage: '2', allocatable: '4' }} mode="nodeMetrics" />
    );

    expect(container.textContent).toContain('Allocatable');
    cleanup();
  });

  it('displays empty state when no utilization data is provided', async () => {
    const { container, cleanup } = await renderWithProvider(<Utilization />);
    expect(container.textContent).toContain('No resource utilization data available');
    cleanup();
  });

  it('toggles section collapsed state when header is clicked', async () => {
    const { container, cleanup } = await renderWithProvider(
      <Utilization cpu={{ usage: '100m', request: '50m', limit: '200m' }} />
    );

    expect(container.textContent).toContain('CPU');
    const header = container.querySelector('.object-panel-section-title')!;
    await act(async () => {
      header.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).not.toContain('CPU');
    cleanup();
  });
});
