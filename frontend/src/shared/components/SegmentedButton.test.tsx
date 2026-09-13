/**
 * frontend/src/shared/components/SegmentedButton.test.tsx
 *
 * Test suite for SegmentedButton.
 * Covers key behaviors and edge cases for SegmentedButton.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SegmentedButton from './SegmentedButton';

describe('SegmentedButton', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

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
