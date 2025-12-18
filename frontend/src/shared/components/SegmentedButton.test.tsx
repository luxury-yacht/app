import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import SegmentedButton from './SegmentedButton';

describe('SegmentedButton', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderSegmented = async (props: React.ComponentProps<typeof SegmentedButton<string>>) => {
    await act(async () => {
      root.render(<SegmentedButton {...props} />);
      await Promise.resolve();
    });
  };

  it('renders options and highlights the active one', async () => {
    const options = [
      { value: 'pods', label: 'Pods' },
      { value: 'events', label: 'Events' },
    ];

    await renderSegmented({
      options,
      value: 'pods',
      onChange: vi.fn(),
      size: 'small',
    });

    const buttons = container.querySelectorAll('.segmented-button__option');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].className).toContain('segmented-button__option--active');
    expect(buttons[1].className).not.toContain('segmented-button__option--active');
  });

  it('invokes onChange when a button is clicked', async () => {
    const onChange = vi.fn();
    const options = [
      { value: 'pods', label: 'Pods' },
      { value: 'events', label: 'Events' },
    ];

    await renderSegmented({
      options,
      value: 'pods',
      onChange,
    });

    const buttons = container.querySelectorAll('.segmented-button__option');
    act(() => {
      (buttons[1] as HTMLButtonElement).click();
    });

    expect(onChange).toHaveBeenCalledWith('events');
  });
});
