import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../RefreshManager', () => {
  const pause = vi.fn();
  const resume = vi.fn();
  return {
    refreshManager: {
      pause,
      resume,
    },
  };
});

import { RefreshManagerProvider, useRefreshManagerContext } from './RefreshManagerContext';
import { refreshManager } from '../RefreshManager';

describe('RefreshManagerContext', () => {
  let originalHiddenDescriptor: PropertyDescriptor | undefined;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    originalHiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
  });

  afterEach(async () => {
    if (originalHiddenDescriptor) {
      Object.defineProperty(document, 'hidden', originalHiddenDescriptor);
    } else {
      delete (document as any).hidden;
    }

    await act(async () => {});
  });

  it('throws when useRefreshManagerContext is used outside the provider', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    const OutsideConsumer = () => {
      useRefreshManagerContext();
      return null;
    };

    let capturedError: unknown;
    try {
      await act(async () => {
        root.render(<OutsideConsumer />);
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(Error);
    expect((capturedError as Error).message).toContain(
      'useRefreshManagerContext must be used within RefreshManagerProvider'
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('provides the refresh manager instance to descendants', async () => {
    const managerListener = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    const Consumer: React.FC = () => {
      const { manager } = useRefreshManagerContext();
      useEffect(() => {
        managerListener(manager);
      }, [manager]);
      return null;
    };

    await act(async () => {
      root.render(
        <RefreshManagerProvider>
          <Consumer />
        </RefreshManagerProvider>
      );
    });

    expect(managerListener).toHaveBeenCalledTimes(1);
    expect(managerListener).toHaveBeenCalledWith(refreshManager);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('pauses and resumes the refresh manager on visibility changes', async () => {
    const mockManager = refreshManager as unknown as { pause: Mock; resume: Mock };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    const setDocumentHidden = (value: boolean) => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => value,
      });
    };

    await act(async () => {
      root.render(
        <RefreshManagerProvider>
          <div />
        </RefreshManagerProvider>
      );
    });

    setDocumentHidden(true);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mockManager.pause).toHaveBeenCalledTimes(1);
    expect(mockManager.resume).not.toHaveBeenCalled();

    setDocumentHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mockManager.resume).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
