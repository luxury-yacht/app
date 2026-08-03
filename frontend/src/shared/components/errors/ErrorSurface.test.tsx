import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const errorHandlerMocks = vi.hoisted(() => ({
  describe: vi.fn(),
  handleInline: vi.fn(),
}));

vi.mock('@utils/errorHandler', () => ({ errorHandler: errorHandlerMocks }));

import { ErrorSurface } from './ErrorSurface';

describe('ErrorSurface', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    errorHandlerMocks.describe.mockReset();
    errorHandlerMocks.handleInline.mockReset();
    errorHandlerMocks.describe.mockReturnValue({ message: 'Readable failure' });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('reports the original operational error once when its message is presented', async () => {
    const error = new TypeError('typed failure');
    const context = { action: 'saveFavorite' };

    await act(async () => {
      root.render(<ErrorSurface kind="operational" error={error} context={context} />);
    });
    await act(async () => {
      root.render(<ErrorSurface kind="operational" error={error} context={context} />);
    });

    expect(container.textContent).toBe('Readable failure');
    expect(errorHandlerMocks.describe).toHaveBeenCalledWith(error, context, undefined);
    expect(errorHandlerMocks.handleInline).toHaveBeenCalledOnce();
    expect(errorHandlerMocks.handleInline).toHaveBeenCalledWith(error, context, undefined);
  });

  it('renders explicitly expected messages without reporting an exception', async () => {
    await act(async () => {
      root.render(<ErrorSurface kind="validation" message="Enter a valid port" />);
    });

    expect(container.textContent).toBe('Enter a valid port');
    expect(errorHandlerMocks.describe).not.toHaveBeenCalled();
    expect(errorHandlerMocks.handleInline).not.toHaveBeenCalled();
  });
});
