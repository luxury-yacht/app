import React, { useImperativeHandle } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useGridTableFilterHandlers } from '@shared/components/tables/hooks/useGridTableFilterHandlers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useGridTableFilterHandlers', () => {
  const renderHarness = async () => {
    const kindsMock = vi.fn();
    const namespacesMock = vi.fn();

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    const handlerRef = {
      current: null as null | {
        handleKind: (value: string | string[]) => void;
        handleNamespace: (value: string | string[]) => void;
      },
    };

    const Harness = React.forwardRef((_, ref: any) => {
      const handlers = useGridTableFilterHandlers({
        handleFilterKindsChange: kindsMock,
        handleFilterNamespacesChange: namespacesMock,
      });
      useImperativeHandle(ref, () => ({
        handleKind: handlers.handleKindDropdownChange,
        handleNamespace: handlers.handleNamespaceDropdownChange,
      }));
      return null;
    });

    await act(async () => {
      root.render(<Harness ref={handlerRef} />);
    });

    return {
      kindsMock,
      namespacesMock,
      handlerRef,
      unmount: async () => {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      },
    };
  };

  it('normalizes single string values for kinds', async () => {
    const { handlerRef, kindsMock, unmount } = await renderHarness();

    await act(async () => {
      handlerRef.current?.handleKind('pod');
    });

    expect(kindsMock).toHaveBeenCalledWith(['pod']);
    await unmount();
  });

  it('passes through arrays and clears values for kinds', async () => {
    const { handlerRef, kindsMock, unmount } = await renderHarness();

    await act(async () => {
      handlerRef.current?.handleKind(['a', 'b']);
      handlerRef.current?.handleKind('');
    });

    expect(kindsMock).toHaveBeenNthCalledWith(1, ['a', 'b']);
    expect(kindsMock).toHaveBeenNthCalledWith(2, []);
    await unmount();
  });

  it('normalizes namespace values', async () => {
    const { handlerRef, namespacesMock, unmount } = await renderHarness();

    await act(async () => {
      handlerRef.current?.handleNamespace('default');
    });

    expect(namespacesMock).toHaveBeenCalledWith(['default']);
    await unmount();
  });
});
