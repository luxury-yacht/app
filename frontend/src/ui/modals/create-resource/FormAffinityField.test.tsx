import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormAffinityField } from './FormAffinityField';

/**
 * Update a text input's native value so React 19's change tracking picks it up.
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

describe('FormAffinityField', () => {
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

  /** Helper to render the component. */
  const render = (
    value: Record<string, unknown>,
    onChange?: (newValue: Record<string, unknown>) => void
  ) => {
    const mockOnChange = onChange ?? vi.fn<(newValue: Record<string, unknown>) => void>();
    act(() => {
      root.render(
        <FormAffinityField dataFieldKey="affinity" value={value} onChange={mockOnChange} />
      );
    });
    return mockOnChange;
  };

  // ── Empty state ─────────────────────────────────────────────────────

  it('renders empty state with section headers and add buttons', () => {
    render({});
    expect(container.textContent).toContain('Node Affinity');
    expect(container.textContent).toContain('Pod Affinity');
    expect(container.textContent).toContain('Pod Anti-Affinity');
    // Add buttons for required and preferred in each section.
    const addBtns = container.querySelectorAll('button.resource-form-add-btn');
    expect(addBtns.length).toBeGreaterThanOrEqual(6);
  });

  // ── Node affinity ───────────────────────────────────────────────────

  it('renders existing node affinity required rule with expressions', () => {
    render({
      nodeAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [
            {
              matchExpressions: [{ key: 'kubernetes.io/os', operator: 'In', values: ['linux'] }],
            },
          ],
        },
      },
    });
    // Key input should have the value.
    const keyInput = container.querySelector(
      '[data-field-key="nodeReqExprKey-0-0"] input'
    ) as HTMLInputElement;
    expect(keyInput).not.toBeNull();
    expect(keyInput.value).toBe('kubernetes.io/os');
    // Values input should show comma-separated.
    const valuesInput = container.querySelector(
      '[data-field-key="nodeReqExprValues-0-0"] input'
    ) as HTMLInputElement;
    expect(valuesInput).not.toBeNull();
    expect(valuesInput.value).toBe('linux');
  });

  it('renders node affinity preferred rule with weight', () => {
    render({
      nodeAffinity: {
        preferredDuringSchedulingIgnoredDuringExecution: [
          {
            weight: 50,
            preference: {
              matchExpressions: [{ key: 'disk-type', operator: 'In', values: ['ssd'] }],
            },
          },
        ],
      },
    });
    const weightInput = container.querySelector(
      '[data-field-key="nodePrefWeight-0"] input'
    ) as HTMLInputElement;
    expect(weightInput).not.toBeNull();
    expect(weightInput.value).toBe('50');
  });

  it('add node required rule creates default expression', () => {
    const onChange = vi.fn();
    render({}, onChange);
    // Find the add button for node required rules.
    const addBtn = container.querySelector('[data-field-key="addNodeRequiredRule"]') as HTMLElement;
    expect(addBtn).not.toBeNull();
    act(() => addBtn.click());
    expect(onChange).toHaveBeenCalled();
    const newValue = onChange.mock.calls[0][0];
    const terms =
      newValue.nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution.nodeSelectorTerms;
    expect(terms).toHaveLength(1);
    expect(terms[0].matchExpressions).toHaveLength(1);
    expect(terms[0].matchExpressions[0].operator).toBe('In');
  });

  it('remove node required rule removes it', () => {
    const onChange = vi.fn();
    render(
      {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [{ key: 'os', operator: 'In', values: ['linux'] }],
              },
            ],
          },
        },
      },
      onChange
    );
    const removeBtn = container.querySelector(
      '[data-field-key="removeNodeReqRule-0"]'
    ) as HTMLElement;
    expect(removeBtn).not.toBeNull();
    act(() => removeBtn.click());
    expect(onChange).toHaveBeenCalled();
  });

  // ── Pod affinity ────────────────────────────────────────────────────

  it('renders pod affinity rule with topologyKey', () => {
    render({
      podAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: [
          {
            labelSelector: {
              matchExpressions: [{ key: 'app', operator: 'In', values: ['web'] }],
            },
            topologyKey: 'kubernetes.io/hostname',
          },
        ],
      },
    });
    const topoInput = container.querySelector(
      '[data-field-key="podReqTopo-0"] input'
    ) as HTMLInputElement;
    expect(topoInput).not.toBeNull();
    expect(topoInput.value).toBe('kubernetes.io/hostname');
  });

  // ── Pod anti-affinity ───────────────────────────────────────────────

  it('renders pod anti-affinity rule', () => {
    render({
      podAntiAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: [
          {
            labelSelector: {
              matchExpressions: [{ key: 'app', operator: 'In', values: ['web'] }],
            },
            topologyKey: 'topology.kubernetes.io/zone',
          },
        ],
      },
    });
    const keyInput = container.querySelector(
      '[data-field-key="antiReqExprKey-0-0"] input'
    ) as HTMLInputElement;
    expect(keyInput).not.toBeNull();
    expect(keyInput.value).toBe('app');
  });

  // ── Expression management ───────────────────────────────────────────

  it('add expression within a rule', () => {
    const onChange = vi.fn();
    render(
      {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [{ key: 'os', operator: 'In', values: ['linux'] }],
              },
            ],
          },
        },
      },
      onChange
    );
    const addExprBtn = container.querySelector(
      '[data-field-key="addNodeReqExpr-0"]'
    ) as HTMLElement;
    expect(addExprBtn).not.toBeNull();
    act(() => addExprBtn.click());
    expect(onChange).toHaveBeenCalled();
    const terms =
      onChange.mock.calls[0][0].nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution
        .nodeSelectorTerms;
    expect(terms[0].matchExpressions).toHaveLength(2);
  });

  it('remove expression from a rule', () => {
    const onChange = vi.fn();
    render(
      {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [
                  { key: 'os', operator: 'In', values: ['linux'] },
                  { key: 'arch', operator: 'In', values: ['amd64'] },
                ],
              },
            ],
          },
        },
      },
      onChange
    );
    const removeBtn = container.querySelector(
      '[data-field-key="removeNodeReqExpr-0-1"]'
    ) as HTMLElement;
    expect(removeBtn).not.toBeNull();
    act(() => removeBtn.click());
    expect(onChange).toHaveBeenCalled();
    const terms =
      onChange.mock.calls[0][0].nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution
        .nodeSelectorTerms;
    expect(terms[0].matchExpressions).toHaveLength(1);
    expect(terms[0].matchExpressions[0].key).toBe('os');
  });

  it('operator change hides values for Exists', () => {
    render({
      nodeAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [
            {
              matchExpressions: [{ key: 'gpu', operator: 'Exists', values: [] }],
            },
          ],
        },
      },
    });
    // Values input should not be present for Exists operator.
    const valuesInput = container.querySelector('[data-field-key="nodeReqExprValues-0-0"] input');
    expect(valuesInput).toBeNull();
  });

  it('expression key input updates correctly', () => {
    const onChange = vi.fn();
    render(
      {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [{ key: '', operator: 'In', values: [] }],
              },
            ],
          },
        },
      },
      onChange
    );
    const keyInput = container.querySelector(
      '[data-field-key="nodeReqExprKey-0-0"] input'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(keyInput, 'kubernetes.io/arch');
      keyInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const expr =
      onChange.mock.calls[0][0].nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution
        .nodeSelectorTerms[0].matchExpressions[0];
    expect(expr.key).toBe('kubernetes.io/arch');
  });

  it('expression values input updates correctly', () => {
    const onChange = vi.fn();
    render(
      {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [{ key: 'os', operator: 'In', values: [] }],
              },
            ],
          },
        },
      },
      onChange
    );
    const valuesInput = container.querySelector(
      '[data-field-key="nodeReqExprValues-0-0"] input'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(valuesInput, 'linux, windows');
      valuesInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const expr =
      onChange.mock.calls[0][0].nodeAffinity.requiredDuringSchedulingIgnoredDuringExecution
        .nodeSelectorTerms[0].matchExpressions[0];
    expect(expr.values).toEqual(['linux', 'windows']);
  });

  // ── Weight and topologyKey ──────────────────────────────────────────

  it('weight input updates for preferred rules', () => {
    const onChange = vi.fn();
    render(
      {
        nodeAffinity: {
          preferredDuringSchedulingIgnoredDuringExecution: [
            {
              weight: 1,
              preference: {
                matchExpressions: [{ key: 'zone', operator: 'In', values: ['us-east'] }],
              },
            },
          ],
        },
      },
      onChange
    );
    const weightInput = container.querySelector(
      '[data-field-key="nodePrefWeight-0"] input'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(weightInput, '75');
      weightInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const pref =
      onChange.mock.calls[0][0].nodeAffinity.preferredDuringSchedulingIgnoredDuringExecution[0];
    expect(pref.weight).toBe(75);
  });

  it('topologyKey input updates for pod affinity rules', () => {
    const onChange = vi.fn();
    render(
      {
        podAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: [
            {
              labelSelector: {
                matchExpressions: [{ key: 'app', operator: 'In', values: ['web'] }],
              },
              topologyKey: '',
            },
          ],
        },
      },
      onChange
    );
    const topoInput = container.querySelector(
      '[data-field-key="podReqTopo-0"] input'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(topoInput, 'kubernetes.io/hostname');
      topoInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const rule =
      onChange.mock.calls[0][0].podAffinity.requiredDuringSchedulingIgnoredDuringExecution[0];
    expect(rule.topologyKey).toBe('kubernetes.io/hostname');
  });

  // ── Mixed state ─────────────────────────────────────────────────────

  it('renders mixed rules across all sections', () => {
    render({
      nodeAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: {
          nodeSelectorTerms: [
            {
              matchExpressions: [{ key: 'os', operator: 'In', values: ['linux'] }],
            },
          ],
        },
      },
      podAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: [
          {
            labelSelector: {
              matchExpressions: [{ key: 'app', operator: 'In', values: ['web'] }],
            },
            topologyKey: 'kubernetes.io/hostname',
          },
        ],
      },
      podAntiAffinity: {
        requiredDuringSchedulingIgnoredDuringExecution: [
          {
            labelSelector: {
              matchExpressions: [{ key: 'app', operator: 'In', values: ['web'] }],
            },
            topologyKey: 'kubernetes.io/hostname',
          },
        ],
      },
    });
    // All three sections should have rules rendered.
    const exprRows = container.querySelectorAll('.resource-form-affinity-expr-row');
    expect(exprRows.length).toBe(3);
  });

  it('removing all rules calls onChange with empty object', () => {
    const onChange = vi.fn();
    render(
      {
        nodeAffinity: {
          requiredDuringSchedulingIgnoredDuringExecution: {
            nodeSelectorTerms: [
              {
                matchExpressions: [{ key: 'os', operator: 'In', values: ['linux'] }],
              },
            ],
          },
        },
      },
      onChange
    );
    const removeBtn = container.querySelector(
      '[data-field-key="removeNodeReqRule-0"]'
    ) as HTMLElement;
    act(() => removeBtn.click());
    expect(onChange).toHaveBeenCalled();
    const result = onChange.mock.calls[0][0];
    expect(Object.keys(result).length).toBe(0);
  });
});
