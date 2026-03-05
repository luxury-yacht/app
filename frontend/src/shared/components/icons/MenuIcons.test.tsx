/**
 * frontend/src/shared/components/icons/MenuIcons.test.tsx
 *
 * Test suite for MenuIcons.
 * Covers key behaviors and edge cases for MenuIcons.
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
  DockRightIcon,
  DockBottomIcon,
  FloatPanelIcon,
  MaximizePanelIcon,
  RestorePanelIcon,
  ClusterOverviewIcon,
  ClusterResourcesIcon,
  CategoryIcon,
  AddIcon,
  MinusIcon,
} from './MenuIcons';

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

describe('MenuIcons', () => {
  it('renders each icon with default attributes', () => {
    ALL_ICONS.forEach((Icon) => {
      const markup = ReactDOMServer.renderToStaticMarkup(<Icon />);
      const container = document.createElement('div');
      container.innerHTML = markup;
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute('width')).toBe('16');
      expect(svg?.getAttribute('height')).toBe('16');
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

  it('renders AddIcon with stroke paths and custom dimensions', () => {
    const markup = ReactDOMServer.renderToStaticMarkup(<AddIcon width={12} height={12} />);
    const container = document.createElement('div');
    container.innerHTML = markup;
    const svg = container.querySelector('svg');
    const path = container.querySelector('path');
    expect(svg?.getAttribute('width')).toBe('12');
    expect(svg?.getAttribute('height')).toBe('12');
    expect(path).toBeTruthy();
  });

  it('renders MinusIcon with stroke paths and custom dimensions', () => {
    const markup = ReactDOMServer.renderToStaticMarkup(<MinusIcon width={12} height={12} />);
    const container = document.createElement('div');
    container.innerHTML = markup;
    const svg = container.querySelector('svg');
    const path = container.querySelector('path');
    expect(svg?.getAttribute('width')).toBe('12');
    expect(svg?.getAttribute('height')).toBe('12');
    expect(path).toBeTruthy();
  });
});
