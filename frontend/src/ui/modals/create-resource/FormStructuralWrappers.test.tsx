import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FormFieldRow } from './FormFieldRow';
import { FormSectionCard } from './FormSectionCard';

describe('Form structural wrappers', () => {
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

  it('renders FormFieldRow with label and standard row classes', async () => {
    await act(async () => {
      root.render(
        <FormFieldRow label="Name">
          <input data-testid="value" />
        </FormFieldRow>
      );
    });

    const row = container.querySelector('.resource-form-field') as HTMLDivElement;
    const label = container.querySelector('.resource-form-label') as HTMLLabelElement;
    expect(row).not.toBeNull();
    expect(row.className).not.toContain('resource-form-field--full-width');
    expect(label.textContent).toBe('Name');
  });

  it('renders FormFieldRow full-width without label', async () => {
    await act(async () => {
      root.render(
        <FormFieldRow label="Containers" fullWidth>
          <div data-testid="value">content</div>
        </FormFieldRow>
      );
    });

    const row = container.querySelector('.resource-form-field') as HTMLDivElement;
    expect(row.className).toContain('resource-form-field--full-width');
    expect(container.querySelector('.resource-form-label')).toBeNull();
  });

  it('renders FormSectionCard with title and action slot', async () => {
    await act(async () => {
      root.render(
        <FormSectionCard title="Metadata" titleAction={<span data-testid="action">A</span>}>
          <div data-testid="content">body</div>
        </FormSectionCard>
      );
    });

    const section = container.querySelector('.resource-form-section') as HTMLDivElement;
    const title = container.querySelector('.resource-form-section-title') as HTMLHeadingElement;
    expect(section).not.toBeNull();
    expect(title.textContent).toContain('Metadata');
    expect(title.querySelector('[data-testid="action"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="content"]')?.textContent).toBe('body');
  });
});
