/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabContainers.test.tsx
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect } from 'vitest';
import Containers from './DetailsTabContainers';

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

  it('renders init and standard containers with parsed image name and tag', async () => {
    const { container, cleanup } = await render(
      <Containers
        initContainers={[{ name: 'init-db', image: 'registry.internal/db:1.2.3' }]}
        containers={[{ name: 'app', image: 'app-image' }]}
      />
    );

    expect(container.textContent).toContain('Init');
    expect(container.textContent).toContain('Standard');
    expect(container.textContent).toContain('registry.internal/db');
    expect(container.textContent).toContain('1.2.3');
    expect(container.textContent).toContain('app-image');
    expect(container.textContent).toContain('latest');
    cleanup();
  });

  it('returns null when there are no containers', async () => {
    const { container, cleanup } = await render(<Containers />);
    expect(container.firstChild).toBeNull();
    cleanup();
  });
});
