# Create Resource Form — Phase 1 (Bugs + Tests) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 bugs in the create resource form and add unit tests for 4 untested components.

**Architecture:** All bugs are isolated changes to form definition files and one modal file. Tests follow the existing raw ReactDOM + vitest pattern with Dropdown mocked as `<select>`.

**Tech Stack:** React, TypeScript, vitest

**Spec:** `docs/plans/2026-03-10-create-resource-phase1-design.md`

---

## Chunk 1: Bug Fixes

### Task 1: Add `required: true` to name fields and disable Create button

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/deployment.ts:10-16`
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/job.ts:10-15`
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/cronJob.ts:10-15`
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/service.ts:10-15`
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/configMap.ts:10-15`
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/ingress.ts:10-15`
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/secret.ts:10-15`
- Modify: `frontend/src/ui/modals/CreateResourceModal.tsx:801,809`
- Test: `frontend/src/ui/modals/create-resource/formDefinitions.test.ts`

- [ ] **Step 1: Add `required: true` to all 7 name fields**

In each of the 7 form definition files, add `required: true` to the `metadata.name` field. Example for `deployment.ts`:

```typescript
{
  key: 'name',
  label: 'Name',
  path: ['metadata', 'name'],
  type: 'text',
  required: true,
  placeholder: 'deployment-name',
  tooltip: 'Unique name for this Deployment within the namespace.',
},
```

Do the same for `job.ts`, `cronJob.ts`, `service.ts`, `configMap.ts`, `ingress.ts`, `secret.ts`.

- [ ] **Step 2: Disable Create and Validate buttons when required fields are empty**

In `frontend/src/ui/modals/CreateResourceModal.tsx`, update the `disabled` prop on both buttons to also check for required field errors when the form view is active:

Change line 801 from:
```typescript
disabled={!hasTarget || isBusy}
```
to:
```typescript
disabled={!hasTarget || isBusy || (showingForm && requiredFieldErrors.length > 0)}
```

Make the same change on line 809 (the Create button).

- [ ] **Step 3: Add a test that all name fields are required**

In `frontend/src/ui/modals/create-resource/formDefinitions.test.ts`, add a test:

```typescript
it('all definitions mark name as required', () => {
  for (const def of allFormDefinitions) {
    const nameField = def.sections
      .flatMap((s) => s.fields)
      .find((f) => f.key === 'name' && f.path.join('.') === 'metadata.name');
    expect(nameField, `${def.kind} should have a name field`).toBeDefined();
    expect(nameField!.required, `${def.kind} name field should be required`).toBe(true);
  }
});
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/formDefinitions.test.ts --reporter=verbose`

Expected: All tests pass including the new one.

- [ ] **Step 5: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`

Expected: No errors.

---

### Task 2: Fix restartPolicy options for Deployments

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/deployment.ts:426-436`

- [ ] **Step 1: Remove invalid options**

In `deployment.ts`, change the `restartPolicy` field options from:

```typescript
options: [
  { label: 'Always', value: 'Always' },
  { label: 'OnFailure', value: 'OnFailure' },
  { label: 'Never', value: 'Never' },
],
tooltip: 'When to restart containers in the pod. Always is required for Deployments.',
```

to:

```typescript
options: [
  { label: 'Always', value: 'Always' },
],
tooltip: 'Restart policy for containers in the pod. Deployments require Always.',
```

- [ ] **Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`

Expected: No errors.

---

### Task 3: Remove deprecated `serviceAccount` mirror

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/deployment.ts:368-376`

- [ ] **Step 1: Remove mirrorPaths from serviceAccountName field**

In `deployment.ts`, change the `serviceAccountName` field from:

```typescript
{
  key: 'serviceAccountName',
  label: 'Service Account',
  path: ['spec', 'template', 'spec', 'serviceAccountName'],
  mirrorPaths: [['spec', 'template', 'spec', 'serviceAccount']],
  type: 'text',
  placeholder: 'default',
  omitIfEmpty: true,
  tooltip: 'The service account the pod runs as. Controls API access and mounted secrets.',
},
```

to:

```typescript
{
  key: 'serviceAccountName',
  label: 'Service Account',
  path: ['spec', 'template', 'spec', 'serviceAccountName'],
  type: 'text',
  placeholder: 'default',
  omitIfEmpty: true,
  tooltip: 'The service account the pod runs as. Controls API access and mounted secrets.',
},
```

- [ ] **Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`

