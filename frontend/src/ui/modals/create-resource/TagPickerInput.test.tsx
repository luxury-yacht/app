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

/** Dispatch a keydown event on an element. */
const pressKey = (el: Element, key: string): void => {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
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

  // ── Keyboard navigation ──────────────────────────────────────────────

  it('ArrowLeft from input enters tag navigation and shows cursor', () => {
    render(['NET_ADMIN', 'SYS_ADMIN']);
    const input = container.querySelector('.tag-picker-input') as HTMLInputElement;
    // Ensure caret is at start.
    Object.defineProperty(input, 'selectionStart', { value: 0, writable: true });
    Object.defineProperty(input, 'selectionEnd', { value: 0, writable: true });
    const area = container.querySelector('.tag-picker-input-area') as HTMLElement;
    pressKey(area, 'ArrowLeft');
    // Cursor should appear before the last tag (position 1 = between tags 0 and 1).
    const cursor = container.querySelector('[data-testid="tag-cursor"]');
    expect(cursor).not.toBeNull();
  });

  it('Delete removes the tag in front of the cursor', () => {
    const onChange = vi.fn();
    render(['ALL', 'NET_ADMIN', 'SYS_ADMIN'], onChange);
    const input = container.querySelector('.tag-picker-input') as HTMLInputElement;
    Object.defineProperty(input, 'selectionStart', { value: 0, writable: true });
    Object.defineProperty(input, 'selectionEnd', { value: 0, writable: true });
    const area = container.querySelector('.tag-picker-input-area') as HTMLElement;
    // ArrowLeft twice: cursor at position 1 (between ALL and NET_ADMIN).
    pressKey(area, 'ArrowLeft');
    pressKey(area, 'ArrowLeft');
    // Delete should remove NET_ADMIN (the tag in front of the cursor).
    pressKey(area, 'Delete');
    expect(onChange).toHaveBeenCalledWith(['ALL', 'SYS_ADMIN']);
  });

  it('Backspace removes the tag behind the cursor', () => {
    const onChange = vi.fn();
    render(['ALL', 'NET_ADMIN', 'SYS_ADMIN'], onChange);
    const input = container.querySelector('.tag-picker-input') as HTMLInputElement;
    Object.defineProperty(input, 'selectionStart', { value: 0, writable: true });
    Object.defineProperty(input, 'selectionEnd', { value: 0, writable: true });
    const area = container.querySelector('.tag-picker-input-area') as HTMLElement;
    // ArrowLeft twice: cursor at position 1 (between ALL and NET_ADMIN).
    pressKey(area, 'ArrowLeft');
    pressKey(area, 'ArrowLeft');
    // Backspace should remove ALL (the tag behind the cursor).
    pressKey(area, 'Backspace');
    expect(onChange).toHaveBeenCalledWith(['NET_ADMIN', 'SYS_ADMIN']);
  });

  it('Backspace from end of list (in input) removes last tag', () => {
    const onChange = vi.fn();
    render(['NET_ADMIN', 'SYS_ADMIN'], onChange);
    const area = container.querySelector('.tag-picker-input-area') as HTMLElement;
    // No ArrowLeft — cursor stays at the end (in the text input).
    pressKey(area, 'Backspace');
    expect(onChange).toHaveBeenCalledWith(['NET_ADMIN']);
  });

  it('ArrowRight past last tag returns focus to input', () => {
    render(['NET_ADMIN']);
    const input = container.querySelector('.tag-picker-input') as HTMLInputElement;
    Object.defineProperty(input, 'selectionStart', { value: 0, writable: true });
    Object.defineProperty(input, 'selectionEnd', { value: 0, writable: true });
    const area = container.querySelector('.tag-picker-input-area') as HTMLElement;
    // Enter tag nav.
    pressKey(area, 'ArrowLeft');
    expect(container.querySelector('[data-testid="tag-cursor"]')).not.toBeNull();
    // ArrowRight should return to input.
    pressKey(area, 'ArrowRight');
    expect(container.querySelector('[data-testid="tag-cursor"]')).toBeNull();
  });
});
