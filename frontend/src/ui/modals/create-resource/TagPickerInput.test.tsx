import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TagPickerInput } from './TagPickerInput';

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

  const render = (value: string[], onChange?: (newValue: string[]) => void) => {
    const mockOnChange = onChange ?? vi.fn<(newValue: string[]) => void>();
    act(() => {
      root.render(
        <TagPickerInput
          options={OPTIONS}
          value={value}
          onChange={mockOnChange}
          placeholder="Search capabilities"
          ariaLabel="capabilities"
        />
      );
    });
    return mockOnChange;
  };

  it('renders empty state with placeholder', () => {
    render([]);
    const input = container.querySelector('.tag-picker-inline-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe('Search capabilities');
  });

  it('renders selected values as chips with remove buttons', () => {
    render(['NET_ADMIN', 'SYS_ADMIN']);
    const chips = container.querySelectorAll('.tag-picker-chip');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toContain('NET_ADMIN');
    expect(chips[1].textContent).toContain('SYS_ADMIN');
    const removeBtns = container.querySelectorAll('.tag-picker-chip-remove');
    expect(removeBtns.length).toBe(2);
  });

  it('removes a tag when clicking its chip remove button', () => {
    const onChange = vi.fn();
    render(['NET_ADMIN', 'SYS_ADMIN'], onChange);
    const removeBtns = container.querySelectorAll('.tag-picker-chip-remove');
    act(() => (removeBtns[0] as HTMLElement).click());
    expect(onChange).toHaveBeenCalledWith(['SYS_ADMIN']);
  });

  it('shows dropdown when input is focused', () => {
    vi.useFakeTimers();
    render([]);
    const input = container.querySelector('.tag-picker-inline-input') as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new Event('focus', { bubbles: true }));
    });
    const options = container.querySelectorAll('.tag-picker-option');
    expect(options.length).toBe(6);
    vi.useRealTimers();
  });

  it('selecting a dropdown option adds it', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render([], onChange);
    const input = container.querySelector('.tag-picker-inline-input') as HTMLInputElement;
    act(() => {
      input.dispatchEvent(new Event('focus', { bubbles: true }));
    });
    const options = container.querySelectorAll('.tag-picker-option');
    expect(options.length).toBe(6);
    act(() => (options[0] as HTMLElement).click());
    expect(onChange).toHaveBeenCalledWith(['ALL']);
    vi.useRealTimers();
  });

  it('hides placeholder when chips are present', () => {
    render(['NET_ADMIN']);
    const input = container.querySelector('.tag-picker-inline-input') as HTMLInputElement;
    expect(input.placeholder).toBe('');
  });

  // ── Keyboard navigation ──────────────────────────────────────────────

  it('Backspace removes last tag', () => {
    const onChange = vi.fn();
    render(['NET_ADMIN', 'SYS_ADMIN'], onChange);
    const picker = container.querySelector('.tag-picker') as HTMLElement;
    pressKey(picker, 'Backspace');
    expect(onChange).toHaveBeenCalledWith(['NET_ADMIN']);
  });

  it('ArrowUp moves cursor, Delete removes tag in front', () => {
    const onChange = vi.fn();
    render(['ALL', 'NET_ADMIN', 'SYS_ADMIN'], onChange);
    const picker = container.querySelector('.tag-picker') as HTMLElement;
    // ArrowUp twice to get cursor at position 1 (between ALL and NET_ADMIN).
    pressKey(picker, 'ArrowUp');
    pressKey(picker, 'ArrowUp');
    // Delete removes NET_ADMIN (tag in front of cursor).
    pressKey(picker, 'Delete');
    expect(onChange).toHaveBeenCalledWith(['ALL', 'SYS_ADMIN']);
  });

  it('ArrowUp moves cursor, Backspace removes tag behind', () => {
    const onChange = vi.fn();
    render(['ALL', 'NET_ADMIN', 'SYS_ADMIN'], onChange);
    const picker = container.querySelector('.tag-picker') as HTMLElement;
    pressKey(picker, 'ArrowUp');
    pressKey(picker, 'ArrowUp');
    // Backspace removes ALL (tag behind cursor).
    pressKey(picker, 'Backspace');
    expect(onChange).toHaveBeenCalledWith(['NET_ADMIN', 'SYS_ADMIN']);
  });
});
