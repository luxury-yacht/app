/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabData.test.tsx
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import DataSection from './DetailsTabData';

vi.mock('@ui/shortcuts', () => ({
  useShortcut: vi.fn(),
  useSearchShortcutTarget: () => undefined,
}));

const render = async (ui: React.ReactElement) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  await act(async () => {
    root.render(ui);
    await Promise.resolve();
  });
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

describe('DetailsTabData', () => {
  const writeTextMock = vi.fn();

  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock.mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    writeTextMock.mockReset();
  });

  it('renders config map data and binary data sections', async () => {
    const { container, cleanup } = await render(
      <DataSection data={{ key1: 'value1', key2: 'value2' }} binaryData={{ file: 'YmFzZTY0' }} />
    );

    expect(container.textContent).toContain('Data');
    expect(container.textContent).toContain('key1');
    expect(container.textContent).toContain('Binary Data');
    expect(container.textContent).toContain('file');
    // Header no longer renders an aggregate count.
    expect(container.textContent).not.toMatch(/Data\(\d+\)/);
    cleanup();
  });

  it('toggles secret decode state and displays decoded values', async () => {
    const { container, cleanup } = await render(
      <DataSection data={{ password: 'super-secret' }} isSecret />
    );

    const decodeButton = requireValue(
      container.querySelector('button'),
      'expected test value in DetailsTabData.test.tsx'
    );
    expect(container.textContent).toContain(btoa('super-secret'));

    await act(async () => {
      decodeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('super-secret');

    await act(async () => {
      decodeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain(btoa('super-secret'));
    cleanup();
  });

  it('retains empty and non-Latin secret values when base64 cannot encode them', async () => {
    const { container, cleanup } = await render(
      <DataSection data={{ empty: '', unicode: '🔑秘密' }} isSecret />
    );
    expect(
      Array.from(container.querySelectorAll('.data-value'), (button) => button.textContent)
    ).toEqual(['', '🔑秘密']);
    cleanup();
  });

  it('copies binary data unchanged when no text data is present', async () => {
    const { container, cleanup } = await render(<DataSection binaryData={{ file: 'AAEC' }} />);
    const button = requireValue(container.querySelector('.binary-data'), 'binary data control');
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(writeTextMock).toHaveBeenCalledWith('AAEC');
    cleanup();
  });

  it('copies values to clipboard and shows feedback', async () => {
    vi.useFakeTimers();

    const { container, cleanup } = await render(<DataSection data={{ token: 'abc123' }} />);

    const value = requireValue(
      container.querySelector('.data-value'),
      'expected test value in DetailsTabData.test.tsx'
    );
    await act(async () => {
      value.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeTextMock).toHaveBeenCalledWith('abc123');
    expect(container.textContent).toContain('Copied');

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.textContent).not.toContain('Copied');
    cleanup();
  });
});
