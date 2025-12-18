import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DetailsSectionProvider } from '@core/contexts/DetailsSectionContext';
import DataSection from './DetailsTabData';

vi.mock('@ui/shortcuts', () => ({
  useShortcut: vi.fn(),
  useSearchShortcutTarget: () => undefined,
}));

const renderWithProvider = async (ui: React.ReactElement) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  await act(async () => {
    root.render(<DetailsSectionProvider>{ui}</DetailsSectionProvider>);
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

  it('renders config map data with counts', async () => {
    const { container, cleanup } = await renderWithProvider(
      <DataSection data={{ key1: 'value1', key2: 'value2' }} binaryData={{ file: 'YmFzZTY0' }} />
    );

    expect(container.textContent).toContain('Data(3)');
    expect(container.textContent).toContain('key1');
    expect(container.textContent).toContain('Binary Data');
    expect(container.textContent).toContain('file');
    cleanup();
  });

  it('toggles secret decode state and displays decoded values', async () => {
    const { container, cleanup } = await renderWithProvider(
      <DataSection data={{ password: 'super-secret' }} isSecret />
    );

    const decodeButton = container.querySelector('button')!;
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

  it('copies values to clipboard and shows feedback', async () => {
    vi.useFakeTimers();

    const { container, cleanup } = await renderWithProvider(
      <DataSection data={{ token: 'abc123' }} />
    );

    const value = container.querySelector('.data-value')!;
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
