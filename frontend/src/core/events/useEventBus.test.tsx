import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { eventBus } from './eventBus';
import { useEventBus } from './useEventBus';

describe('useEventBus', () => {
  it('uses the latest callback without resubscribing when explicit dependencies are unchanged', () => {
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    const onSpy = vi.spyOn(eventBus, 'on');

    const Harness: React.FC<{ callback: () => void }> = ({ callback }) => {
      useEventBus('view:reset', callback);
      return null;
    };

    const container = document.createElement('div');
    const root = ReactDOM.createRoot(container);
    act(() => root.render(<Harness callback={firstCallback} />));
    act(() => eventBus.emit('view:reset'));

    act(() => root.render(<Harness callback={secondCallback} />));
    act(() => eventBus.emit('view:reset'));

    expect(onSpy).toHaveBeenCalledTimes(1);
    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });
});
