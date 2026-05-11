/**
 * frontend/src/shared/components/icons/SharedIcons.test.tsx
 *
 * Test suite for shared icon components.
 */

import ReactDOMServer from 'react-dom/server';
import { describe, it, expect } from 'vitest';

import {
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
  ClusterOverviewIcon,
  ClusterResourcesIcon,
  CategoryIcon,
} from './SharedIcons';
import {
  DockRightIcon,
  DockBottomIcon,
  FloatPanelIcon,
  MaximizePanelIcon,
  RestorePanelIcon,
} from './DockableIcons';

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
});
