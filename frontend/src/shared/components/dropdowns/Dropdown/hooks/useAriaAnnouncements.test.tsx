import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useAriaAnnouncements } from './useAriaAnnouncements';

const options = [
  { value: 'pod', label: 'Pod' },
  { value: 'node', label: 'Node' },
];

afterEach(() => vi.useRealTimers());

it('keeps the latest accessible selection announcement for its full reading interval', () => {
  vi.useFakeTimers();
  const container = document.createElement('div');
  const root = createRoot(container);
  function Consumer({ value }: { value: string }) {
    const { announcementRef } = useAriaAnnouncements({
      value,
      options,
      isOpen: false,
      highlightedIndex: -1,
    });
    return <div ref={announcementRef} aria-live="polite" />;
  }
  try {
    act(() => root.render(<Consumer value="pod" />));
    act(() => vi.advanceTimersByTime(400));
    act(() => root.render(<Consumer value="node" />));
    const announcement = container.textContent;
    expect(announcement).not.toBe('');
    act(() => vi.advanceTimersByTime(100));
    expect(container.textContent).toBe(announcement);
    act(() => vi.advanceTimersByTime(900));
    expect(container.textContent).toBe('');
  } finally {
    act(() => root.unmount());
  }
});
