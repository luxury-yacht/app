/**
 * frontend/src/shared/hooks/useObjectLink.test.tsx
 *
 * The paired click / Alt+click handlers object links in tables use. In a
 * native panel window, which has no workspace navigation, a link offers no
 * Alt+click handler and a click still opens the object. Runs the hook inside
 * the production panel-window shell with the real object-panel state over a
 * faked backend (test-utils/appState).
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { installAppStateHarness } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { useObjectLink } from './useObjectLink';

const app = installAppStateHarness();
let objectLink: ReturnType<typeof useObjectLink> | undefined;

function Probe() {
  objectLink = useObjectLink();
  return null;
}

describe('useObjectLink', () => {
  it('offers no Alt+click navigation in a panel window, and a click still opens the object', async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default']);
    // A panel window renders every panel it opens; the pod panel reads its own data.
    const pod = app.servePanel(dev, {
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'default',
      name: 'api',
    });
    app.panelWindow(dev);
    const view = await app.render(null);
    await view.show(<Probe />);
    const handlers = requireValue(objectLink, 'mounted object link')(() => pod.ref);

    await act(async () => {
      handlers.onClick(pod.ref);
    });
    await app.settle();

    expect(handlers.onAltClick).toBeUndefined();
    expect(view.openPanels()).toEqual([pod.ref]);
  });
});
