import { describe, expect, it } from 'vitest';
import {
  applicationMenuAccelerators,
  buildApplicationMenuSections,
} from './applicationMenuCommands';

describe('application menu command catalog', () => {
  it('owns the complete Windows and Linux accelerator set without key collisions', () => {
    const accelerators = applicationMenuAccelerators(true);
    const keys = accelerators.map(
      ({ key, modifiers }) =>
        `${modifiers.ctrl ? 'ctrl+' : ''}${modifiers.shift ? 'shift+' : ''}${key.toLowerCase()}`
    );

    expect(keys).toEqual([
      'ctrl+n',
      'ctrl+o',
      'ctrl+w',
      'ctrl+,',
      'ctrl+q',
      'ctrl+shift+p',
      'ctrl+=',
      'ctrl+-',
      'ctrl+0',
      'ctrl+b',
      'ctrl+d',
      'ctrl+shift+l',
      'ctrl+shift+d',
      'ctrl+m',
      'ctrl+shift+f12',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('uses the same catalog for menu labels while leaving native edit keys to the webview', () => {
    const edit = buildApplicationMenuSections(true, false).find(({ id }) => id === 'edit');

    expect(
      edit?.items.flatMap((entry) =>
        'command' in entry
          ? [
              {
                label: entry.label,
                frontendDispatch: entry.accelerator?.dispatchFromFrontend !== false,
              },
            ]
          : []
      )
    ).toEqual([
      { label: 'Cut', frontendDispatch: false },
      { label: 'Copy', frontendDispatch: false },
      { label: 'Paste', frontendDispatch: false },
      { label: 'Select All', frontendDispatch: false },
    ]);
  });
});
