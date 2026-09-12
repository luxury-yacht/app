import { getFocusRegions, regionContains } from './focusRegions';

const createOutline = (roots: HTMLElement[]) => {
  const bounds = roots.map((root) => root.getBoundingClientRect());
  const left = Math.min(...bounds.map((rect) => rect.left));
  const top = Math.min(...bounds.map((rect) => rect.top));
  const right = Math.max(...bounds.map((rect) => rect.right));
  const bottom = Math.max(...bounds.map((rect) => rect.bottom));
  if (right <= left || bottom <= top) {
    return null;
  }
  const outline = document.createElement('div');
  outline.className = 'keyboard-region-outline';
  outline.setAttribute('aria-hidden', 'true');
  // One frame encloses split regions such as the title bar and cluster tabs.
  // CSS converts viewport coordinates to the app's zoomed coordinate space.
  outline.style.setProperty('--region-outline-left', `${left}px`);
  outline.style.setProperty('--region-outline-top', `${top}px`);
  outline.style.setProperty('--region-outline-width', `${right - left}px`);
  outline.style.setProperty('--region-outline-height', `${bottom - top}px`);
  outline.addEventListener('animationend', () => outline.remove(), { once: true });
  document.body.append(outline);
  return outline;
};

export const createRegionFocusIndicator = () => {
  let previousRegion: HTMLElement | undefined;
  let outline: HTMLElement | null = null;
  let pendingFrame: number | undefined;

  const dismiss = () => {
    if (pendingFrame !== undefined) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = undefined;
    }
    outline?.remove();
    outline = null;
  };

  const update = () => {
    if (pendingFrame !== undefined) {
      cancelAnimationFrame(pendingFrame);
    }
    // Local handlers and composite controls may redirect focus during the key.
    // Outline the final destination once, before the next paint.
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = undefined;
      const region = getFocusRegions().find((candidate) =>
        regionContains(candidate, document.activeElement)
      );
      if (region?.roots[0] === previousRegion) {
        return;
      }
      previousRegion = region?.roots[0];
      dismiss();
      if (region) {
        outline = createOutline(region.roots);
      }
    });
  };

  const clear = () => {
    dismiss();
    previousRegion = undefined;
  };

  return { update, dismiss, clear };
};
