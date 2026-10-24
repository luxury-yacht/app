/**
 * frontend/src/core/refresh/hooks/useDocumentVisibilityEvents.test.tsx
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { useDocumentVisibilityEvents } from './useDocumentVisibilityEvents';

const setDocumentHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
};

const Harness = () => {
  useDocumentVisibilityEvents();
  return null;
};

describe('useDocumentVisibilityEvents', () => {
  afterEach(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  // A hidden window pauses polls and suspends streams through these events.
  it('publishes visibility changes while mounted, and stops after unmount', () => {
    const hidden = vi.fn();
    const visible = vi.fn();
    const offHidden = eventBus.on('app:visibility-hidden', hidden);
    const offVisible = eventBus.on('app:visibility-visible', visible);
    const container = document.createElement('div');
    const root = ReactDOM.createRoot(container);
    act(() => root.render(<Harness />));
    expect(visible).toHaveBeenCalledTimes(1);

    setDocumentHidden(true);
    setDocumentHidden(false);
    expect(hidden).toHaveBeenCalledTimes(1);
    expect(visible).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
    setDocumentHidden(true);
    expect(hidden).toHaveBeenCalledTimes(1);
    offHidden?.();
    offVisible?.();
  });

  // No visibilitychange fires for the state a window starts in, so a window
  // that opens hidden would poll until it is shown and hidden again.
  it('publishes the visibility the window has when it mounts', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    const hidden = vi.fn();
    const offHidden = eventBus.on('app:visibility-hidden', hidden);
    const container = document.createElement('div');
    const root = ReactDOM.createRoot(container);

    act(() => root.render(<Harness />));

    expect(hidden).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    offHidden?.();
  });
});
