import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ModalStateProvider, useModalState } from './ModalStateContext';

const stateRef: { current: ReturnType<typeof useModalState> | null } = { current: null };

const Harness: React.FC = () => {
  stateRef.current = useModalState();
  return null;
};

describe('ModalStateContext', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    stateRef.current = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('stores create resource modal open state', async () => {
    await act(async () => {
      root.render(
        <ModalStateProvider>
          <Harness />
        </ModalStateProvider>
      );
    });

    expect(stateRef.current?.isCreateResourceOpen).toBe(false);

    act(() => {
      stateRef.current?.setIsCreateResourceOpen(true);
    });

    expect(stateRef.current?.isCreateResourceOpen).toBe(true);
  });
});
