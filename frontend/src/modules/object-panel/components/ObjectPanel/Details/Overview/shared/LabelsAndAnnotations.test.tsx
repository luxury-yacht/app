/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/shared/LabelsAndAnnotations.test.tsx
 *
 * Test suite for LabelsAndAnnotations.
 * Covers key behaviors and edge cases for LabelsAndAnnotations.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { LabelsAndAnnotations } from './LabelsAndAnnotations';

describe('LabelsAndAnnotations', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: React.ComponentProps<typeof LabelsAndAnnotations>) => {
    await act(async () => {
      root.render(<LabelsAndAnnotations {...props} />);
      await Promise.resolve();
    });
  };

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

  it('returns null when both labels and annotations are empty', async () => {
    await renderComponent({});
    expect(container.innerHTML).toBe('');
  });

  it('renders metadata and toggles long annotations', async () => {
    const longValue = 'a'.repeat(160);

    await renderComponent({
      labels: { app: 'demo', tier: 'frontend' },
      annotations: {
        'short.note': 'quick',
        'long.note': longValue,
      },
      selectorEntries: { tier: 'frontend' },
    });

    const labelEntries = Array.from(container.querySelectorAll('.metadata-key')).map((el) =>
      el.textContent?.trim()
    );
    expect(labelEntries).toContain('app:');
    expect(labelEntries).toContain('tier:');

    const annotationValue = container.querySelector<HTMLElement>(
      '.metadata-pairs .metadata-value.clickable'
    );
    expect(annotationValue).toBeTruthy();
    expect(annotationValue?.title).toBe('Click to expand');
    expect(annotationValue?.textContent).toBe(
      longValue.substring(0, 150) + '... (click to expand)'
    );

    await act(async () => {
      annotationValue?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(annotationValue?.textContent).toBe(longValue);
    expect(annotationValue?.title).toBe('Click to collapse');

    await act(async () => {
      annotationValue?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(annotationValue?.textContent).toBe(
      longValue.substring(0, 150) + '... (click to expand)'
    );

    const selectorChip = container.querySelector('.metadata-chip--selector');
    expect(selectorChip).toBeTruthy();
    expect(selectorChip?.textContent).toBe('Selector');
  });
});
