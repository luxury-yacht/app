import { expect, it, vi } from 'vitest';

const workspaceImports = vi.hoisted(() => vi.fn());

vi.mock('@ui/favorites/FavMenuDropdown', () => {
  workspaceImports('favorites');
  return { default: () => null };
});
vi.mock('@ui/status/SessionsStatus', () => {
  workspaceImports('sessions');
  return { default: () => null };
});
vi.mock('@ui/layout/AppMenuBar', () => {
  workspaceImports('application-menu');
  return { default: () => null };
});

it('opens the panel renderer without loading workspace-only header features', async () => {
  await import('./PanelWindowApp');

  expect(workspaceImports).not.toHaveBeenCalled();
});
