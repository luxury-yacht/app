import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KarpenterFacts } from '@/core/refresh/types';
import { KarpenterScheduling } from './KarpenterSections';

vi.mock('@shared/components/Tooltip', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe('Karpenter scheduling value disclosure', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (facts: KarpenterFacts) =>
    act(() => root.render(<KarpenterScheduling facts={facts} />));

  it('expands and collapses an instance-type list when the user clicks the value itself', () => {
    const values = Array.from({ length: 30 }, (_, index) => `m${index + 1}g.xlarge`);
    const value = values.join(', ');
    render({
      requirements: [
        { key: 'node.kubernetes.io/instance-type', operator: 'In', values, minValues: 2 },
      ],
    });

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-controls]');
    expect(toggle).not.toBeNull();
    const content = document.getElementById(toggle?.getAttribute('aria-controls') ?? '');
    expect(content?.textContent).toBe(value.slice(0, 150));
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).toContain('min values: 2');

    act(() => content?.click());
    expect(content?.textContent).toBe(value);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');

    act(() => content?.click());
    expect(content?.textContent).toBe(value.slice(0, 150));
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).toContain('min values: 2');
  });
});
