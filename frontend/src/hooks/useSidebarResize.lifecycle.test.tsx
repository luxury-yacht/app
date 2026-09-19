import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSidebarResize } from './useSidebarResize';

let root: Root;
let container: HTMLDivElement;
const onWidthChange = vi.fn();
const onResizeEnd = vi.fn();
function Probe({ resizing }: { resizing: boolean }) {
  useSidebarResize({ isResizing: resizing, onWidthChange, onResizeEnd });
  return null;
}
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('stops width updates when the owning sidebar ends the drag', async () => {
  await act(async () => root.render(<Probe resizing />));
  act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 })));
  expect(onWidthChange).toHaveBeenLastCalledWith(300);
  await act(async () => root.render(<Probe resizing={false} />));
  onWidthChange.mockClear();
  act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 })));
  expect(onWidthChange).not.toHaveBeenCalled();
  expect(onResizeEnd).not.toHaveBeenCalled();
});

it('clamps the drag, reports mouse release, and removes tracking on unmount', async () => {
  await act(async () => root.render(<Probe resizing />));
  act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 })));
  expect(onWidthChange).toHaveBeenLastCalledWith(200);
  act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 800 })));
  expect(onWidthChange).toHaveBeenLastCalledWith(500);
  act(() => document.dispatchEvent(new MouseEvent('mouseup')));
  expect(onResizeEnd).toHaveBeenCalledOnce();
  await act(async () => root.render(null));
  onWidthChange.mockClear();
  act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 })));
  expect(onWidthChange).not.toHaveBeenCalled();
});
