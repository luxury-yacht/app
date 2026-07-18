import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import WorkloadsPodsSplit from '@modules/namespace/components/WorkloadsPodsSplit';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const splitStyles = readFileSync(
  resolve(process.cwd(), 'src/modules/namespace/components/WorkloadsPodsSplit.css'),
  'utf8'
);

describe('WorkloadsPodsSplit', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    document.body.classList.remove('workloads-pods-resizing');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.classList.remove('workloads-pods-resizing');
  });

  it('starts evenly split and supports accessible keyboard resizing', () => {
    act(() => {
      root.render(
        <WorkloadsPodsSplit upper={<div>Workloads table</div>} lower={<div>Pods table</div>} />
      );
    });

    const separator = container.querySelector<HTMLElement>('hr[aria-orientation="horizontal"]');
    const split = container.querySelector<HTMLElement>('.workloads-pods-split');
    if (split) {
      split.getBoundingClientRect = () =>
        ({ top: 100, height: 400, bottom: 500, left: 0, right: 800, width: 800 }) as DOMRect;
    }
    expect(separator?.getAttribute('aria-orientation')).toBe('horizontal');
    expect(separator?.getAttribute('aria-valuenow')).toBe('50');
    expect(split).not.toBeNull();

    act(() =>
      separator?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    );
    expect(separator?.getAttribute('aria-valuenow')).toBe('54');
    expect(split?.style.getPropertyValue('--workloads-pods-upper-size')).toBe('54%');
  });

  it('tracks fine-grained pointer movement without snapping', () => {
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
      separator.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 306 }));
    });

    expect(separator.getAttribute('aria-valuenow')).toBe('51.5');
    expect(split.style.getPropertyValue('--workloads-pods-upper-size')).toBe('51.5%');
  });

  it('resizes from the drag delta without jumping on pointer down', () => {
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
      separator.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 306 }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('50');

    act(() => {
      separator.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 312 }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('51.5');
  });

  it('publishes the active resize state from pointer down through pointer up', () => {
    act(() => {
      root.render(
        <WorkloadsPodsSplit upper={<div>Workloads table</div>} lower={<div>Pods table</div>} />
      );
    });

    const split = container.querySelector<HTMLElement>('.workloads-pods-split');
    const separator = container.querySelector<HTMLElement>('hr[aria-orientation="horizontal"]');
    expect(split).toBeTruthy();
    expect(separator).toBeTruthy();

    act(() => {
      separator?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientY: 300 }));
    });
    expect(split?.classList.contains('workloads-pods-split--resizing')).toBe(true);
    expect(document.body.classList.contains('workloads-pods-resizing')).toBe(true);

    act(() => {
      separator?.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 300 }));
    });
    expect(split?.classList.contains('workloads-pods-split--resizing')).toBe(false);
    expect(document.body.classList.contains('workloads-pods-resizing')).toBe(false);
  });

  it('cancels the native pointer-down action when resizing starts', () => {
    act(() => {
      root.render(
        <WorkloadsPodsSplit upper={<div>Workloads table</div>} lower={<div>Pods table</div>} />
      );
    });

    const separator = container.querySelector<HTMLElement>('hr[aria-orientation="horizontal"]');
    const pointerDown = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientY: 300,
    });
    let dispatched = true;
    act(() => {
      dispatched = separator?.dispatchEvent(pointerDown) ?? true;
    });

    expect(dispatched).toBe(false);
    expect(pointerDown.defaultPrevented).toBe(true);
  });

  it('disables standard and WebKit text selection while resizing', () => {
    const resizingRule = splitStyles.match(
      /body\.workloads-pods-resizing \.app,\s*body\.workloads-pods-resizing \.app \*\s*{([^}]*)}/
    )?.[1];

    expect(resizingRule).toContain('user-select: none;');
    expect(resizingRule).toContain('-webkit-user-select: none;');
    expect(resizingRule).not.toContain('!important');
  });

  it('places the resize hit area directly on the split boundary', () => {
    const resizerRule = splitStyles.match(/\.workloads-pods-split__resizer\s*{([^}]*)}/)?.[1];

    expect(resizerRule).toContain('top: var(--workloads-pods-upper-size);');
    expect(resizerRule).toContain('right: 0;');
    expect(resizerRule).toContain('left: 0;');
    expect(resizerRule).toContain('height: 10px;');
    expect(resizerRule).toContain('transform: translateY(-50%);');
    expect(resizerRule).not.toContain('inset: 0;');
  });

  it('does not render a visible divider band', () => {
    act(() => {
      root.render(
        <WorkloadsPodsSplit upper={<div>Workloads table</div>} lower={<div>Pods table</div>} />
      );
    });

    expect(container.querySelector('.workloads-pods-split__divider')).toBeNull();
    expect(container.querySelector('[aria-label="Resize Workloads and Pods"]')).not.toBeNull();
  });

  it('shows a persistent separator line that thickens when the resize handle is active', () => {
    const separatorRule = splitStyles.match(
      /\.workloads-pods-split__resizer::after\s*{([^}]*)}/
    )?.[1];
    const activeSeparatorRule = splitStyles.match(
      /\.workloads-pods-split__resizer:hover::after,[^{]+{([^}]*)}/
    )?.[1];

    expect(separatorRule).toContain('height: 1px;');
    expect(separatorRule).toContain('background: var(--color-border);');
    expect(activeSeparatorRule).toContain('height: 4px;');
    expect(activeSeparatorRule).toContain('background: var(--color-resize-handle);');
  });

  it('consumes dock offsets once at the split boundary instead of once per table', () => {
    const splitRule = splitStyles.match(/\.workloads-pods-split\s*{([^}]*)}/)?.[1];
    const nestedTableRule = splitStyles.match(
      /\.content-body \.workloads-pods-split \.gridtable-wrapper,[^{]+{([^}]*)}/
    )?.[1];

    expect(splitRule).toContain('right: var(--dock-right-offset, 0px);');
    expect(splitRule).toContain('bottom: var(--dock-bottom-offset, 0px);');
    expect(nestedTableRule).toContain('margin-right: 0;');
    expect(nestedTableRule).toContain('margin-bottom: 0;');
  });

  it('retains the compact Pods section without a resize handle when collapsed', () => {
    const collapsedPodsRule = splitStyles.match(
      /\.workloads-pods-split--collapsed \.workloads-pods-split__pane--lower\s*{([^}]*)}/
    )?.[1];

    act(() => {
      root.render(
        <WorkloadsPodsSplit
          upper={<div>Workloads table</div>}
          lower={<div>Pods table</div>}
          collapsed
        />
      );
    });

    expect(container.textContent).toContain('Pods table');
    expect(container.querySelector('[aria-label="Resize Workloads and Pods"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Expand Pods"]')).toBeNull();
    expect(
      container.querySelector('.workloads-pods-split--collapsed .workloads-pods-split__pane--lower')
    ).not.toBeNull();
    expect(collapsedPodsRule).toContain('border-top: 1px solid var(--color-border);');

    act(() => {
      root.render(
        <WorkloadsPodsSplit
          upper={<div>Workloads table</div>}
          lower={<div>Pods table</div>}
          collapsed={false}
        />
      );
    });
    expect(container.textContent).toContain('Pods table');
  });
});
