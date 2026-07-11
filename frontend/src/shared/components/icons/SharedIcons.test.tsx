/**
 * frontend/src/shared/components/icons/SharedIcons.test.tsx
 *
 * Test suite for shared icon components.
 */

import type { ComponentType } from 'react';
import * as ReactDOMServer from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as DockableIcons from './DockableIcons';
import {
  DockBottomIcon,
  DockRightIcon,
  FloatPanelIcon,
  MaximizePanelIcon,
  RestorePanelIcon,
} from './DockableIcons';
import * as DropdownIcons from './DropdownIcons';
import * as FavoriteIcons from './FavoriteIcons';
import * as LogIcons from './LogIcons';
import * as ObjectMapIcons from './ObjectMapIcons';
import * as SettingsIcons from './SettingsIcons';
import * as SharedIcons from './SharedIcons';
import {
  CategoryIcon,
  ClusterOverviewIcon,
  ClusterResourcesIcon,
  CollapseAllIcon,
  CollapseIcon,
  CollapseSidebarIcon,
  CordonIcon,
  DeleteIcon,
  DrainIcon,
  ExpandAllIcon,
  ExpandIcon,
  ExpandSidebarIcon,
  ForceDeleteIcon,
  NamespaceIcon,
  NamespaceOpenIcon,
  RestartIcon,
  ScaleIcon,
  SettingsIcon,
  SortAscIcon,
  SortDescIcon,
} from './SharedIcons';
import * as YamlIcons from './YamlIcons';

const ALL_ICONS = [
  CordonIcon,
  DrainIcon,
  DeleteIcon,
  ScaleIcon,
  ForceDeleteIcon,
  ExpandIcon,
  CollapseIcon,
  ExpandAllIcon,
  CollapseAllIcon,
  SortAscIcon,
  SortDescIcon,
  RestartIcon,
  NamespaceIcon,
  NamespaceOpenIcon,
  SettingsIcon,
  CollapseSidebarIcon,
  ExpandSidebarIcon,
  DockRightIcon,
  DockBottomIcon,
  FloatPanelIcon,
  MaximizePanelIcon,
  RestorePanelIcon,
  ClusterOverviewIcon,
  ClusterResourcesIcon,
  CategoryIcon,
];

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
  it('renders each icon with default attributes', () => {
    ALL_ICONS.forEach((Icon) => {
      const markup = ReactDOMServer.renderToStaticMarkup(<Icon />);
      const container = document.createElement('div');
      container.innerHTML = markup;
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute('width')).toBe('24');
      expect(svg?.getAttribute('height')).toBe('24');
      expect(svg?.getAttribute('fill')).toBe('currentColor');
    });
  });

  it('applies custom dimensions and fill colour', () => {
    const markup = ReactDOMServer.renderToStaticMarkup(
      <ScaleIcon width={24} height={18} fill="#ff0000" />
    );
    const container = document.createElement('div');
    container.innerHTML = markup;
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('24');
    expect(svg?.getAttribute('height')).toBe('18');
    expect(svg?.getAttribute('fill')).toBe('#ff0000');
  });

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
