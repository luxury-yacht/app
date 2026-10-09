/**
 * frontend/src/modules/object-panel/pods-panel/PodsPanelHost.test.tsx
 *
 * The host renders nothing where the Pods tab state is not provided (native
 * panel windows). Mounting, closing, and reopening run against the real dock in
 * PodsPanelLifecycle.test.tsx.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PodsPanelHost } from './PodsPanelHost';

vi.mock('@ui/dockable', () => ({
  useDockablePanelContext: () => ({ discardPanelLayouts: vi.fn() }),
}));

describe('PodsPanelHost', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders nothing outside the main window provider', async () => {
    await act(async () => {
      root.render(<PodsPanelHost />);
    });
    expect(container.innerHTML).toBe('');
  });
});
