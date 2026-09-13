/**
 * frontend/src/shared/components/icons/SharedIcons.test.tsx
 *
 * Test suite for shared icon components.
 */

import type { ComponentType } from 'react';
import * as ReactDOMServer from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as DockableIcons from './DockableIcons';
import * as DropdownIcons from './DropdownIcons';
import * as FavoriteIcons from './FavoriteIcons';
import * as LogIcons from './LogIcons';
import * as ObjectMapIcons from './ObjectMapIcons';
import * as SettingsIcons from './SettingsIcons';
import * as SharedIcons from './SharedIcons';
import * as YamlIcons from './YamlIcons';

const ALL_EXPORTED_ICONS = [
  DockableIcons,
  DropdownIcons,
  FavoriteIcons,
  LogIcons,
  ObjectMapIcons,
  SettingsIcons,
  SharedIcons,
  YamlIcons,
].flatMap((module) => Object.values(module)) as unknown as ComponentType[];

describe('SharedIcons', () => {
  it('makes every shared icon decorative and unfocusable by default', () => {
    ALL_EXPORTED_ICONS.forEach((Icon) => {
      const markup = ReactDOMServer.renderToStaticMarkup(<Icon />);
      const container = document.createElement('div');
      container.innerHTML = markup;
      const svg = container.querySelector('svg');

      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('focusable')).toBe('false');
    });
  });
});
