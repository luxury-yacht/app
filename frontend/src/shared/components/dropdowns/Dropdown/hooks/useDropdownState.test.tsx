/**
 * frontend/src/shared/components/dropdowns/Dropdown/hooks/useDropdownState.test.tsx
 *
 * Test suite for useDropdownState.
 * Covers key behaviors and edge cases for useDropdownState.
 */

import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDropdownState } from '@shared/components/dropdowns/Dropdown/hooks/useDropdownState';

type HookProps = Parameters<typeof useDropdownState>;
type HookResult = ReturnType<typeof useDropdownState>;

const createDefaultProps = (): HookProps => ['', vi.fn(), false, false];

describe('useDropdownState', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderHook = async (initialProps?: Partial<HookProps>) => {
    const props: HookProps = initialProps
      ? [
          initialProps[0] ?? '',
          initialProps[1] ?? vi.fn(),
          initialProps[2] ?? false,
          initialProps[3] ?? false,
        ]
      : createDefaultProps();

    const resultRef = { current: null as HookResult | null };

    const Harness: React.FC<{ hookProps: HookProps }> = ({ hookProps }) => {
      const hookResult = useDropdownState(...hookProps);
      useEffect(() => {
        resultRef.current = hookResult;
      }, [hookResult]);
      return null;
    };

    const mount = async (hookProps: HookProps) => {
      await act(async () => {
        root.render(<Harness hookProps={hookProps} />);
        await Promise.resolve();
      });
    };

    await mount(props);

    return {
      getResult: () => {
        if (!resultRef.current) {
          throw new Error('Hook result not initialised');
        }
        return resultRef.current;
      },
      rerender: async (nextProps: Partial<HookProps>) => {
        const merged: HookProps = [
          nextProps[0] ?? props[0],
          nextProps[1] ?? props[1],
          nextProps[2] ?? props[2],
          nextProps[3] ?? props[3],
        ];
        await mount(merged);
        props[0] = merged[0];
        props[1] = merged[1];
        props[2] = merged[2];
        props[3] = merged[3];
      },
    };
  };

  it('opens the dropdown when enabled and resets highlight and search state', async () => {
    const onChange = vi.fn();
    const { getResult } = await renderHook(['initial', onChange, false, false]);
    const initialResult = getResult();

    await act(async () => {
      initialResult.setHighlightedIndex(5);
      initialResult.setSearchQuery('prefill');
      await Promise.resolve();
    });

    await act(async () => {
      getResult().openDropdown();
      await Promise.resolve();
    });

    const opened = getResult();
    expect(opened.isOpen).toBe(true);
    expect(opened.highlightedIndex).toBe(-1);
    expect(opened.searchQuery).toBe('');
  });

  it('does not open when disabled and preserves existing highlight/search values', async () => {
    const onChange = vi.fn();
    const { getResult } = await renderHook(['initial', onChange, false, true]);
    const result = getResult();

    await act(async () => {
      result.setHighlightedIndex(3);
      result.setSearchQuery('keep');
      await Promise.resolve();
    });

    await act(async () => {
      getResult().openDropdown();
      await Promise.resolve();
    });

    const closed = getResult();
    expect(closed.isOpen).toBe(false);
    expect(closed.highlightedIndex).toBe(3);
    expect(closed.searchQuery).toBe('keep');
  });

  it('toggles open state when invoking toggleDropdown', async () => {
    const { getResult } = await renderHook();

    await act(async () => {
      getResult().toggleDropdown();
      await Promise.resolve();
    });
    expect(getResult().isOpen).toBe(true);

    await act(async () => {
      getResult().toggleDropdown();
      await Promise.resolve();
    });
    expect(getResult().isOpen).toBe(false);
  });

  it('manages selections in multi-select mode by adding and removing values', async () => {
    const onChange = vi.fn();
    const { getResult, rerender } = await renderHook([['one'], onChange, true, false]);

    await act(async () => {
      getResult().selectOption('two');
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledWith(['one', 'two']);

    await rerender([['one', 'two'], onChange, true, false]);

    await act(async () => {
      getResult().selectOption('one');
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenLastCalledWith(['two']);
  });

  it('selects a value and closes the dropdown in single-select mode', async () => {
    const onChange = vi.fn();
    const { getResult } = await renderHook(['', onChange, false, false]);

    await act(async () => {
      getResult().openDropdown();
      await Promise.resolve();
    });
    expect(getResult().isOpen).toBe(true);

    await act(async () => {
      getResult().selectOption('chosen');
      await Promise.resolve();
    });

    expect(onChange).toHaveBeenCalledWith('chosen');
    expect(getResult().isOpen).toBe(false);
  });

  it('reports selection status based on configuration', async () => {
    const onChange = vi.fn();
    const { getResult, rerender } = await renderHook(['solo', onChange, false, false]);

    expect(getResult().isSelected('solo')).toBe(true);
    expect(getResult().isSelected('other')).toBe(false);

    await rerender([['first'], onChange, true, false]);
    expect(getResult().isSelected('first')).toBe(true);
    expect(getResult().isSelected('second')).toBe(false);
  });

  it('closes when clicking outside and remains open when interacting inside the dropdown', async () => {
    const { getResult } = await renderHook();
    const outsideRef = {
      contains: vi.fn().mockReturnValue(false),
    } as unknown as HTMLDivElement;

    await act(async () => {
      const current = getResult();
      current.dropdownRef.current = outsideRef;
      current.openDropdown();
      await Promise.resolve();
    });

    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await Promise.resolve();
    });

    expect(getResult().isOpen).toBe(false);
    expect(outsideRef.contains).toHaveBeenCalledTimes(1);

    const insideRef = {
      contains: vi.fn().mockReturnValue(true),
    } as unknown as HTMLDivElement;

    await act(async () => {
      const current = getResult();
      current.dropdownRef.current = insideRef;
      current.openDropdown();
      await Promise.resolve();
    });
    expect(getResult().isOpen).toBe(true);

    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await Promise.resolve();
    });

    expect(getResult().isOpen).toBe(true);
    expect(insideRef.contains).toHaveBeenCalledTimes(1);
  });
});
