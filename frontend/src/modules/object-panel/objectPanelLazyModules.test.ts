import { preloadObjectPanelModules } from '@modules/object-panel/objectPanelLazyModules';
import { describe, expect, it, vi } from 'vitest';

describe('object-panel lazy module preload', () => {
  it('starts the panel shell and default details tab concurrently', async () => {
    let resolvePanel!: () => void;
    let resolveDetails!: () => void;
    const loadPanel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePanel = resolve;
        })
    );
    const loadDetails = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDetails = resolve;
        })
    );

    const preload = preloadObjectPanelModules({ loadPanel, loadDetails });

    expect(loadPanel).toHaveBeenCalledTimes(1);
    expect(loadDetails).toHaveBeenCalledTimes(1);
    resolvePanel();
    resolveDetails();
    await preload;
  });
});
