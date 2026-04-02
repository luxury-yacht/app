/**
 * Storybook decorator that wraps stories in all providers needed by layout
 * components (Sidebar, AppHeader, etc.). Mirrors the provider tree from App.tsx.
 *
 * Go backend overrides are installed once in preview.ts — not here.
 *
 * Uses a unique key on the provider tree root to force a full remount (and
 * fresh React state) each time Storybook renders a new story. This works
 * around the refreshOrchestrator singleton accumulating dirty state across
 * story navigations within the shared iframe.
 */

import type { Decorator } from '@storybook/react';
import { ErrorProvider } from '@core/contexts/ErrorContext';
import { ZoomProvider } from '@core/contexts/ZoomContext';
import { KeyboardProvider } from '@ui/shortcuts';
import { ConnectionStatusProvider } from '@/core/connection/connectionStatus';
import { AuthErrorProvider } from '@core/contexts/AuthErrorContext';
import { KubernetesProvider } from '@core/contexts/KubernetesProvider';
import { DockablePanelProvider } from '@ui/dockable';

let mountCounter = 0;

export const SidebarProvidersDecorator: Decorator = (Story) => {
  // Increment on each decorator call (i.e. each story navigation).
  // Using this as the React key forces the entire provider tree to
  // unmount and remount, giving singletons a clean starting state.
  const key = ++mountCounter;

  return (
    <ErrorProvider key={key}>
      <ZoomProvider>
        <KeyboardProvider>
          <ConnectionStatusProvider>
            <AuthErrorProvider>
              <KubernetesProvider>
                <DockablePanelProvider>
                  <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
                    <Story />
                  </div>
                </DockablePanelProvider>
              </KubernetesProvider>
            </AuthErrorProvider>
          </ConnectionStatusProvider>
        </KeyboardProvider>
      </ZoomProvider>
    </ErrorProvider>
  );
};
