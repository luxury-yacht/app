import { StatusChip } from '@shared/components/StatusChip';
import { TABLE_NO_VALUE_TEXT } from '@shared/components/tables/tableNoValue';
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

  // An Event without a type must not be presented as a Normal event.
  it('shows the empty placeholder for an untyped event instead of claiming Normal', () => {
    const column = createEventTypeColumn<{ type?: string }>();
    const row = { type: '' };

    expect(column.render(row)).toBe(TABLE_NO_VALUE_TEXT);
    expect(column.sortValue?.(row)).toBe('');
  });
});
