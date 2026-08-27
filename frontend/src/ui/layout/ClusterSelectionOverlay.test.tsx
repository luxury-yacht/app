import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ClusterSelectionOverlay } from './ClusterSelectionOverlay';

it('covers ClusterSelectionOverlay scenarios', async () => {
  {
    // Scenario: explains when no configured kubeconfig search paths exist
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    const onOpenKubeconfigSettings = vi.fn();

    act(() => {
      root.render(
        <ClusterSelectionOverlay
          phase="empty"
          discoveryState="search_paths_missing"
          searchPaths={['/Users/john/.kube', '/etc/kubernetes']}
          onOpenKubeconfigSettings={onOpenKubeconfigSettings}
        />
      );
    });

    const overlay = container.querySelector('.no-active-clusters-overlay');
    expect(overlay?.getAttribute('role')).toBeNull();
    expect(overlay?.getAttribute('aria-live')).toBe('polite');
    expect(overlay?.getAttribute('aria-atomic')).toBe('true');
    expect(container.querySelector('strong')?.textContent).toBe(
      '⚠️ None of the kubeconfig search paths exist.'
    );
    expect(container.textContent).toContain('/Users/john/.kube');
    expect(container.textContent).toContain('/etc/kubernetes');
    expect(container.textContent).toContain(
      'Go to Settings -> Kubeconfigs to modify the list of search paths.'
    );

    const settingsLink = container.querySelector<HTMLButtonElement>(
      '.no-active-clusters-settings-link'
    );
    expect(settingsLink?.textContent).toBe('Settings -> Kubeconfigs');
    act(() => settingsLink?.click());
    expect(onOpenKubeconfigSettings).toHaveBeenCalledOnce();

    act(() => root.unmount());
    container.remove();
  }

  {
    // Scenario: explains when configured search paths contain no kubeconfigs
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);
    const onOpenKubeconfigSettings = vi.fn();

    act(() => {
      root.render(
        <ClusterSelectionOverlay
          phase="empty"
          discoveryState="no_kubeconfigs"
          searchPaths={['/Users/john/.kube', '/etc/kubernetes']}
          onOpenKubeconfigSettings={onOpenKubeconfigSettings}
        />
      );
    });

    expect(container.textContent).toContain(
      '⚠️ No kubeconfig files were found in the configured search paths.'
    );
    expect(container.querySelector('strong')?.textContent).toBe(
      '⚠️ No kubeconfig files were found in the configured search paths.'
    );
    expect(container.textContent).toContain('/Users/john/.kube');
    expect(container.textContent).toContain('/etc/kubernetes');
    expect(container.textContent).toContain(
      'Go to Settings -> Kubeconfigs to modify the list of search paths.'
    );

    const settingsLink = container.querySelector<HTMLButtonElement>(
      '.no-active-clusters-settings-link'
    );
    expect(settingsLink?.textContent).toBe('Settings -> Kubeconfigs');
    act(() => settingsLink?.click());
    expect(onOpenKubeconfigSettings).toHaveBeenCalledOnce();

    act(() => root.unmount());
    container.remove();
  }
});
