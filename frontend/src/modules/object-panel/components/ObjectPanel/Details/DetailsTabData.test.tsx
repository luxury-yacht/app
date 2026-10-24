/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabData.test.tsx
 *
 * Renders the ConfigMap/Secret data section inside the real app shell, so its decode shortcut
 * registers with the real keyboard owner. Only the backend boundary is faked
 * (test-utils/appState); clipboard writes reach the Wails runtime mock.
 */

import { Clipboard } from '@wailsio/runtime';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import DataSection from './DetailsTabData';

const app = installAppStateHarness();

describe('DetailsTabData', () => {
  const writeTextMock = vi.mocked(Clipboard.SetText);
  let view: MountedApp;

  // Shows the section inside its own element so assertions see only the section.
  const render = async (ui: React.ReactElement) => {
    await view.show(<div data-testid="data-section">{ui}</div>);
    return requireValue(
      view.container.querySelector<HTMLElement>('[data-testid="data-section"]'),
      'data section surface'
    );
  };

  const click = async (element: Element) => {
    await act(async () => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  beforeEach(async () => {
    writeTextMock.mockReset().mockResolvedValue(undefined);
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default']);
    view = await app.render(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    writeTextMock.mockReset();
  });

  it('renders config map data and binary data sections', async () => {
    const container = await render(
      <DataSection data={{ key1: 'value1', key2: 'value2' }} binaryData={{ file: 'YmFzZTY0' }} />
    );

    expect(container.textContent).toContain('Data');
    expect(container.textContent).toContain('key1');
    expect(container.textContent).toContain('Binary Data');
    expect(container.textContent).toContain('file');
    // Header no longer renders an aggregate count.
    expect(container.textContent).not.toMatch(/Data\(\d+\)/);
  });

  it('toggles secret decode state and displays decoded values', async () => {
    const container = await render(<DataSection data={{ password: 'super-secret' }} isSecret />);

    const decodeButton = requireValue(
      container.querySelector('button'),
      'expected test value in DetailsTabData.test.tsx'
    );
    expect(container.textContent).toContain(btoa('super-secret'));

    await click(decodeButton);
    expect(container.textContent).toContain('super-secret');

    await click(decodeButton);
    expect(container.textContent).toContain(btoa('super-secret'));

    // The registered shortcut toggles the same state.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    });
    expect(container.textContent).toContain('super-secret');
  });

  it('retains empty and non-Latin secret values when base64 cannot encode them', async () => {
    const container = await render(
      <DataSection data={{ empty: '', unicode: '🔑秘密' }} isSecret />
    );
    expect(
      Array.from(container.querySelectorAll('.data-value'), (button) => button.textContent)
    ).toEqual(['', '🔑秘密']);
  });

  it('copies binary data unchanged when no text data is present', async () => {
    const container = await render(<DataSection binaryData={{ file: 'AAEC' }} />);
    await click(requireValue(container.querySelector('.binary-data'), 'binary data control'));
    expect(writeTextMock).toHaveBeenCalledWith('AAEC');
  });

  it('copies values to clipboard and shows feedback', async () => {
    const container = await render(<DataSection data={{ token: 'abc123' }} />);
    vi.useFakeTimers();

    await click(
      requireValue(
        container.querySelector('.data-value'),
        'expected test value in DetailsTabData.test.tsx'
      )
    );

    expect(writeTextMock).toHaveBeenCalledWith('abc123');
    expect(container.textContent).toContain('Copied');

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.textContent).not.toContain('Copied');
  });
});
