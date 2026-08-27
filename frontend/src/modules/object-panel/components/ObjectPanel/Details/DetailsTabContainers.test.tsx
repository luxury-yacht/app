/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabContainers.test.tsx
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import Containers from './DetailsTabContainers';

vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('DetailsTabContainers', () => {
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

  it('covers DetailsTabContainers scenarios', async () => {
    {
      // Scenario: renders init and standard containers in separate sub-groups when both are present
      const { container, cleanup } = await render(
        <Containers
          initContainers={[
            {
              name: 'init-db',
              image: 'registry.internal/db:1.2.3',
              state: 'Terminated',
              stateReason: 'Completed',
            },
          ]}
          containers={[{ name: 'app', image: 'app-image', state: 'Running' }]}
        />
      );

      expect(container.textContent).toContain('Init Containers');
      expect(container.textContent).toContain('Containers');
      expect(container.textContent).toContain('init-db');
      expect(container.textContent).toContain('registry.internal/db');
      expect(container.textContent).toContain('1.2.3');
      expect(container.textContent).toContain('app');
      expect(container.textContent).toContain('app-image');
      expect(container.textContent).toContain('latest');
      cleanup();
    }

    {
      // Scenario: omits the sub-heading when only standard containers are present
      const { container, cleanup } = await render(
        <Containers containers={[{ name: 'app', image: 'app:1.0', state: 'Running' }]} />
      );

      expect(container.textContent).toContain('Containers');
      // No sub-heading "Init Containers" should show when there are no init containers
      expect(container.textContent).not.toContain('Init Containers');
      cleanup();
    }

    {
      // Scenario: shows restart count chip when restartCount > 0
      const { container, cleanup } = await render(
        <Containers
          containers={[{ name: 'app', image: 'app:1.0', state: 'Running', restartCount: 3 }]}
        />
      );

      expect(container.textContent).toContain('3 restarts');
      cleanup();
    }

    {
      // Scenario: shows the state reason in the state chip label
      const { container, cleanup } = await render(
        <Containers
          containers={[
            {
              name: 'app',
              image: 'app:1.0',
              state: 'Waiting',
              stateReason: 'CrashLoopBackOff',
            },
          ]}
        />
      );

      expect(container.textContent).toContain('Waiting: CrashLoopBackOff');
      cleanup();
    }

    {
      // Scenario: shows resources row when any cpu/mem field is set
      const { container, cleanup } = await render(
        <Containers
          containers={[
            {
              name: 'app',
              image: 'app:1.0',
              state: 'Running',
              cpuRequest: '100m',
              cpuLimit: '500m',
              memRequest: '256Mi',
              memLimit: '1Gi',
            },
          ]}
        />
      );

      expect(container.textContent).toContain('100m');
      expect(container.textContent).toContain('500m');
      expect(container.textContent).toContain('256Mi');
      expect(container.textContent).toContain('1Gi');
      cleanup();
    }

    {
      // Scenario: returns null when there are no containers
      const { container, cleanup } = await render(<Containers />);
      expect(container.firstChild).toBeNull();
      cleanup();
    }
  });
});
