/**
 * frontend/src/modules/object-map/ObjectMapG6TooltipOverlay.test.tsx
 *
 * Tests SVG rendering for object-map connection tooltip overlays.
 */

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { KindBadgeVisualStyle } from '@shared/utils/kindBadgeColors';
import type { ObjectMapG6Palette } from './objectMapG6Data';
import { ObjectMapG6TooltipOverlay } from './ObjectMapG6TooltipOverlay';
import type { ObjectMapTooltipLayout } from './objectMapG6Tooltip';

const palette: ObjectMapG6Palette = {
  accent: '#60a5fa',
  accentBg: '#1d4ed8',
  background: '#111827',
  backgroundSecondary: '#1f2937',
  border: '#374151',
  text: '#f9fafb',
  textSecondary: '#d1d5db',
  textTertiary: '#9ca3af',
  textInverse: '#111827',
  statusHealthy: '#22c55e',
  statusRefreshing: '#16a34a',
  statusDegraded: '#f59e0b',
  statusUnhealthy: '#ef4444',
  statusInactive: '#94a3b8',
  edgeOwner: '#2dd4bf',
  edgeRoutes: '#60a5fa',
  edgeSelector: '#a78bfa',
  edgeEndpoint: '#34d399',
  edgeVolumeBinding: '#f59e0b',
  edgeStorageClass: '#fbbf24',
  edgeMounts: '#a78bfa',
  edgeSchedules: '#f472b6',
  edgeScales: '#22d3ee',
  edgeGrants: '#f97316',
  edgeBinds: '#fb7185',
  edgeAggregates: '#c084fc',
  edgeFilteredPath: '#ef4444',
  edgeUses: '#94a3b8',
  edgeDefault: '#6b7280',
  edgeLineWidth: 1,
  edgeHighlightedLineWidth: 2,
  edgeHoveredLineWidth: 3,
  edgeDimmedOpacity: 0.25,
  edgeDash: [4, 4],
  nodeConnectedLineWidth: 1,
  nodeSelectedLineWidth: 1,
  nodeEdgeHoveredLineWidth: 2,
  nodeDimmedBackgroundOpacity: 0.25,
  nodeDimmedForegroundOpacity: 0.45,
  tooltipMaxWidth: 240,
  tooltipHeight: 70,
  tooltipOffsetY: 10,
  tooltipArrowWidth: 12,
  tooltipArrowHeight: 6,
  tooltipRadius: 4,
  tooltipSourceY: 10,
  tooltipRelationshipY: 28,
  tooltipTargetY: 46,
  tooltipRelationshipBottomPadding: 2,
  tooltipHorizontalPadding: 10,
  tooltipBadgeGap: 6,
  tooltipBadgeMaxWidth: 86,
  tooltipBadgeMaxFontSize: 11,
  tooltipBadgePaddingX: 4,
  tooltipBadgePaddingY: 2,
  tooltipNameFontSize: 12,
  tooltipNameFontWeight: 600,
  tooltipRelationshipFontSize: 11,
  tooltipRelationshipFontWeight: 500,
  fitViewPadding: 30,
  fullOpacity: 1,
  fontFamily: 'Inter',
};

const badgeStyle: KindBadgeVisualStyle = {
  backgroundColor: '#334155',
  borderColor: '#64748b',
  color: '#bfdbfe',
  borderWidth: 1,
  borderRadius: 3,
  className: 'kind-badge hash-color-1',
  fontSize: 11,
  fontWeight: '700',
  letterSpacing: 0,
  paddingX: 4,
  paddingY: 2,
};

const tooltipLayout: ObjectMapTooltipLayout = {
  firstRowOffset: 16,
  height: 70,
  rowGap: 18,
  rowOffsets: [16, 34, 54],
  width: 180,
  rows: [
    {
      type: 'object',
      endpoint: {
        badgeHeight: 17,
        badgeStyle,
        badgeFontSize: 11,
        badgeText: 'SERVICE',
        badgeWidth: 52,
        filtered: false,
        groupWidth: 120,
        text: 'frontend',
      },
    },
    { type: 'relationship', edgeType: 'endpoint', text: 'has endpoints' },
    {
      type: 'object',
      endpoint: {
        badgeHeight: 17,
        badgeStyle,
        badgeFontSize: 11,
        badgeText: 'POD',
        badgeWidth: 26,
        filtered: true,
        groupWidth: 100,
        text: 'frontend-a',
      },
    },
  ],
};

describe('ObjectMapG6TooltipOverlay', () => {
  it('renders tooltip background, arrow, relationship text, and kind badges', () => {
    const html = renderToStaticMarkup(
      <svg>
        <ObjectMapG6TooltipOverlay
          palette={palette}
          tooltipLayout={tooltipLayout}
          tooltipPosition={{ x: 100, y: 120 }}
        />
      </svg>
    );

    expect(html).toContain('class="object-map__edge-tooltip"');
    expect(html).toContain('transform="translate(100 120)"');
    expect(html).toContain('class="object-map__edge-tooltip-arrow"');
    expect(html).toContain('class="object-map__edge-tooltip-bg"');
    expect(html).toContain('SERVICE');
    expect(html).toContain('has endpoints');
    expect(html).toContain('fill="#34d399"');
    expect(html).toContain('frontend-a');
    expect(html).toContain('font-style="italic"');
  });
});
