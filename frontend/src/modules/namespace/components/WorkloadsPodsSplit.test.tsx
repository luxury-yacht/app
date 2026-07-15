import WorkloadsPodsSplit from '@modules/namespace/components/WorkloadsPodsSplit';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('WorkloadsPodsSplit', () => {
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

  it('starts evenly split and supports accessible keyboard resizing', () => {
    act(() => {
      root.render(
        <WorkloadsPodsSplit upper={<div>Workloads table</div>} lower={<div>Pods table</div>} />
      );
    });

    const separator = container.querySelector<HTMLElement>('hr[aria-orientation="horizontal"]');
    expect(separator?.getAttribute('aria-orientation')).toBe('horizontal');
    expect(separator?.getAttribute('aria-valuenow')).toBe('50');
    expect(container.querySelector('.workloads-pods-split--50')).not.toBeNull();

    act(() =>
      separator?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    );
    expect(separator?.getAttribute('aria-valuenow')).toBe('55');
    expect(container.querySelector('.workloads-pods-split--55')).not.toBeNull();
  });

  it('resizes from pointer movement within the split container', () => {
    act(() => {
      root.render(
        <WorkloadsPodsSplit upper={<div>Workloads table</div>} lower={<div>Pods table</div>} />
      );
    });

    const split = container.querySelector<HTMLElement>('.workloads-pods-split');
    const separator = container.querySelector<HTMLElement>('hr[aria-orientation="horizontal"]');
    expect(split).toBeTruthy();
    expect(separator).toBeTruthy();
    if (!split || !separator) {
      return;
    }
    split.getBoundingClientRect = () =>
      ({ top: 100, height: 400, bottom: 500, left: 0, right: 800, width: 800 }) as DOMRect;

    act(() => {
      separator.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 300 }));
      separator.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 380 }));
    });

    expect(separator.getAttribute('aria-valuenow')).toBe('70');
    expect(container.querySelector('.workloads-pods-split--70')).not.toBeNull();
  });

  it('collapses and restores the Pods pane without removing its header control', () => {
    act(() => {
      root.render(
        <WorkloadsPodsSplit upper={<div>Workloads table</div>} lower={<div>Pods table</div>} />
      );
    });

    const collapse = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse Pods"]'
    );
    act(() => collapse?.click());
    expect(container.textContent).not.toContain('Pods table');
    expect(container.querySelector('button[aria-label="Expand Pods"]')).not.toBeNull();

    act(() =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Expand Pods"]')?.click()
    );
    expect(container.textContent).toContain('Pods table');
  });
});
