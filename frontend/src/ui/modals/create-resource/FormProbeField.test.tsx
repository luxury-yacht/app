import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormProbeField } from './FormProbeField';

// Mock Dropdown as a simple <select> for testability.
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

/**
 * Update an input's native value so React's change tracking picks it up.
 */
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

describe('FormProbeField', () => {
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

  // Helper to render the component with given props.
  const render = (props: {
    probe: Record<string, unknown> | undefined;
    label?: string;
    onProbeChange?: (newProbe: Record<string, unknown>) => void;
    onRemoveProbe?: () => void;
  }) => {
    const onProbeChange =
      props.onProbeChange ?? vi.fn<(newProbe: Record<string, unknown>) => void>();
    const onRemoveProbe = props.onRemoveProbe ?? vi.fn<() => void>();
    act(() => {
      root.render(
        <FormProbeField
          dataFieldKey="readinessProbe"
          probe={props.probe}
          label={props.label ?? 'Readiness'}
          onProbeChange={onProbeChange}
          onRemoveProbe={onRemoveProbe}
        />
      );
    });
    return { onProbeChange, onRemoveProbe };
  };

  it('renders add button when probe is undefined', () => {
    render({ probe: undefined });
    const addBtn = container.querySelector('button.resource-form-icon-btn');
    expect(addBtn).not.toBeNull();
    expect(container.textContent).toContain('Add readiness probe');
    // No timing fields should be rendered.
    expect(container.querySelector('.resource-form-probe-timing')).toBeNull();
  });

  it('clicking add calls onProbeChange with default HTTP GET probe', () => {
    const onProbeChange = vi.fn();
    render({ probe: undefined, onProbeChange });
    const addBtn = container.querySelector('button.resource-form-icon-btn') as HTMLElement;
    act(() => addBtn.click());
    expect(onProbeChange).toHaveBeenCalledTimes(1);
    const arg = onProbeChange.mock.calls[0][0];
    expect(arg).toEqual({ httpGet: { path: '/' } });
  });

  it('renders HTTP GET fields when probe has httpGet', () => {
    render({ probe: { httpGet: { path: '/health', port: 8080 } } });
    const pathInput = container.querySelector('[data-field-key="httpGetPath"]') as HTMLInputElement;
    expect(pathInput).not.toBeNull();
    expect(pathInput.value).toBe('/health');
    const portInput = container.querySelector('[data-field-key="httpGetPort"]') as HTMLInputElement;
    expect(portInput).not.toBeNull();
    expect(portInput.value).toBe('8080');
  });

  it('renders TCP Socket port field when probe has tcpSocket', () => {
    render({ probe: { tcpSocket: { port: 3306 } } });
    const portInput = container.querySelector(
      '[data-field-key="tcpSocketPort"]'
    ) as HTMLInputElement;
    expect(portInput).not.toBeNull();
    expect(portInput.value).toBe('3306');
    // httpGet fields should not exist.
    expect(container.querySelector('[data-field-key="httpGetPath"]')).toBeNull();
  });

  it('renders exec command field when probe has exec', () => {
    render({ probe: { exec: { command: ['cat', '/tmp/healthy'] } } });
    const cmdInput = container.querySelector('[data-field-key="execCommand"]') as HTMLInputElement;
    expect(cmdInput).not.toBeNull();
    expect(cmdInput.value).toBe('cat /tmp/healthy');
  });

  it('renders gRPC fields when probe has grpc', () => {
    render({ probe: { grpc: { port: 50051, service: 'my-svc' } } });
    const portInput = container.querySelector('[data-field-key="grpcPort"]') as HTMLInputElement;
    expect(portInput).not.toBeNull();
    expect(portInput.value).toBe('50051');
    const svcInput = container.querySelector('[data-field-key="grpcService"]') as HTMLInputElement;
    expect(svcInput).not.toBeNull();
    expect(svcInput.value).toBe('my-svc');
  });

  it('type switching preserves timing fields and initializes new type', () => {
    const onProbeChange = vi.fn();
    render({
      probe: { httpGet: { path: '/' }, initialDelaySeconds: 5, periodSeconds: 10 },
      onProbeChange,
    });
    // Switch to TCP Socket.
    const typeDropdown = container.querySelector(
      '[data-testid="dropdown-Readiness probe type"]'
    ) as HTMLSelectElement;
    act(() => {
      typeDropdown.value = 'tcpSocket';
      typeDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onProbeChange).toHaveBeenCalledTimes(1);
    const newProbe = onProbeChange.mock.calls[0][0];
    expect(newProbe.tcpSocket).toEqual({});
    expect(newProbe.httpGet).toBeUndefined();
    // Timing fields are preserved.
    expect(newProbe.initialDelaySeconds).toBe(5);
    expect(newProbe.periodSeconds).toBe(10);
  });

  it('HTTP scheme dropdown omits HTTP from YAML (default), writes HTTPS', () => {
    const onProbeChange = vi.fn();
    render({
      probe: { httpGet: { path: '/', scheme: 'HTTPS' } },
      onProbeChange,
    });
    const schemeDropdown = container.querySelector(
      '[data-testid="dropdown-HTTP scheme"]'
    ) as HTMLSelectElement;
    expect(schemeDropdown.value).toBe('HTTPS');
    // Switch to HTTP — should unset scheme.
    act(() => {
      schemeDropdown.value = 'HTTP';
      schemeDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onProbeChange).toHaveBeenCalledTimes(1);
    const newProbe = onProbeChange.mock.calls[0][0];
    // HTTP is omitted — scheme key should be removed from httpGet.
    expect(newProbe.httpGet.scheme).toBeUndefined();
  });

  it('exec command commits on blur via shell tokenize', () => {
    const onProbeChange = vi.fn();
    render({
      probe: { exec: { command: [] } },
      onProbeChange,
    });
    const cmdInput = container.querySelector('[data-field-key="execCommand"]') as HTMLInputElement;
    act(() => {
      setNativeInputValue(cmdInput, 'echo "hello world"');
      cmdInput.dispatchEvent(new Event('input', { bubbles: true }));
      cmdInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => {
      // React 18 delegates onBlur via focusout (which bubbles); dispatch
      // focusout so the synthetic onBlur handler is invoked in jsdom.
      cmdInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(onProbeChange).toHaveBeenCalled();
    const lastCall = onProbeChange.mock.calls[onProbeChange.mock.calls.length - 1][0];
    expect(lastCall.exec.command).toEqual(['echo', 'hello world']);
  });

  it('remove button calls onRemoveProbe', () => {
    const onRemoveProbe = vi.fn();
    render({
      probe: { httpGet: { path: '/' } },
      onRemoveProbe,
    });
    // Find the remove button (last icon button in the probe actions).
    const removeBtn = container.querySelector('.resource-form-probe-actions button') as HTMLElement;
    expect(removeBtn).not.toBeNull();
    act(() => removeBtn.click());
    expect(onRemoveProbe).toHaveBeenCalledTimes(1);
  });

  it('renders timing and threshold fields', () => {
    render({
      probe: { httpGet: { path: '/' }, initialDelaySeconds: 15, failureThreshold: 5 },
    });
    // Check timing row labels exist.
    expect(container.textContent).toContain('Timings (seconds)');
    expect(container.textContent).toContain('Initial Delay');
    expect(container.textContent).toContain('Period');
    expect(container.textContent).toContain('Timeout');
    // Check threshold row labels exist.
    expect(container.textContent).toContain('Thresholds');
    expect(container.textContent).toContain('Success');
    expect(container.textContent).toContain('Failure');
    // Check values are rendered.
    const delayInput = container.querySelector(
      'input[data-field-key="initialDelaySeconds"]'
    ) as HTMLInputElement;
    expect(delayInput.value).toBe('15');
    const failureInput = container.querySelector(
      'input[data-field-key="failureThreshold"]'
    ) as HTMLInputElement;
    expect(failureInput.value).toBe('5');
  });

  it('TCP socket port input parses numeric strings to numbers and keeps named ports as strings', () => {
    const onProbeChange = vi.fn();
    render({
      probe: { tcpSocket: {} },
      onProbeChange,
    });
    const portInput = container.querySelector(
      '[data-field-key="tcpSocketPort"]'
    ) as HTMLInputElement;
    // Type a numeric port.
    act(() => {
      setNativeInputValue(portInput, '3306');
      portInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onProbeChange).toHaveBeenCalled();
    let lastProbe = onProbeChange.mock.calls[onProbeChange.mock.calls.length - 1][0];
    expect(lastProbe.tcpSocket.port).toBe(3306);
    expect(typeof lastProbe.tcpSocket.port).toBe('number');

    // Re-render and type a named port.
    onProbeChange.mockClear();
    render({ probe: { tcpSocket: {} }, onProbeChange });
    const portInput2 = container.querySelector(
      '[data-field-key="tcpSocketPort"]'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(portInput2, 'http');
      portInput2.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onProbeChange).toHaveBeenCalled();
    lastProbe = onProbeChange.mock.calls[onProbeChange.mock.calls.length - 1][0];
    expect(lastProbe.tcpSocket.port).toBe('http');
    expect(typeof lastProbe.tcpSocket.port).toBe('string');
  });

  it('timing field change updates probe and empty value clears the field', () => {
    const onProbeChange = vi.fn();
    render({
      probe: { httpGet: { path: '/' }, initialDelaySeconds: 10 },
      onProbeChange,
    });
    const delayInput = container.querySelector(
      'input[data-field-key="initialDelaySeconds"]'
    ) as HTMLInputElement;
    // Change the value.
    act(() => {
      setNativeInputValue(delayInput, '20');
      delayInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onProbeChange).toHaveBeenCalled();
    let lastProbe = onProbeChange.mock.calls[onProbeChange.mock.calls.length - 1][0];
    expect(lastProbe.initialDelaySeconds).toBe(20);

    // Clear the value — field should be removed from probe.
    onProbeChange.mockClear();
    render({
      probe: { httpGet: { path: '/' }, initialDelaySeconds: 20 },
      onProbeChange,
    });
    const delayInput2 = container.querySelector(
      'input[data-field-key="initialDelaySeconds"]'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(delayInput2, '');
      delayInput2.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onProbeChange).toHaveBeenCalled();
    lastProbe = onProbeChange.mock.calls[onProbeChange.mock.calls.length - 1][0];
    expect(lastProbe.initialDelaySeconds).toBeUndefined();
  });

  it('exec command commits on Enter key', () => {
    const onProbeChange = vi.fn();
    render({
      probe: { exec: { command: [] } },
      onProbeChange,
    });
    const cmdInput = container.querySelector('[data-field-key="execCommand"]') as HTMLInputElement;
    act(() => {
      setNativeInputValue(cmdInput, 'ls -la');
      cmdInput.dispatchEvent(new Event('input', { bubbles: true }));
      cmdInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => {
      cmdInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onProbeChange).toHaveBeenCalled();
    const lastCall = onProbeChange.mock.calls[onProbeChange.mock.calls.length - 1][0];
    expect(lastCall.exec.command).toEqual(['ls', '-la']);
  });
});
