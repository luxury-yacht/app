/**
 * frontend/src/shared/components/dropdowns/Dropdown/DropdownFilterOption.test.tsx
 *
 * Test suite for DropdownFilterOption.
 * Covers the shared multi-select option control: on/off/required states,
 * the opt-in dimmed-off label, and the plain mode used by action rows.
 */

import { DropdownFilterOption } from '@shared/components/dropdowns/Dropdown/DropdownFilterOption';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

describe('DropdownFilterOption', () => {
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

  const render = (node: React.ReactNode) => {
    act(() => {
      root.render(node);
    });
    return requireValue(
      container.querySelector('.dropdown-filter-option'),
      'expected a rendered option'
    );
  };

  const box = (option: Element) => option.querySelector('.dropdown-filter-box');

  it('renders a real checkbox rather than a bare glyph when selected', () => {
    const option = render(<DropdownFilterOption label="Kind" state="on" />);

    const control = requireValue(box(option), 'expected a checkbox');
    expect(control.classList.contains('dropdown-filter-box--on')).toBe(true);
    expect(control.querySelector('svg')).not.toBeNull();
    // The glyph this replaces was a bare text check with no control around it.
    expect(option.textContent).toBe('Kind');
  });

  it('renders an empty checkbox when not selected', () => {
    const option = render(<DropdownFilterOption label="Kind" state="off" />);

    const control = requireValue(box(option), 'expected a checkbox');
    expect(control.classList.contains('dropdown-filter-box--on')).toBe(false);
    expect(control.querySelector('svg')).toBeNull();
  });

  it('renders a required option as a locked state, never as extra words', () => {
    const option = render(
      <DropdownFilterOption label="Name" state="required" title="Always shown" />
    );

    const control = requireValue(box(option), 'expected a checkbox');
    expect(control.classList.contains('dropdown-filter-box--required')).toBe(true);
    expect(control.querySelector('svg')).not.toBeNull();
    expect(option.getAttribute('title')).toBe('Always shown');
    expect(option.textContent).toBe('Name');
  });

  it('leaves off-state labels at full strength by default', () => {
    const option = render(<DropdownFilterOption label="Pods" state="off" />);

    const label = requireValue(option.querySelector('.dropdown-filter-label'), 'expected a label');
    expect(label.classList.contains('dropdown-filter-label--muted')).toBe(false);
  });

  it('mutes off-state labels only where a caller opts in', () => {
    const option = render(<DropdownFilterOption label="Status" state="off" dimWhenOff />);

    const label = requireValue(option.querySelector('.dropdown-filter-label'), 'expected a label');
    expect(label.classList.contains('dropdown-filter-label--muted')).toBe(true);
  });

  it('never mutes a selected label even when the caller opts in', () => {
    const option = render(<DropdownFilterOption label="Age" state="on" dimWhenOff />);

    const label = requireValue(option.querySelector('.dropdown-filter-label'), 'expected a label');
    expect(label.classList.contains('dropdown-filter-label--muted')).toBe(false);
  });

  it('omits the control entirely for action rows so Select all has no stray checkbox', () => {
    const option = render(<DropdownFilterOption label="Select all" state="off" plain />);

    expect(box(option)).toBeNull();
    expect(option.classList.contains('dropdown-filter-option--action')).toBe(true);
    expect(option.textContent).toBe('Select all');
  });

  it('accepts a rich label node', () => {
    const option = render(
      <DropdownFilterOption
        label={<span className="custom-label">kubeconfig : ctx</span>}
        state="on"
      />
    );

    expect(option.querySelector('.custom-label')?.textContent).toBe('kubeconfig : ctx');
  });
});