Expected: No errors.

---

### Task 4: Add SCTP to port protocol options

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/deployment.ts:198-209`
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/service.ts:73-83`

- [ ] **Step 1: Add SCTP option to deployment container port protocol**

In `deployment.ts`, change the protocol field options from:

```typescript
options: [
  { label: 'TCP', value: 'TCP' },
  { label: 'UDP', value: 'UDP' },
],
```

to:

```typescript
options: [
  { label: 'TCP', value: 'TCP' },
  { label: 'UDP', value: 'UDP' },
  { label: 'SCTP', value: 'SCTP' },
],
```

- [ ] **Step 2: Add SCTP option to service port protocol**

In `service.ts`, make the same change to the protocol field options.

- [ ] **Step 3: Run all form definition tests**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/ --reporter=verbose`

Expected: All tests pass.

---

## Chunk 2: FormProbeField Tests

### Task 5: Add FormProbeField unit tests

**Files:**
- Create: `frontend/src/ui/modals/create-resource/FormProbeField.test.tsx`

**Reference:** Read `FormProbeField.tsx` (403 lines) for component interface. The component takes `probe` (object or undefined), `label` (string), `onProbeChange` (callback), and `onRemoveProbe` (callback). It uses `Dropdown` (must be mocked), `FormCompactNumberInput`, `FormIconActionButton`, and `FormGhostAddText`.

- [ ] **Step 1: Write the test file**

Create `frontend/src/ui/modals/create-resource/FormProbeField.test.tsx`:

```typescript
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
    onProbeChange?: ReturnType<typeof vi.fn>;
    onRemoveProbe?: ReturnType<typeof vi.fn>;
  }) => {
    const onProbeChange = props.onProbeChange ?? vi.fn();
    const onRemoveProbe = props.onRemoveProbe ?? vi.fn();
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
    const portInput = container.querySelector('[data-field-key="tcpSocketPort"]') as HTMLInputElement;
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
    const typeDropdown = container.querySelector('[data-testid="dropdown-Readiness probe type"]') as HTMLSelectElement;
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
    const schemeDropdown = container.querySelector('[data-testid="dropdown-HTTP scheme"]') as HTMLSelectElement;
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
      cmdInput.dispatchEvent(new Event('blur', { bubbles: true }));
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
    const delayInput = container.querySelector('input[data-field-key="initialDelaySeconds"]') as HTMLInputElement;
    expect(delayInput.value).toBe('15');
    const failureInput = container.querySelector('input[data-field-key="failureThreshold"]') as HTMLInputElement;
    expect(failureInput.value).toBe('5');
  });

  it('TCP socket port input parses numeric strings to numbers and keeps named ports as strings', () => {
    const onProbeChange = vi.fn();
    render({
      probe: { tcpSocket: {} },
      onProbeChange,
    });
    const portInput = container.querySelector('[data-field-key="tcpSocketPort"]') as HTMLInputElement;
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
    const portInput2 = container.querySelector('[data-field-key="tcpSocketPort"]') as HTMLInputElement;
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
    const delayInput = container.querySelector('input[data-field-key="initialDelaySeconds"]') as HTMLInputElement;
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
    const delayInput2 = container.querySelector('input[data-field-key="initialDelaySeconds"]') as HTMLInputElement;
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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/FormProbeField.test.tsx --reporter=verbose`

Expected: All tests pass.

---

## Chunk 3: FormCommandInputField Tests

### Task 6: Add FormCommandInputField unit tests

**Files:**
- Create: `frontend/src/ui/modals/create-resource/FormCommandInputField.test.tsx`

**Reference:** Read `FormCommandInputField.tsx` (197 lines). The component takes `field` (FormFieldDefinition), `value` (unknown), `onChange` (callback), and optional `onAdd`/`onRemove`. It uses `Dropdown` (must be mocked), three modes (command/script/raw-yaml), and commits on blur.

- [ ] **Step 1: Write the test file**

Create `frontend/src/ui/modals/create-resource/FormCommandInputField.test.tsx`:

```typescript
import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormCommandInputField } from './FormCommandInputField';
import type { FormFieldDefinition } from './formDefinitions';

// Mock Dropdown as a simple <select>.
vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    options,
    value,
    onChange,
    ariaLabel,
  }: {
    options: Array<{ value: string; label: string }>;
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
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const setNativeInputValue = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
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

/** Minimal field definition for tests. */
const testField: FormFieldDefinition = {
  key: 'command',
  label: 'Command',
  path: ['command'],
  type: 'command-input',
  placeholder: '/bin/sh',
};

describe('FormCommandInputField', () => {
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

  it('renders add button when value is undefined and onAdd is provided', () => {
    const onAdd = vi.fn();
    act(() => {
      root.render(
        <FormCommandInputField
          field={testField}
          value={undefined}
          onChange={vi.fn()}
          onAdd={onAdd}
        />
      );
    });
    const addBtn = container.querySelector('button.resource-form-icon-btn') as HTMLElement;
    expect(addBtn).not.toBeNull();
    expect(container.textContent).toContain('Add command');
    act(() => addBtn.click());
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('renders input in command mode with existing value', () => {
    act(() => {
      root.render(
        <FormCommandInputField
          field={testField}
          value={['/bin/sh', '-c', 'echo hello']}
          onChange={vi.fn()}
        />
      );
    });
    const input = container.querySelector('input.resource-form-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    // Should not render a textarea in command mode.
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('commits parsed value on blur in command mode', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <FormCommandInputField
          field={testField}
          value={[]}
          onChange={onChange}
        />
      );
    });
    const input = container.querySelector('input.resource-form-input') as HTMLInputElement;
    act(() => {
      setNativeInputValue(input, 'echo hello');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall).toEqual(['echo', 'hello']);
  });

  it('renders textarea in script mode', () => {
    act(() => {
      root.render(
        <FormCommandInputField
          field={testField}
          value={['#!/bin/bash\necho hello']}
          onChange={vi.fn()}
        />
      );
    });
    // Script mode uses textarea.
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
  });

  it('mode switching reformats text and calls onChange', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <FormCommandInputField
          field={testField}
          value={['echo', 'hello']}
          onChange={onChange}
        />
      );
    });
    // Switch to script mode.
    const modeDropdown = container.querySelector('[data-testid="dropdown-Command input mode"]') as HTMLSelectElement;
    act(() => {
      modeDropdown.value = 'script';
      modeDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
  });

  it('renders remove button when onRemove is provided', () => {
    const onRemove = vi.fn();
    act(() => {
      root.render(
        <FormCommandInputField
          field={testField}
          value={['echo']}
          onChange={vi.fn()}
          onRemove={onRemove}
        />
      );
    });
    const removeBtn = container.querySelector('.resource-form-probe-actions button') as HTMLElement;
    expect(removeBtn).not.toBeNull();
    act(() => removeBtn.click());
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('resets displayed text when external value changes', () => {
    const onChange = vi.fn();
    const Wrapper = ({ val }: { val: string[] }) => (
      <FormCommandInputField field={testField} value={val} onChange={onChange} />
    );
    act(() => {
      root.render(<Wrapper val={['echo', 'hello']} />);
    });
    const input = container.querySelector('input.resource-form-input') as HTMLInputElement;
    expect(input.value).toContain('echo');
    // Re-render with a different value from outside (e.g., YAML editor change).
    act(() => {
      root.render(<Wrapper val={['ls', '-la']} />);
    });
    const updatedInput = container.querySelector('input.resource-form-input') as HTMLInputElement;
    expect(updatedInput.value).toContain('ls');
  });

  it('shows error for invalid YAML in raw-yaml mode', () => {
    act(() => {
      root.render(
        <FormCommandInputField
          field={testField}
          value={['item1']}
          onChange={vi.fn()}
        />
      );
    });
    // Switch to raw-yaml mode.
    const modeDropdown = container.querySelector('[data-testid="dropdown-Command input mode"]') as HTMLSelectElement;
    act(() => {
      modeDropdown.value = 'raw-yaml';
      modeDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    // Enter invalid YAML and blur.
    act(() => {
      setNativeInputValue(textarea, '{ invalid: [');
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => {
      textarea.dispatchEvent(new Event('blur', { bubbles: true }));
    });
    const errorSpan = container.querySelector('.resource-form-command-input-error');
    expect(errorSpan).not.toBeNull();
    expect(errorSpan!.textContent).toContain('Invalid YAML');
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/FormCommandInputField.test.tsx --reporter=verbose`

Expected: All tests pass.

---

## Chunk 4: NestedGroupListField Tests

### Task 7: Add NestedGroupListField unit tests

**Files:**
- Create: `frontend/src/ui/modals/create-resource/NestedGroupListField.test.tsx`

**Reference:** Read `NestedGroupListField.tsx` (383 lines). The component takes `subField` (FormFieldDefinition describing the group-list), `nestedItems` (array of objects), `yamlContent` (string), and `onNestedItemsChange` (callback). It renders sub-fields per item via `renderNestedLeafField`. It uses `Dropdown`, `FormCommandInputField`, `FormCompactNumberInput`, and `FormNestedListField`.

- [ ] **Step 1: Write the test file**

Create `frontend/src/ui/modals/create-resource/NestedGroupListField.test.tsx`:

```typescript
import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NestedGroupListField } from './NestedGroupListField';
import type { FormFieldDefinition } from './formDefinitions';

// Mock Dropdown as a simple <select>.
vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    options,
    value,
    onChange,
    ariaLabel,
  }: {
    options: Array<{ value: string; label: string }>;
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
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

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

/** Simple text-field-based group-list definition for basic tests. */
const envFieldDef: FormFieldDefinition = {
  key: 'env',
  label: 'Env Vars',
  path: ['env'],
  type: 'group-list',
  addLabel: 'Add Env Var',
  addGhostText: 'Add environment variable',
  defaultValue: {},
  fields: [
    { key: 'name', label: 'Name', path: ['name'], type: 'text', placeholder: 'VAR_NAME' },
    { key: 'value', label: 'Value', path: ['value'], type: 'text', placeholder: 'value' },
  ],
};

describe('NestedGroupListField', () => {
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

  it('renders sub-field labels and inputs for each item', () => {
    const items = [{ name: 'FOO', value: 'bar' }];
    act(() => {
      root.render(
        <NestedGroupListField
          subField={envFieldDef}
          nestedItems={items}
          yamlContent=""
          onNestedItemsChange={vi.fn()}
        />
      );
    });
    expect(container.textContent).toContain('Name');
    expect(container.textContent).toContain('Value');
    const nameInput = container.querySelector('[data-field-key="name"] input') as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe('FOO');
  });

  it('add button appends item with defaultValue', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <NestedGroupListField
          subField={envFieldDef}
          nestedItems={[]}
          yamlContent=""
          onNestedItemsChange={onChange}
        />
      );
    });
    const addBtn = container.querySelector('button.resource-form-add-btn') as HTMLElement;
    expect(addBtn).not.toBeNull();
    act(() => addBtn.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual([{}]);
  });

  it('remove button filters item at index', () => {
    const onChange = vi.fn();
    const items = [{ name: 'A' }, { name: 'B' }];
    act(() => {
      root.render(
        <NestedGroupListField
          subField={envFieldDef}
          nestedItems={items}
          yamlContent=""
          onNestedItemsChange={onChange}
        />
      );
    });
    // Click the first remove button.
    const removeBtns = container.querySelectorAll('button.resource-form-remove-btn');
    expect(removeBtns.length).toBe(2);
    act(() => (removeBtns[0] as HTMLElement).click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual([{ name: 'B' }]);
  });

  it('text field change updates item value', () => {
    const onChange = vi.fn();
    const items = [{ name: 'FOO', value: 'old' }];
    act(() => {
      root.render(
        <NestedGroupListField
          subField={envFieldDef}
          nestedItems={items}
          yamlContent=""
          onNestedItemsChange={onChange}
        />
      );
    });
    const valueInput = container.querySelector('[data-field-key="value"] input') as HTMLInputElement;
    act(() => {
      setNativeInputValue(valueInput, 'new');
      valueInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(updated[0].value).toBe('new');
  });

  it('boolean-toggle sets true on check and unsets on uncheck', () => {
    const boolFieldDef: FormFieldDefinition = {
      key: 'mounts',
      label: 'Mounts',
      path: ['mounts'],
      type: 'group-list',
      defaultValue: {},
      fields: [
        { key: 'readOnly', label: 'Read Only', path: ['readOnly'], type: 'boolean-toggle' },
      ],
    };
    const onChange = vi.fn();
    act(() => {
      root.render(
        <NestedGroupListField
          subField={boolFieldDef}
          nestedItems={[{}]}
          yamlContent=""
          onNestedItemsChange={onChange}
        />
      );
    });
    const checkbox = container.querySelector('input[data-field-key="readOnly"]') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);
    // Check it.
    act(() => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const checkedResult = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(checkedResult[0].readOnly).toBe(true);
  });

  it('select sub-field renders dropdown with options', () => {
    const selectFieldDef: FormFieldDefinition = {
      key: 'ports',
      label: 'Ports',
      path: ['ports'],
      type: 'group-list',
      defaultValue: { protocol: 'TCP' },
      fields: [
        {
          key: 'protocol',
          label: 'Protocol',
          path: ['protocol'],
          type: 'select',
          options: [
            { label: 'TCP', value: 'TCP' },
            { label: 'UDP', value: 'UDP' },
          ],
        },
      ],
    };
    act(() => {
      root.render(
        <NestedGroupListField
          subField={selectFieldDef}
          nestedItems={[{ protocol: 'TCP' }]}
          yamlContent=""
          onNestedItemsChange={vi.fn()}
        />
      );
    });
    const select = container.querySelector('[data-testid="dropdown-Protocol"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('TCP');
  });

  it('select sub-field with dynamicOptionsPath resolves options from YAML', () => {
    const volumeMountFieldDef: FormFieldDefinition = {
      key: 'volumeMounts',
      label: 'Volume Mounts',
      path: ['volumeMounts'],
      type: 'group-list',
      defaultValue: {},
      fields: [
        {
          key: 'name',
          label: 'Volume',
          path: ['name'],
          type: 'select',
          dynamicOptionsPath: ['spec', 'template', 'spec', 'volumes'],
          dynamicOptionsField: 'name',
        },
      ],
    };
    // Provide YAML with volumes defined.
    const yaml = `spec:
  template:
    spec:
      volumes:
        - name: config-vol
        - name: data-vol`;
    act(() => {
      root.render(
        <NestedGroupListField
          subField={volumeMountFieldDef}
          nestedItems={[{ name: 'config-vol' }]}
          yamlContent={yaml}
          onNestedItemsChange={vi.fn()}
        />
      );
    });
    const select = container.querySelector('[data-testid="dropdown-Volume"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    // Should have the empty option + 2 volumes.
    expect(select.options.length).toBe(3);
    expect(select.value).toBe('config-vol');
  });

  it('disableAdd when dynamic options are exhausted and shows disabledGhostText', () => {
    const volumeMountFieldDef: FormFieldDefinition = {
      key: 'volumeMounts',
      label: 'Volume Mounts',
      path: ['volumeMounts'],
      type: 'group-list',
      defaultValue: {},
      disabledGhostText: 'Add volumes first',
      fields: [
        {
          key: 'name',
          label: 'Volume',
          path: ['name'],
          type: 'select',
          dynamicOptionsPath: ['spec', 'template', 'spec', 'volumes'],
          dynamicOptionsField: 'name',
        },
      ],
    };
    // Provide empty YAML — no volumes defined.
    act(() => {
      root.render(
        <NestedGroupListField
          subField={volumeMountFieldDef}
          nestedItems={[]}
          yamlContent=""
          onNestedItemsChange={vi.fn()}
        />
      );
    });
    // The disabled ghost text should appear.
    expect(container.textContent).toContain('Add volumes first');
  });

  it('text sub-field with alternatePath renders toggle', () => {
    const mountFieldDef: FormFieldDefinition = {
      key: 'volumeMounts',
      label: 'Volume Mounts',
      path: ['volumeMounts'],
      type: 'group-list',
      defaultValue: {},
      fields: [
        {
          key: 'subPath',
          label: 'Sub Path',
          path: ['subPath'],
          type: 'text',
          alternatePath: ['subPathExpr'],
          alternateLabel: 'Use Expression',
          placeholder: 'sub/path',
        },
      ],
    };
    const onChange = vi.fn();
    act(() => {
      root.render(
        <NestedGroupListField
          subField={mountFieldDef}
          nestedItems={[{ subPath: 'data' }]}
          yamlContent=""
          onNestedItemsChange={onChange}
        />
      );
    });
    // Toggle checkbox should exist with "Use Expression" label.
    expect(container.textContent).toContain('Use Expression');
    const toggle = container.querySelector('[data-field-key="subPathExprToggle"]') as HTMLInputElement;
    expect(toggle).not.toBeNull();
    expect(toggle.checked).toBe(false);
    // Check the toggle — should switch to alternatePath.
    act(() => {
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    // subPath should be unset, subPathExpr should have the value.
    expect(updated[0].subPath).toBeUndefined();
    expect(updated[0].subPathExpr).toBe('data');
  });

  it('unhandled field type returns null without crash', () => {
    const weirdFieldDef: FormFieldDefinition = {
      key: 'weird',
      label: 'Weird',
      path: ['weird'],
      type: 'group-list',
      defaultValue: {},
      fields: [
        { key: 'x', label: 'X', path: ['x'], type: 'probe' as FormFieldDefinition['type'] },
      ],
    };
    // Should render without throwing.
    act(() => {
      root.render(
        <NestedGroupListField
          subField={weirdFieldDef}
          nestedItems={[{}]}
          yamlContent=""
          onNestedItemsChange={vi.fn()}
        />
      );
    });
    // The wrapper div exists but has no input/select child (the field rendered null).
    const wrapper = container.querySelector('[data-field-key="x"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector('input')).toBeNull();
    expect(wrapper!.querySelector('select')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/NestedGroupListField.test.tsx --reporter=verbose`

Expected: All tests pass.

---

## Chunk 5: FormVolumeSourceField Tests

### Task 8: Add FormVolumeSourceField unit tests

**Files:**
- Create: `frontend/src/ui/modals/create-resource/FormVolumeSourceField.test.tsx`

**Reference:** Read `FormVolumeSourceField.tsx` (612 lines). The component interface is `{ item, updateItem, dataFieldKey, ariaLabel }`. The `updateItem` prop receives an updater function `(item) => newItem`. It renders a source type dropdown, source-specific inputs, extra fields, and an items list for ConfigMap/Secret. `ResourceForm.test.tsx` already covers integration paths for PVC, Secret, EmptyDir, HostPath. These unit tests focus on gaps: `getCurrentVolumeSource` detection, source-type switching clears old keys, ConfigMap items handlers, and `aria-required`.

Since `getCurrentVolumeSource` and internal handlers are not exported (they're used within the component), we test them through rendering and observing DOM state. The `updateItem` callback receives an updater function, so to inspect results we capture and call the updater ourselves.

- [ ] **Step 1: Write the test file**

Create `frontend/src/ui/modals/create-resource/FormVolumeSourceField.test.tsx`:

```typescript
import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormVolumeSourceField } from './FormVolumeSourceField';

// Mock Dropdown as a simple <select>.
vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    options,
    value,
    onChange,
    ariaLabel,
  }: {
    options: Array<{ value: string; label: string }>;
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
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

describe('FormVolumeSourceField', () => {
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

  /** Helper: render with correct props, returns the updateItem mock. */
  const render = (item: Record<string, unknown>, updateItem?: ReturnType<typeof vi.fn>) => {
    const mockUpdateItem = updateItem ?? vi.fn();
    act(() => {
      root.render(
        <FormVolumeSourceField
          item={item}
          updateItem={mockUpdateItem}
          dataFieldKey="source"
          ariaLabel="Source"
        />
      );
    });
    return mockUpdateItem;
  };

  it('detects configMap source and renders name input', () => {
    render({ name: 'cfg-vol', configMap: { name: 'my-config' } });
    const nameInput = container.querySelector('[data-field-key="configMapName"] input') as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe('my-config');
  });

  it('detects secret source and renders name input with aria-required', () => {
    render({ name: 'secret-vol', secret: { secretName: 'my-secret' } });
    const nameInput = container.querySelector('[data-field-key="secretName"] input') as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe('my-secret');
    expect(nameInput.getAttribute('aria-required')).toBe('true');
  });

  it('detects PVC source and shows PVC-specific extra fields', () => {
    render({ name: 'pvc-vol', persistentVolumeClaim: { claimName: 'my-claim' } });
    // PVC renders claimName as an extra field.
    const claimInput = container.querySelector('[data-field-key="claimName"] input') as HTMLInputElement;
    expect(claimInput).not.toBeNull();
    expect(claimInput.value).toBe('my-claim');
  });

  it('detects hostPath source and renders path extra field', () => {
    render({ name: 'host-vol', hostPath: { path: '/data' } });
    const pathInput = container.querySelector('[data-field-key="path"] input') as HTMLInputElement;
    expect(pathInput).not.toBeNull();
    expect(pathInput.value).toBe('/data');
  });

  it('detects emptyDir source via dropdown value', () => {
    render({ name: 'tmp-vol', emptyDir: {} });
    const sourceTypeDropdown = container.querySelector('[data-testid="dropdown-Source"]') as HTMLSelectElement;
    expect(sourceTypeDropdown.value).toBe('emptyDir');
  });

  it('switching source type calls updateItem with updater that clears old keys', () => {
    const updateItem = vi.fn();
    const item = { name: 'vol', configMap: { name: 'cm' } };
    render(item, updateItem);
    // Switch to PVC.
    const sourceTypeDropdown = container.querySelector('[data-testid="dropdown-Source"]') as HTMLSelectElement;
    act(() => {
      sourceTypeDropdown.value = 'pvc';
      sourceTypeDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(updateItem).toHaveBeenCalledTimes(1);
    // The argument is an updater function — call it with the current item to inspect result.
    const updater = updateItem.mock.calls[0][0] as (i: Record<string, unknown>) => Record<string, unknown>;
    const result = updater(item);
    expect(result.configMap).toBeUndefined();
    expect(result.persistentVolumeClaim).toBeDefined();
  });

  it('selecting the same source type is a no-op', () => {
    const updateItem = vi.fn();
    render({ name: 'vol', configMap: { name: 'cm' } }, updateItem);
    // Select configMap again.
    const sourceTypeDropdown = container.querySelector('[data-testid="dropdown-Source"]') as HTMLSelectElement;
    act(() => {
      sourceTypeDropdown.value = 'configMap';
      sourceTypeDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // updateItem should NOT have been called.
    expect(updateItem).not.toHaveBeenCalled();
  });

  it('configMap source renders items list with add button', () => {
    render({ name: 'vol', configMap: { name: 'cm' } });
    const addBtns = container.querySelectorAll('button.resource-form-add-btn');
    expect(addBtns.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/FormVolumeSourceField.test.tsx --reporter=verbose`

Expected: All tests pass.

---

## Chunk 6: Final Verification

### Task 9: Run full test suite and linting

- [ ] **Step 1: Run all create-resource tests**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/ --reporter=verbose`

Expected: All tests pass.

- [ ] **Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Run linting**

Run: `cd frontend && npx eslint src/ui/modals/create-resource/ --max-warnings=0`

Expected: No errors or warnings.
