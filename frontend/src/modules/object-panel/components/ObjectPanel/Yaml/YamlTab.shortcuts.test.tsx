import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import YamlTab from './YamlTab';

const shortcutMocks = vi.hoisted(() => ({
  useShortcut: vi.fn(),
}));

vi.mock('@ui/shortcuts', () => ({
  useShortcut: (...args: unknown[]) => shortcutMocks.useShortcut(...args),
  useSearchShortcutTarget: () => undefined,
}));

vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: vi.fn(() => <div data-testid="code-editor" />),
}));

vi.mock('@/core/refresh/store', () => ({
  useRefreshScopedDomain: () => ({
    data: { yaml: 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: demo' },
    status: 'ready',
    error: null,
  }),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: {
    setScopedDomainEnabled: vi.fn(),
    resetScopedDomain: vi.fn(),
    updateContext: vi.fn(),
    fetchScopedDomain: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  ValidateObjectYaml: vi.fn(),
  ApplyObjectYaml: vi.fn(),
  GetObjectYAML: vi.fn().mockResolvedValue({
    yaml: 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: demo',
    resourceVersion: '123',
  }),
}));

describe('YamlTab shortcuts', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(async () => {
    shortcutMocks.useShortcut.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    await act(async () => {
      root.render(<YamlTab scope="team-a:pod:demo" isActive canEdit />);
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const getShortcut = (key: string) => {
    for (let i = shortcutMocks.useShortcut.mock.calls.length - 1; i >= 0; i -= 1) {
      const config = shortcutMocks.useShortcut.mock.calls[i][0] as { key: string };
      if (config.key === key) {
        return shortcutMocks.useShortcut.mock.calls[i][0] as {
          key: string;
          enabled?: boolean;
          modifiers?: { meta?: boolean; ctrl?: boolean };
        };
      }
    }
    return undefined;
  };

  it('registers shortcuts for YAML interactions', () => {
    const managedFieldsShortcut = getShortcut('m');
    expect(managedFieldsShortcut).toBeTruthy();
    expect(managedFieldsShortcut?.enabled).toBe(true);

    const saveMeta = shortcutMocks.useShortcut.mock.calls
      .map(
        ([config]) => config as { key: string; modifiers?: { meta?: boolean }; enabled?: boolean }
      )
      .find((config) => config.key === 's' && config.modifiers?.meta);
    expect(saveMeta).toBeTruthy();
    expect(saveMeta?.enabled).toBe(false); // disabled until editing begins

    const saveCtrl = shortcutMocks.useShortcut.mock.calls
      .map(
        ([config]) => config as { key: string; modifiers?: { ctrl?: boolean }; enabled?: boolean }
      )
      .find((config) => config.key === 's' && config.modifiers?.ctrl);
    expect(saveCtrl).toBeTruthy();
    expect(saveCtrl?.enabled).toBe(false);

    const escapeShortcut = getShortcut('Escape');
    expect(escapeShortcut).toBeTruthy();
    expect(escapeShortcut?.enabled).toBe(false);
  });
});
