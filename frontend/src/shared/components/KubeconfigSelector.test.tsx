/**
 * frontend/src/shared/components/KubeconfigSelector.test.tsx
 *
 * Test suite for KubeconfigSelector.
 * Covers key behaviors and edge cases for KubeconfigSelector.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { KeyboardProvider } from '@ui/shortcuts';
vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
}));
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseKubeconfig = vi.fn();

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: (...args: unknown[]) => mockUseKubeconfig(...(args as [])),
}));

const { dropdownRenderOption, dropdownPropsRef } = vi.hoisted(() => ({
  dropdownRenderOption: vi.fn(),
  dropdownPropsRef: { current: null as null | any },
}));

vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: (props: any) => {
    dropdownPropsRef.current = props;
    dropdownRenderOption.mockImplementation(props.renderOption);
    return (
      <div data-testid="dropdown" data-value={props.value} data-loading={props.loading}>
        {props.options.map((option: any) => (
          <div key={option.value} className="option">
            {props.renderOption(option)}
          </div>
        ))}
      </div>
    );
  },
}));

import KubeconfigSelector from './KubeconfigSelector';

describe('KubeconfigSelector', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    dropdownRenderOption.mockReset();
    mockUseKubeconfig.mockReset();
    dropdownPropsRef.current = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderSelector = async (
    override: Partial<ReturnType<typeof createKubeconfigState>> = {}
  ) => {
    const state = { ...createKubeconfigState(), ...override };
    mockUseKubeconfig.mockReturnValue(state);
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <KubeconfigSelector />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
    return state;
  };

  const createKubeconfigState = () => ({
    kubeconfigs: [
      {
        name: 'prod.yaml',
        path: '/clusters/prod.yaml',
        context: 'prod-admin',
        isCurrentContext: true,
      },
      {
        name: 'prod.yaml',
        path: '/clusters/prod.yaml',
        context: 'prod-readonly',
        isCurrentContext: false,
      },
      {
        name: 'staging.yaml',
        path: '/clusters/staging.yaml',
        context: 'staging',
        isCurrentContext: false,
      },
    ],
    selectedKubeconfigs: ['/clusters/prod.yaml:prod-admin'],
    selectedKubeconfig: '/clusters/prod.yaml:prod-admin',
    kubeconfigsLoading: false,
    setSelectedKubeconfigs: vi.fn(),
    setSelectedKubeconfig: vi.fn(),
  });

  it('renders each kubeconfig option with filename only for the first occurrence', async () => {
    await renderSelector();

    const options = Array.from(container.querySelectorAll('.kubeconfig-option'));
    expect(options).toHaveLength(3);
    expect(options[0].querySelector('.kubeconfig-filename')?.textContent).toBe('prod.yaml');
    expect(options[1].classList.contains('no-filename')).toBe(true);
    expect(options[1].querySelector('.kubeconfig-filename')).toBeNull();
    expect(options[2].querySelector('.kubeconfig-filename')?.textContent).toBe('staging.yaml');
  });

  it('invokes setSelectedKubeconfigs when selection changes', async () => {
    const state = await renderSelector();

    const dropdownProps = dropdownPropsRef.current;
    expect(dropdownProps).toBeTruthy();

    const newValue = ['/clusters/staging.yaml:staging'];
    act(() => {
      dropdownProps.onChange(newValue);
    });

    expect(state.setSelectedKubeconfigs).toHaveBeenCalledWith(newValue);
  });

  it('allows same context name from different kubeconfig files', async () => {
    await renderSelector({
      kubeconfigs: [
        {
          name: 'alpha.yaml',
          path: '/clusters/alpha.yaml',
          context: 'shared',
          isCurrentContext: false,
        },
        {
          name: 'beta.yaml',
          path: '/clusters/beta.yaml',
          context: 'shared',
          isCurrentContext: false,
        },
      ],
      selectedKubeconfigs: ['/clusters/alpha.yaml:shared'],
      selectedKubeconfig: '/clusters/alpha.yaml:shared',
    });

    const options = dropdownPropsRef.current?.options || [];
    const alphaOption = options.find(
      (option: any) => option.value === '/clusters/alpha.yaml:shared'
    );
    const betaOption = options.find((option: any) => option.value === '/clusters/beta.yaml:shared');

    // Both should be enabled - same context name from different files is allowed
    expect(alphaOption?.disabled).toBeFalsy();
    expect(betaOption?.disabled).toBeFalsy();
  });
});
