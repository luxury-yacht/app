const SCROLLBAR_ACTIVE_CLASS = 'scrollbar-active';
const DEFAULT_ACTIVE_TIMEOUT_MS = 900;

const activeTimers = new WeakMap<Element, number>();
let initialized = false;

const parseDurationMs = (value: string): number => {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_ACTIVE_TIMEOUT_MS;
  }

  if (trimmed.endsWith('ms')) {
    const parsed = Number.parseFloat(trimmed.slice(0, -2));
    return Number.isFinite(parsed) ? parsed : DEFAULT_ACTIVE_TIMEOUT_MS;
  }

  if (trimmed.endsWith('s')) {
    const parsed = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(parsed) ? parsed * 1000 : DEFAULT_ACTIVE_TIMEOUT_MS;
  }

  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : DEFAULT_ACTIVE_TIMEOUT_MS;
};

const readActiveTimeoutMs = (): number => {
  const styles = getComputedStyle(document.documentElement);
  return parseDurationMs(styles.getPropertyValue('--scrollbar-active-timeout'));
};

const resolveScrollElement = (target: EventTarget | null): Element | null => {
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Document) {
    return target.scrollingElement ?? target.documentElement;
  }
  return null;
};

const canScroll = (element: Element): boolean => {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  const styles = getComputedStyle(element);
  const overflowX = styles.overflowX;
  const overflowY = styles.overflowY;
  const scrollsX =
    (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') &&
    element.scrollWidth > element.clientWidth;
  const scrollsY =
    (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
    element.scrollHeight > element.clientHeight;
  return scrollsX || scrollsY;
};

const findScrollableAncestor = (target: EventTarget | null): Element | null => {
  let element = resolveScrollElement(target);
  while (element) {
    if (canScroll(element)) {
      return element;
    }
    element = element.parentElement;
  }
  return document.scrollingElement ?? document.documentElement;
};

const SCROLL_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
  'Spacebar',
]);

const markScrollbarActive = (element: Element): void => {
  element.classList.add(SCROLLBAR_ACTIVE_CLASS);

  const terminalElement = element.closest('.shell-tab__terminal');
  if (terminalElement && terminalElement !== element) {
    markScrollbarActive(terminalElement);
  }

  const existingTimer = activeTimers.get(element);
  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer);
  }

  const timer = window.setTimeout(() => {
    element.classList.remove(SCROLLBAR_ACTIVE_CLASS);
    activeTimers.delete(element);
  }, readActiveTimeoutMs());
  activeTimers.set(element, timer);
};

const markDocumentScrollbarActive = (): void => {
  markScrollbarActive(document.documentElement);
  if (document.body) {
    markScrollbarActive(document.body);
  }
};

export const initializeScrollbarActivityTracking = (): void => {
  if (initialized || typeof document === 'undefined') {
    return;
  }
  initialized = true;

  document.addEventListener(
    'scroll',
    (event) => {
      const element = resolveScrollElement(event.target);
      if (element) {
        markScrollbarActive(element);
      }
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    'wheel',
    (event) => {
      markDocumentScrollbarActive();
      const element = findScrollableAncestor(event.target);
      if (element) {
        markScrollbarActive(element);
      }
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    'touchmove',
    (event) => {
      markDocumentScrollbarActive();
      const element = findScrollableAncestor(event.target);
      if (element) {
        markScrollbarActive(element);
      }
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    'keydown',
    (event) => {
      if (!SCROLL_KEYS.has(event.key)) {
        return;
      }
      markDocumentScrollbarActive();
      const element = findScrollableAncestor(document.activeElement);
      if (element) {
        markScrollbarActive(element);
      }
    },
    { capture: true, passive: true }
  );
};
