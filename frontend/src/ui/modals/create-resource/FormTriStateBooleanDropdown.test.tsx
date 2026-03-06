import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormTriStateBooleanDropdown } from './FormTriStateBooleanDropdown';

vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    options,
    value,
    onChange,
    ariaLabel,
  }: {
    options: Array<{ value: string; label: string; disabled?: boolean }>;
    value: string | string[];
    onChange: (next: string | string[]) => void;
    ariaLabel?: string;
  }) => (
    <select
      data-testid={`dropdown-${ariaLabel ?? 'unknown'}`}
      value={Array.isArray(value) ? (value[0] ?? '') : value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

describe('FormTriStateBooleanDropdown', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders default tri-state options with unset selected', async () => {
    await act(async () => {
      root.render(
        <FormTriStateBooleanDropdown value={undefined} onChange={vi.fn()} ariaLabel="Optional" />
      );
    });

    const select = container.querySelector(
      '[data-testid="dropdown-Optional"]'
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('');
    const labels = Array.from(select.options).map((option) => option.textContent);
    expect(labels).toEqual(['-----', 'true', 'false']);
  });

  it('maps dropdown selection to boolean and unset values', async () => {
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <FormTriStateBooleanDropdown value={true} onChange={onChange} ariaLabel="Optional" />
      );
    });

    const select = container.querySelector(
      '[data-testid="dropdown-Optional"]'
    ) as HTMLSelectElement;
    expect(select.value).toBe('true');

    await act(async () => {
      select.value = 'false';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.value = '';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onChange).toHaveBeenNthCalledWith(1, false);
    expect(onChange).toHaveBeenNthCalledWith(2, undefined);
  });

  it('supports custom labels for read-only style tri-state controls', async () => {
    await act(async () => {
      root.render(
        <FormTriStateBooleanDropdown
          value={false}
          onChange={vi.fn()}
          ariaLabel="Read Only"
          emptyLabel="-- Select --"
          trueLabel="True"
          falseLabel="False"
        />
      );
    });

    const select = container.querySelector(
      '[data-testid="dropdown-Read Only"]'
    ) as HTMLSelectElement;
    expect(select.value).toBe('false');
    const labels = Array.from(select.options).map((option) => option.textContent);
    expect(labels).toEqual(['-- Select --', 'True', 'False']);
  });
});
