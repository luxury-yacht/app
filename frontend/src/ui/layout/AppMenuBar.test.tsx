import { backend } from '@core/backend-api/models';
import { KeyboardProvider } from '@ui/shortcuts';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationMenuShortcuts } from '@/ui/shortcuts/components/ApplicationMenuShortcuts';
import AppMenuBar from './AppMenuBar';

const backendMock = vi.hoisted(() => ({
  executeApplicationMenuCommand: vi.fn((_command: unknown) => Promise.resolve()),
}));

const platformMock = vi.hoisted(() => ({
  isMacPlatform: vi.fn(() => false),
  isWindowsPlatform: vi.fn(() => true),
}));

const errorMock = vi.hoisted(() => ({
  reportOperationalError: vi.fn(),
}));

vi.mock('@/core/backend-api', () => ({
  ExecuteApplicationMenuCommand: backendMock.executeApplicationMenuCommand,
}));

vi.mock('@/utils/platform', () => ({
  isMacPlatform: platformMock.isMacPlatform,
  isWindowsPlatform: platformMock.isWindowsPlatform,
  usesCustomWindowFrame: () => !platformMock.isMacPlatform(),
}));

vi.mock('@/utils/errorHandler', () => ({
  reportOperationalError: errorMock.reportOperationalError,
}));

describe('AppMenuBar', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    backendMock.executeApplicationMenuCommand.mockClear();
    backendMock.executeApplicationMenuCommand.mockResolvedValue(undefined);
    errorMock.reportOperationalError.mockClear();
    platformMock.isWindowsPlatform.mockReturnValue(true);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderMenu = () => {
    act(() => {
      root.render(
        <KeyboardProvider>
          <ApplicationMenuShortcuts />
          <AppMenuBar />
        </KeyboardProvider>
      );
    });
  };

  it('renders the desktop menu vocabulary in titlebar order', () => {
    renderMenu();

    const labels = Array.from(
      container.querySelectorAll('[role="menubar"] [aria-haspopup="menu"]')
    ).map((element) => element.textContent);

    expect(labels).toEqual([
      'File',
      'Edit',
      'View',
      'Window',
      ...(import.meta.env.DEV ? ['Debug'] : []),
      'Help',
    ]);
  });

  it('routes app-rendered items through the typed workspace dispatcher', async () => {
    renderMenu();

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="File menu"]')?.click());
    expect(container.querySelector('[role="menu"]')?.textContent).toContain('New Window');
    expect(container.querySelector('[role="menu"]')?.textContent).toContain('Exit');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-menu-command="new-window"]')?.click();
      await Promise.resolve();
    });

    expect(backendMock.executeApplicationMenuCommand).toHaveBeenCalledWith(
      backend.ApplicationMenuCommand.ApplicationMenuCommandNewWindow
    );
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('highlights the open title without preselecting pointer-opened menu items', () => {
    renderMenu();

    const fileButton = container.querySelector<HTMLButtonElement>('[aria-label="File menu"]');
    const editButton = container.querySelector<HTMLButtonElement>('[aria-label="Edit menu"]');
    act(() => fileButton?.click());

    expect(fileButton?.classList.contains('app-menu-trigger--open')).toBe(true);
    expect(editButton?.classList.contains('app-menu-trigger--open')).toBe(false);
    expect(
      container.querySelector('[role="menu"]')?.getAttribute('aria-activedescendant')
    ).toBeNull();
    expect(container.querySelector('.app-menu-item--focused')).toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-menu-command="new-window"]')
        ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(container.querySelector('.app-menu-item--focused')).toBeNull();
  });

  it('uses Quit on Linux and keeps keyboard activation inside the menu surface', async () => {
    platformMock.isWindowsPlatform.mockReturnValue(false);
    renderMenu();

    const fileButton = container.querySelector<HTMLButtonElement>('[aria-label="File menu"]');
    act(() => {
      fileButton?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

    expect(container.querySelector('[role="menu"]')?.textContent).toContain('Quit');

    await act(async () => {
      container
        .querySelector<HTMLElement>('[role="menu"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });

    expect(backendMock.executeApplicationMenuCommand).toHaveBeenCalledWith(
      backend.ApplicationMenuCommand.ApplicationMenuCommandNewWindow
    );
  });

  it('closes an open menu with Escape and restores its trigger', () => {
    renderMenu();

    const editButton = container.querySelector<HTMLButtonElement>('[aria-label="Edit menu"]');
    act(() => editButton?.click());
    act(() => {
      container
        .querySelector<HTMLElement>('[role="menu"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(editButton);
  });

  it('skips separators and switches open sections with arrows and hover', () => {
    renderMenu();

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="File menu"]')?.click());
    const sendKey = (key: string) => {
      act(() => {
        container
          .querySelector<HTMLElement>('[role="menu"]')
          ?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    };

    expect(
      container.querySelector('[role="menu"]')?.getAttribute('aria-activedescendant')
    ).toBeNull();
    sendKey('ArrowDown');
    expect(container.querySelector('[role="menu"]')?.getAttribute('aria-activedescendant')).toBe(
      'app-menu-file-item-0'
    );
    sendKey('ArrowDown');
    expect(container.querySelector('[role="menu"]')?.getAttribute('aria-activedescendant')).toBe(
      'app-menu-file-item-2'
    );
    sendKey('ArrowUp');
    expect(container.querySelector('[role="menu"]')?.getAttribute('aria-activedescendant')).toBe(
      'app-menu-file-item-0'
    );
    sendKey('ArrowLeft');
    expect(container.querySelector('[role="menu"]')?.id).toBe('app-menu-help');
    sendKey('ArrowRight');
    expect(container.querySelector('[role="menu"]')?.id).toBe('app-menu-file');

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="View menu"]')
        ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(container.querySelector('[role="menu"]')?.id).toBe('app-menu-view');
  });

  it('closes on a second trigger click and on an outside pointer press', () => {
    renderMenu();

    const fileButton = container.querySelector<HTMLButtonElement>('[aria-label="File menu"]');
    act(() => fileButton?.click());
    act(() => fileButton?.click());
    expect(container.querySelector('[role="menu"]')).toBeNull();

    act(() => fileButton?.click());
    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('restores content focus before dispatch and reports command failures', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    backendMock.executeApplicationMenuCommand.mockRejectedValueOnce(new Error('route failed'));
    renderMenu();

    const editButton = container.querySelector<HTMLButtonElement>('[aria-label="Edit menu"]');
    act(() => {
      editButton?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      editButton?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-menu-command="copy"]')?.click();
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(input);
    expect(errorMock.reportOperationalError).toHaveBeenCalledWith(expect.any(Error), {
      source: 'ApplicationMenuCommands',
      action: 'execute:copy',
    });
    input.remove();
  });

  it('dismisses the open menu and restores content focus before an accelerator dispatches', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    renderMenu();

    const fileButton = container.querySelector<HTMLButtonElement>('[aria-label="File menu"]');
    act(() => {
      fileButton?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      fileButton?.click();
    });
    await act(async () => {
      container.querySelector<HTMLElement>('[role="menu"]')?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'n',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(backendMock.executeApplicationMenuCommand).toHaveBeenCalledWith(
      backend.ApplicationMenuCommand.ApplicationMenuCommandNewWindow
    );
    input.remove();
  });
});
