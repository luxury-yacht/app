/**
 * frontend/src/core/contexts/DetailsSectionContext.test.tsx
 *
 * Test suite for DetailsSectionContext.
 * Covers key behaviors and edge cases for DetailsSectionContext.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import {
  DetailsSectionProvider,
  useDetailsSectionContext,
  type DetailsSectionState,
} from './ObjectPanelDetailsSectionContext';

const renderWithProvider = async (component: React.ReactElement) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    root.render(component);
    await Promise.resolve();
  });

  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

describe('DetailsSectionContext', () => {
  it('throws when hook is used outside provider', () => {
    const TestComponent = () => {
      useDetailsSectionContext();
      return null;
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    expect(() => {
      act(() => {
        root.render(<TestComponent />);
      });
    }).toThrowError(/must be used within DetailsSectionProvider/);

    act(() => root.unmount());
    container.remove();
  });

  it('provides section state toggling through the provider', async () => {
    const capturedStates: DetailsSectionState[] = [];

    const TestComponent = () => {
      const { sectionStates, setSectionExpanded } = useDetailsSectionContext();
      capturedStates.push(sectionStates);

      return (
        <button
          onClick={() => {
            setSectionExpanded('overview', false);
            setSectionExpanded('containers', false);
            setSectionExpanded('nodePods', true);
          }}
        >
          Toggle
        </button>
      );
    };

    const { container, cleanup } = await renderWithProvider(
      <DetailsSectionProvider>
        <TestComponent />
      </DetailsSectionProvider>
    );

    const button = container.querySelector('button');
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const latestState = capturedStates[capturedStates.length - 1];
    expect(latestState).toMatchObject({ overview: false, containers: false, nodePods: true });

    cleanup();
  });
});
