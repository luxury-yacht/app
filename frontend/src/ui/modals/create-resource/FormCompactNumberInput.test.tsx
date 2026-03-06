import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FormCompactNumberInput,
  parseCompactNumberValue,
  sanitizeCompactNumberInput,
} from './FormCompactNumberInput';

describe('FormCompactNumberInput', () => {
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

  it('sanitizes integer typing to max digit count', () => {
    const sanitized = sanitizeCompactNumberInput('2222', { min: 0, max: 999, integer: true });
    expect(sanitized).toBe('222');
  });

  it('parses valid values and rejects invalid compact number input', () => {
    expect(parseCompactNumberValue('420', { min: 0, max: 511, integer: true })).toBe(420);
    expect(parseCompactNumberValue('', { min: 0, max: 511, integer: true })).toBe('');
    expect(
      parseCompactNumberValue('', { min: 0, max: 511, integer: true }, { allowEmpty: false })
    ).toBeNull();
    expect(parseCompactNumberValue('1.5', { min: 0, max: 511, integer: true })).toBeNull();
    expect(parseCompactNumberValue('900', { min: 0, max: 511, integer: true })).toBeNull();
  });

  it('renders numeric attributes and keeps integer input compact while typing', async () => {
    await act(async () => {
      root.render(
        <FormCompactNumberInput
          dataFieldKey="replicas"
          defaultValue="3"
          min={0}
          max={999}
          integer
        />
      );
    });

    const input = container.querySelector('input[data-field-key="replicas"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.min).toBe('0');
    expect(input.max).toBe('999');
    expect(input.step).toBe('1');

    await act(async () => {
      input.value = '2222';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(input.value).toBe('222');

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
});
