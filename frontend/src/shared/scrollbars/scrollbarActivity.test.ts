import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetScrollbarActivityTrackingForTest,
  initializeScrollbarActivityTracking,
} from './scrollbarActivity';

const defineMetric = (element: HTMLElement, name: keyof HTMLElement, value: number) => {
  Object.defineProperty(element, name, {
    configurable: true,
    value,
    writable: true,
  });
};

const createScrollableElement = () => {
  const element = document.createElement('div');
  element.style.overflowX = 'auto';
  element.style.overflowY = 'auto';
  element.style.width = '100px';
  element.style.height = '100px';
  defineMetric(element, 'clientWidth', 100);
  defineMetric(element, 'clientHeight', 100);
  defineMetric(element, 'scrollWidth', 100);
  defineMetric(element, 'scrollHeight', 500);
  element.scrollTop = 0;
  element.scrollLeft = 0;
  element.getBoundingClientRect = () =>
    ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    }) as DOMRect;
  document.body.appendChild(element);
  return element;
};

const dispatchWheel = (target: Element, deltaY = 24) => {
  target.dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: true,
      deltaY,
    })
  );
};

const dispatchPointerMove = (clientX: number, clientY: number) => {
  document.dispatchEvent(
    new MouseEvent('pointermove', {
      bubbles: true,
      clientX,
      clientY,
    })
  );
};

const dispatchPointerDown = (target: Element, clientX: number, clientY: number) => {
  target.dispatchEvent(
    new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
    })
  );
};

