import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type CustomResourceGridRow, customResourceStatusColumn } from './CustomResourceGridView';

const row: CustomResourceGridRow = {
  ref: {
    clusterId: 'a',
    group: 'monitoring.coreos.com',
    version: 'v1',
    kind: 'ServiceMonitor',
    resource: 'servicemonitors',
    namespace: 'team-a',
    name: 'web',
  },
};

const cell = (resource: CustomResourceGridRow) => {
  const dom = document.createElement('div');
  const rendered = customResourceStatusColumn.render(resource);
  dom.innerHTML = typeof rendered === 'string' ? rendered : renderToStaticMarkup(rendered);
  return dom;
};

describe('custom resource status column', () => {
  it('shows the placeholder, not Unknown, for objects the backend projects no status for', () => {
    expect(cell(row).textContent).toBe('-');
    expect(cell({ ...row, status: '' }).textContent).toBe('-');
  });

  it('keeps the projected status and its presentation class for objects that report one', () => {
    const dom = cell({ ...row, status: 'Ready', statusPresentation: 'ready' });
    expect(dom.textContent).toBe('Ready');
    expect(dom.querySelector('.status-text.ready')).not.toBeNull();
  });
});
