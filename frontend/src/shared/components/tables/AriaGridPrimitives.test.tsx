import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  AriaGrid,
  AriaGridCell,
  AriaGridColumnHeader,
  AriaGridRow,
  AriaGridRowGroup,
} from './AriaGridPrimitives';

describe('native grid primitives', () => {
  it('render valid native table ancestry without synthetic ARIA roles', () => {
    const container = document.createElement('div');
    const root = ReactDOM.createRoot(container);

    act(() => {
      root.render(
        <AriaGrid>
          <thead>
            <AriaGridRow>
              <AriaGridColumnHeader>Name</AriaGridColumnHeader>
            </AriaGridRow>
          </thead>
          <AriaGridRowGroup>
            <AriaGridRow>
              <AriaGridCell>pod-a</AriaGridCell>
            </AriaGridRow>
          </AriaGridRowGroup>
        </AriaGrid>
      );
    });

    expect(container.querySelector('table > thead > tr > th')?.textContent).toBe('Name');
    expect(container.querySelector('table > tbody > tr > td')?.textContent).toBe('pod-a');
    expect(container.querySelector('[role]')).toBeNull();
    act(() => root.unmount());
  });
});