describe('scrollbar activity tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) =>
      window.setTimeout(() => callback(performance.now()), 0)
    );
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) =>
      window.clearTimeout(handle)
    );

    document.documentElement.style.setProperty('--scrollbar-active-timeout', '20ms');
    document.documentElement.style.setProperty('--scrollbar-fade-in-duration', '0ms');
    document.documentElement.style.setProperty('--scrollbar-fade-out-duration', '0ms');
    document.documentElement.style.setProperty('--scrollbar-width', '5px');
    document.documentElement.style.setProperty('--scrollbar-height', '5px');
    document.documentElement.style.setProperty('--scrollbar-thumb-inset', '1px');
    document.documentElement.style.setProperty('--scrollbar-hover-zone-size', '16px');
    document.documentElement.style.setProperty('--scrollbar-hover-scale', '3');
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [],
    });
    initializeScrollbarActivityTracking();
  });

  afterEach(() => {
    __resetScrollbarActivityTrackingForTest();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('style');
  });

  it('creates overlay scrollbars for any scrollable app element', () => {
    const element = createScrollableElement();

    dispatchWheel(element);

    expect(document.body.querySelector('.scrollbar-overlay-thumb--vertical')).toBeTruthy();
    expect(document.body.querySelector('.scrollbar-overlay-gutter--vertical')).toBeTruthy();
  });

  it('keeps a hovered scrollbar visible until the pointer leaves the hover zone', () => {
    const element = createScrollableElement();
    vi.spyOn(document, 'elementsFromPoint').mockReturnValue([element]);

    dispatchPointerMove(99, 50);
    vi.advanceTimersByTime(100);

    expect(document.body.querySelector('.scrollbar-overlay-thumb--vertical')).toBeTruthy();

    dispatchPointerMove(10, 50);
    vi.advanceTimersByTime(25);

    expect(document.body.querySelector('.scrollbar-overlay-thumb--vertical')).toBeNull();
  });

  it('routes wheel scrolling from overlay thumbs back to the owning scroll container', () => {
    const element = createScrollableElement();

    dispatchWheel(element);
    const thumb = document.body.querySelector('.scrollbar-overlay-thumb--vertical');
    expect(thumb).toBeTruthy();

    expect(element.scrollTop).toBe(0);
    dispatchWheel(thumb!);

    expect(document.body.querySelector('.scrollbar-overlay-thumb--vertical')).toBeTruthy();
    expect(element.scrollTop).toBe(24);
  });

  it('page-scrolls when the visible gutter track is clicked', () => {
    const element = createScrollableElement();
    vi.spyOn(document, 'elementsFromPoint').mockReturnValue([element]);

    dispatchPointerMove(99, 50);
    const gutter = document.body.querySelector('.scrollbar-overlay-gutter--vertical');
    expect(gutter).toBeTruthy();

    dispatchPointerDown(gutter!, 99, 95);

    expect(element.scrollTop).toBe(100);
  });

  it('uses real hover dimensions so the thumb rounds from its expanded box', () => {
    const element = createScrollableElement();
    vi.spyOn(document, 'elementsFromPoint').mockReturnValue([element]);

    dispatchPointerMove(99, 50);

    const thumb = document.body.querySelector<HTMLElement>('.scrollbar-overlay-thumb--vertical');
    const gutter = document.body.querySelector<HTMLElement>('.scrollbar-overlay-gutter--vertical');
    expect(thumb?.style.width).toBe('9px');
    expect(gutter?.style.width).toBe('15px');
    expect(thumb?.style.transform).toBe('');
    expect(gutter?.style.transform).toBe('');
  });

  it('keeps base content overlays in the body stacking layer', () => {
    const element = createScrollableElement();

    dispatchWheel(element);

    const thumb = document.body.querySelector<HTMLElement>('.scrollbar-overlay-thumb--vertical');
    expect(thumb?.parentElement).toBe(document.body);
    expect(thumb?.style.position).toBe('fixed');
  });

  it('keeps dockable panel overlays inside the owning panel stacking context', () => {
    const panel = document.createElement('div');
    panel.className = 'dockable-panel';
    panel.style.position = 'absolute';
    panel.style.zIndex = '1200';
    panel.getBoundingClientRect = () =>
      ({
        bottom: 225,
        height: 200,
        left: 50,
        right: 250,
        top: 25,
        width: 200,
        x: 50,
        y: 25,
        toJSON: () => undefined,
      }) as DOMRect;
    document.body.appendChild(panel);

    const element = createScrollableElement();
    element.getBoundingClientRect = () =>
      ({
        bottom: 175,
        height: 100,
        left: 150,
        right: 250,
        top: 75,
        width: 100,
        x: 150,
        y: 75,
        toJSON: () => undefined,
      }) as DOMRect;
    panel.appendChild(element);

    dispatchWheel(element);

    const thumb = panel.querySelector<HTMLElement>('.scrollbar-overlay-thumb--vertical');
    expect(thumb?.parentElement).toBe(panel);
    expect(thumb?.style.position).toBe('absolute');
    expect(thumb?.style.left).toBe('196px');
    expect(thumb?.style.top).toBe('51px');
  });

  it('keeps command palette overlays inside the palette stacking context', () => {
    const palette = document.createElement('div');
    palette.className = 'command-palette';
    palette.getBoundingClientRect = () =>
      ({
        bottom: 300,
        height: 240,
        left: 100,
        right: 500,
        top: 60,
        width: 400,
        x: 100,
        y: 60,
        toJSON: () => undefined,
      }) as DOMRect;
    document.body.appendChild(palette);

    const element = createScrollableElement();
    element.className = 'command-palette-results';
    element.getBoundingClientRect = () =>
      ({
        bottom: 260,
        height: 180,
        left: 120,
        right: 480,
        top: 80,
        width: 360,
        x: 120,
        y: 80,
        toJSON: () => undefined,
      }) as DOMRect;
    palette.appendChild(element);

    dispatchWheel(element);

    const thumb = palette.querySelector<HTMLElement>('.scrollbar-overlay-thumb--vertical');
    expect(thumb?.parentElement).toBe(palette);
    expect(thumb?.style.position).toBe('absolute');
    expect(thumb?.style.left).toBe('376px');
    expect(thumb?.style.top).toBe('21px');
  });

  it('uses native dropdown scrolling instead of overlay scrollbars', () => {
    const menu = createScrollableElement();
    menu.className = 'dropdown-menu';
    menu.style.overflowX = 'hidden';
    menu.style.overflowY = 'auto';
    defineMetric(menu, 'scrollWidth', 130);

    dispatchWheel(menu);

    expect(menu.classList.contains('scrollbar-active')).toBe(true);
    expect(document.body.querySelector('.scrollbar-overlay-thumb--vertical')).toBeNull();
    expect(document.body.querySelector('.scrollbar-overlay-thumb--horizontal')).toBeNull();
  });

  it('keeps settings modal overlays inside the modal stacking context', () => {
    const modal = document.createElement('div');
    modal.className = 'modal-container settings-modal';
    modal.getBoundingClientRect = () =>
      ({
        bottom: 420,
        height: 360,
        left: 100,
        right: 500,
        top: 60,
        width: 400,
        x: 100,
        y: 60,
        toJSON: () => undefined,
      }) as DOMRect;
    document.body.appendChild(modal);

    const element = createScrollableElement();
    element.className = 'modal-content settings-modal-content';
    element.getBoundingClientRect = () =>
      ({
        bottom: 390,
        height: 300,
        left: 120,
        right: 480,
        top: 90,
        width: 360,
        x: 120,
        y: 90,
        toJSON: () => undefined,
      }) as DOMRect;
    modal.appendChild(element);

    dispatchWheel(element);

    const thumb = modal.querySelector<HTMLElement>('.scrollbar-overlay-thumb--vertical');
    expect(thumb?.parentElement).toBe(modal);
    expect(thumb?.style.position).toBe('absolute');
    expect(thumb?.style.left).toBe('376px');
    expect(thumb?.style.top).toBe('31px');
  });

  it('keeps modal diff viewer overlays inside the modal stacking context', () => {
    const modal = document.createElement('div');
    modal.className = 'modal-container object-diff-modal';
    modal.getBoundingClientRect = () =>
      ({
        bottom: 520,
        height: 460,
        left: 80,
        right: 680,
        top: 60,
        width: 600,
        x: 80,
        y: 60,
        toJSON: () => undefined,
      }) as DOMRect;
    document.body.appendChild(modal);

    const element = createScrollableElement();
    element.className = 'object-diff-table';
    element.getBoundingClientRect = () =>
      ({
        bottom: 500,
        height: 360,
        left: 100,
        right: 660,
        top: 140,
        width: 560,
        x: 100,
        y: 140,
        toJSON: () => undefined,
      }) as DOMRect;
    modal.appendChild(element);

    dispatchWheel(element);

    const thumb = modal.querySelector<HTMLElement>('.scrollbar-overlay-thumb--vertical');
    expect(thumb?.parentElement).toBe(modal);
    expect(thumb?.style.position).toBe('absolute');
    expect(thumb?.style.left).toBe('576px');
    expect(thumb?.style.top).toBe('81px');
  });

  it('keeps elevated popover overlays inside the nearest popover stacking context', () => {
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip status-popover';
    tooltip.getBoundingClientRect = () =>
      ({
        bottom: 240,
        height: 180,
        left: 300,
        right: 620,
        top: 60,
        width: 320,
        x: 300,
        y: 60,
        toJSON: () => undefined,
      }) as DOMRect;
    document.body.appendChild(tooltip);

    const element = createScrollableElement();
    element.className = 'sessions-status-tracking';
    element.getBoundingClientRect = () =>
      ({
        bottom: 220,
        height: 140,
        left: 320,
        right: 600,
        top: 80,
        width: 280,
        x: 320,
        y: 80,
        toJSON: () => undefined,
      }) as DOMRect;
    tooltip.appendChild(element);

    dispatchWheel(element);

    const thumb = tooltip.querySelector<HTMLElement>('.scrollbar-overlay-thumb--vertical');
    expect(thumb?.parentElement).toBe(tooltip);
    expect(thumb?.style.position).toBe('absolute');
    expect(thumb?.style.left).toBe('296px');
    expect(thumb?.style.top).toBe('21px');
  });

  it('activates one scrollbar axis in the corner hover zone', () => {
    const element = createScrollableElement();
    defineMetric(element, 'scrollWidth', 500);
    vi.spyOn(document, 'elementsFromPoint').mockReturnValue([element]);

    dispatchPointerMove(99, 99);

    expect(
      document.body
        .querySelector('.scrollbar-overlay-thumb--vertical')
        ?.classList.contains('scrollbar-overlay-thumb--hovered')
    ).toBe(true);
    expect(
      document.body
        .querySelector('.scrollbar-overlay-thumb--horizontal')
        ?.classList.contains('scrollbar-overlay-thumb--hovered')
    ).toBe(false);
  });

  it('clips overlay geometry to overflowing ancestors', () => {
    const ancestor = document.createElement('div');
    ancestor.style.overflowX = 'hidden';
    ancestor.style.overflowY = 'hidden';
    ancestor.getBoundingClientRect = () =>
      ({
        bottom: 80,
        height: 80,
        left: 0,
        right: 100,
        top: 0,
        width: 100,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      }) as DOMRect;
    document.body.appendChild(ancestor);

    const element = createScrollableElement();
    element.getBoundingClientRect = () =>
      ({
        bottom: 120,
        height: 120,
        left: 0,
        right: 100,
        top: 0,
        width: 100,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      }) as DOMRect;
    ancestor.appendChild(element);

    dispatchWheel(element);

    const gutter = document.body.querySelector<HTMLElement>('.scrollbar-overlay-gutter--vertical');
    expect(gutter?.style.height).toBe('80px');
  });

  it('does not animate fades when reduced motion is requested', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(
        () =>
          ({
            addEventListener: vi.fn(),
            addListener: vi.fn(),
            dispatchEvent: vi.fn(),
            matches: true,
            media: '(prefers-reduced-motion: reduce)',
            onchange: null,
            removeEventListener: vi.fn(),
            removeListener: vi.fn(),
          }) as MediaQueryList
      ),
    });
    document.documentElement.style.setProperty('--scrollbar-fade-in-duration', '200ms');
    const element = createScrollableElement();

    dispatchWheel(element);

    expect(element.style.getPropertyValue('--scrollbar-thumb-current-opacity')).toBe('1');
  });

  it('does not restart fade-in while wheel movement is still active', () => {
    document.documentElement.style.setProperty('--scrollbar-active-timeout', '1000ms');
    document.documentElement.style.setProperty('--scrollbar-fade-in-duration', '200ms');
    const cancelAnimationFrameSpy = vi.mocked(window.cancelAnimationFrame);
    const element = createScrollableElement();

    dispatchWheel(element);
    dispatchWheel(element);
    dispatchWheel(element);

    expect(cancelAnimationFrameSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    const opacity = Number.parseFloat(
      element.style.getPropertyValue('--scrollbar-thumb-current-opacity')
    );
    expect(opacity).toBeGreaterThan(0);
  });
});
