import { StatusChip } from '@shared/components/StatusChip';
import { createEventTypeColumn } from '@shared/events/eventColumns';
import React from 'react';
import { describe, expect, it } from 'vitest';

describe('createEventTypeColumn', () => {
  it('declares inert measurement markup matching the rendered status chip', () => {
    const column = createEventTypeColumn<{ type?: string }>();
    const row = { type: 'Warning' };
    const rendered = column.render(row);

    expect(React.isValidElement(rendered)).toBe(true);
    expect((rendered as React.ReactElement).type).toBe(StatusChip);
    expect(column.measurementElement?.(row)).toEqual({
      tagName: 'span',
      className: 'status-chip status-chip--warning',
      textContent: 'Warning',
    });
  });
});
