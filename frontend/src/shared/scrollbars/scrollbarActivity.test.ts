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

  it('routes wheel activity from overlay thumbs back to the owning scroll container', () => {
    const element = createScrollableElement();

    dispatchWheel(element);
    const thumb = document.body.querySelector('.scrollbar-overlay-thumb--vertical');
    expect(thumb).toBeTruthy();

    vi.advanceTimersByTime(10);
    dispatchWheel(thumb!);
    vi.advanceTimersByTime(15);

    expect(document.body.querySelector('.scrollbar-overlay-thumb--vertical')).toBeTruthy();
  });
});
