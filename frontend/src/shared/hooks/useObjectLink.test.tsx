import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  available: true,
  navigateToView: vi.fn(),
  openWithObject: vi.fn(),
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: mocks.openWithObject }),
}));
vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({
    available: mocks.available,
    navigateToView: mocks.navigateToView,
  }),
}));

import { useObjectLink } from './useObjectLink';

describe('useObjectLink', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let objectLink!: ReturnType<typeof useObjectLink>;

  function Harness() {
    objectLink = useObjectLink();
    return null;
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    mocks.available = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('omits the navigation-only handler when workspace navigation is unavailable', () => {
    mocks.available = false;
    act(() => root.render(<Harness />));
    const objectRef = {
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'default',
      name: 'api',
    };
    const handlers = objectLink(() => objectRef);

    expect(handlers.onAltClick).toBeUndefined();
    handlers.onClick(objectRef);
    expect(mocks.openWithObject).toHaveBeenCalledWith(objectRef);
  });
});
