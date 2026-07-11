import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveAgeText } from './LiveAgeText';

describe('LiveAgeText', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('updates relative text from the shared clock without receiving new props', async () => {
    await act(async () => {
      root.render(<LiveAgeText timestamp="2026-01-01T00:00:00Z" />);
      await Promise.resolve();
    });

    expect(container.textContent).toBe('10s');

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(container.textContent).toBe('11s');
  });

  it('renders fallback text for missing timestamps', async () => {
    await act(async () => {
      root.render(<LiveAgeText timestamp={undefined} fallback="—" />);
      await Promise.resolve();
    });

    expect(container.textContent).toBe('—');
  });
});
