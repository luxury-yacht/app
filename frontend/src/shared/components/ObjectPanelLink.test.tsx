/**
 * frontend/src/shared/components/ObjectPanelLink.test.tsx
 *
 * Plain click opens the objectRef; alt-click navigates. When a `navigateRef`
 * is supplied it overrides the alt-click target — used by the namespace field
 * so alt-click reveals the HOST object instead of the Namespace kind.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

const openWithObject = vi.fn();
const navigateToView = vi.fn();

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject }),
}));
vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView }),
}));

import { ObjectPanelLink } from './ObjectPanelLink';

const objectRef = { kind: 'Namespace', name: 'shop', clusterId: 'c1' };
const hostRef = { kind: 'Pod', name: 'web-5', namespace: 'shop', clusterId: 'c1' };

describe('ObjectPanelLink', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    openWithObject.mockClear();
    navigateToView.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderLink = (navigateRef?: typeof hostRef) => {
    act(() => {
      root.render(
        <ObjectPanelLink objectRef={objectRef} navigateRef={navigateRef}>
          shop
        </ObjectPanelLink>
      );
    });
    return requireValue(
      container.querySelector<HTMLElement>('.object-panel-link'),
      'expected test value in ObjectPanelLink.test.tsx'
    );
  };
  const click = (el: HTMLElement, altKey: boolean) =>
    act(() => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey }));
    });

  it('opens the objectRef on a plain click', () => {
    click(renderLink(), false);
    expect(openWithObject).toHaveBeenCalledWith(objectRef);
    expect(navigateToView).not.toHaveBeenCalled();
  });

  it('navigates to the objectRef on alt-click when no navigateRef is given', () => {
    click(renderLink(), true);
    expect(navigateToView).toHaveBeenCalledWith(objectRef);
    expect(openWithObject).not.toHaveBeenCalled();
  });

  it('navigates to the navigateRef on alt-click when provided (plain click still opens objectRef)', () => {
    const link = renderLink(hostRef);
    click(link, true);
    expect(navigateToView).toHaveBeenCalledWith(hostRef);

    click(link, false);
    expect(openWithObject).toHaveBeenCalledWith(objectRef);
  });
});
