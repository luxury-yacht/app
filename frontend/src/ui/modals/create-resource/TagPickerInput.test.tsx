import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagPickerInput } from './TagPickerInput';

const setNativeInputValue = (element: HTMLInputElement, value: string) => {
  const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
  const prototype = Object.getPrototypeOf(element) as HTMLInputElement;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(element, value);
    return;
  }
  if (valueSetter) {
    valueSetter.call(element, value);
    return;
  }
  element.value = value;
};

describe('TagPickerInput', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const OPTIONS = ['ALL', 'NET_ADMIN', 'NET_BIND_SERVICE', 'NET_RAW', 'SYS_ADMIN', 'SYS_PTRACE'];

  const render = (
    value: string[],
    onChange?: (newValue: string[]) => void
  ) => {
    const mockOnChange = onChange ?? vi.fn<(newValue: string[]) => void>();
    act(() => {
      root.render(
        <TagPickerInput
          options={OPTIONS}
          value={value}
          onChange={mockOnChange}
          placeholder="Add capability"
          ariaLabel="capabilities"
        />
      );
    });
    return mockOnChange;
  };

  it('renders empty state with placeholder', () => {
    render([]);
    const input = container.querySelector('.tag-picker-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe('Add capability');
    const tags = container.querySelectorAll('.tag-picker-tag');
    expect(tags.length).toBe(0);
  });

  it('renders selected values as inline tag chips', () => {
    render(['NET_ADMIN', 'SYS_ADMIN']);
    const tags = container.querySelectorAll('.tag-picker-tag');
    expect(tags.length).toBe(2);
    expect(tags[0].textContent).toContain('NET_ADMIN');
    expect(tags[1].textContent).toContain('SYS_ADMIN');
    // Each tag should have a remove button.
    const removeBtns = container.querySelectorAll('.tag-picker-tag-remove');
    expect(removeBtns.length).toBe(2);
  });

  it('removes a tag when clicking its remove button', () => {
    const onChange = vi.fn();
    render(['NET_ADMIN', 'SYS_ADMIN'], onChange);
    const removeBtns = container.querySelectorAll('.tag-picker-tag-remove');
    act(() => (removeBtns[0] as HTMLElement).click());
    expect(onChange).toHaveBeenCalledWith(['SYS_ADMIN']);
  });

  it('shows dropdown with unselected options on focus', () => {
    render(['NET_ADMIN']);
    const input = container.querySelector('.tag-picker-input') as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new Event('focus', { bubbles: true }));
    });
    const dropdown = container.querySelector('.tag-picker-dropdown');
    expect(dropdown).not.toBeNull();
    const options = container.querySelectorAll('.tag-picker-option');
    expect(options.length).toBe(5);
    const optionTexts = Array.from(options).map((o) => o.textContent);
    expect(optionTexts).not.toContain('NET_ADMIN');
  });

  it('filters options by input text', () => {
    render([]);
    const input = container.querySelector('.tag-picker-input') as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new Event('focus', { bubbles: true }));
    });
    act(() => {
      setNativeInputValue(input, 'NET');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const options = container.querySelectorAll('.tag-picker-option');
    expect(options.length).toBe(3);
  });

  it('selecting an option adds it and clears filter', () => {
    const onChange = vi.fn();
    render([], onChange);
    const input = container.querySelector('.tag-picker-input') as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new Event('focus', { bubbles: true }));
    });
    const options = container.querySelectorAll('.tag-picker-option');
    act(() => (options[0] as HTMLElement).click());
    expect(onChange).toHaveBeenCalledWith(['ALL']);
  });

  it('hides input when all options are selected', () => {
    render([...OPTIONS]);
    // No input should be present since all options are selected.
    const input = container.querySelector('.tag-picker-input');
    expect(input).toBeNull();
  });

  it('filter is case-insensitive', () => {
    render([]);
    const input = container.querySelector('.tag-picker-input') as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new Event('focus', { bubbles: true }));
    });
    act(() => {
      setNativeInputValue(input, 'sys');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const options = container.querySelectorAll('.tag-picker-option');
    expect(options.length).toBe(2);
  });
});
