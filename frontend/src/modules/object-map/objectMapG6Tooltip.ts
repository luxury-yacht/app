/**
 * frontend/src/modules/object-map/objectMapG6Tooltip.ts
 *
 * Computes object-map connection tooltip rows, badge sizing, truncation, and
 * dimensions before the SVG overlay renders them.
 */

import type { ObjectMapReference } from '@core/refresh/types';
import type { KindBadgeVisualStyle } from '@shared/utils/kindBadgeColors';
import { resolveKindBadgeVisualStyle } from '@shared/utils/kindBadgeColors';
import { getDisplayKind } from '@/utils/kindAliasMap';
import type { ObjectMapG6Palette } from './objectMapG6Data';
import type { ObjectMapHoverEdge } from './objectMapRendererTypes';

export const MAX_FILTERED_TOOLTIP_OBJECTS = 5;

const measuredTextCanvas =
  typeof document === 'undefined' ? null : document.createElement('canvas');

const objectMapTooltipFont = (
  weight: number | string,
  size: number,
  family: string,
  style = 'normal'
): string => `${style} ${weight} ${size}px ${family}`;

const objectMapTooltipTextWidth = (text: string, font: string): number => {
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = measuredTextCanvas?.getContext('2d') ?? null;
  } catch {
    context = null;
  }
  if (!context) {
    return text.length;
  }
  context.font = font;
  return context.measureText(text).width;
};

const objectMapTooltipTextWidthWithLetterSpacing = (
  text: string,
  font: string,
  letterSpacing: number
): number => objectMapTooltipTextWidth(text, font) + Math.max(0, text.length - 1) * letterSpacing;

const truncateObjectMapTooltipText = (
  text: string,
  maxWidth: number,
  font: string,
  letterSpacing = 0
): string => {
  if (
    maxWidth <= 0 ||
    objectMapTooltipTextWidthWithLetterSpacing(text, font, letterSpacing) <= maxWidth
  ) {
    return text;
  }
  const ellipsis = '\u2026';
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (
      objectMapTooltipTextWidthWithLetterSpacing(
        `${text.slice(0, mid)}${ellipsis}`,
        font,
        letterSpacing
      ) <= maxWidth
    ) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${text.slice(0, low)}${ellipsis}`;
};

export interface ObjectMapTooltipEndpoint {
  badgeHeight: number;
  badgeStyle: KindBadgeVisualStyle;
  badgeFontSize: number;
  badgeText: string;
  badgeWidth: number;
  filtered: boolean;
  groupWidth: number;
  text: string;
}

export type ObjectMapTooltipRow =
  | { type: 'object'; endpoint: ObjectMapTooltipEndpoint }
  | { type: 'relationship'; edgeType: string; text: string };

export interface ObjectMapTooltipLayout {
  firstRowOffset: number;
  height: number;
  rowGap: number;
  rowOffsets: number[];
  rows: ObjectMapTooltipRow[];
  width: number;
}

export type ObjectMapKindBadgeStyleResolver = (
  kind: string,
  element: HTMLElement | null
) => KindBadgeVisualStyle;

const endpointFromRef = (
  ref: ObjectMapReference,
  filtered: boolean,
  endpoint: (name: string, kind: string, filtered?: boolean) => ObjectMapTooltipEndpoint
) => endpoint(ref.name, ref.kind, filtered);

export const computeObjectMapTooltipLayout = ({
  hoverEdge,
  palette,
  useShortResourceNames,
  container,
  resolveKindBadgeStyle = resolveKindBadgeVisualStyle,
}: {
  hoverEdge: ObjectMapHoverEdge;
  palette: ObjectMapG6Palette;
  useShortResourceNames: boolean;
  container?: HTMLElement | null;
  resolveKindBadgeStyle?: ObjectMapKindBadgeStyleResolver;
}): ObjectMapTooltipLayout => {
  const maxContentWidth = Math.max(
    1,
    palette.tooltipMaxWidth - palette.tooltipHorizontalPadding * 2
  );
  const nameFont = objectMapTooltipFont(
    palette.tooltipNameFontWeight,
    palette.tooltipNameFontSize,
    palette.fontFamily
  );
  const relationshipFont = objectMapTooltipFont(
    palette.tooltipRelationshipFontWeight,
    palette.tooltipRelationshipFontSize,
    palette.fontFamily
  );
  const endpoint = (name: string, kind: string, filtered = false): ObjectMapTooltipEndpoint => {
    const badgeStyle = resolveKindBadgeStyle(kind, container ?? null);
    const rawBadgeText = getDisplayKind(kind, useShortResourceNames).toUpperCase();
    const badgeFontSize = Math.min(badgeStyle.fontSize, palette.tooltipBadgeMaxFontSize);
    const badgeFont = objectMapTooltipFont(
      badgeStyle.fontWeight,
      badgeFontSize,
      palette.fontFamily
    );
    const endpointNameFont = filtered
      ? objectMapTooltipFont(
          palette.tooltipNameFontWeight,
          palette.tooltipNameFontSize,
          palette.fontFamily,
          'italic'
        )
      : nameFont;
    const maxBadgeWidth = Math.min(maxContentWidth, palette.tooltipBadgeMaxWidth);
    const maxBadgeTextWidth = Math.max(
      1,
      maxBadgeWidth - palette.tooltipBadgePaddingX * 2 - badgeStyle.borderWidth * 2
    );
    const badgeText = truncateObjectMapTooltipText(
      rawBadgeText,
      maxBadgeTextWidth,
      badgeFont,
      badgeStyle.letterSpacing
    );
    const badgeWidth = Math.ceil(
      objectMapTooltipTextWidthWithLetterSpacing(badgeText, badgeFont, badgeStyle.letterSpacing) +
        palette.tooltipBadgePaddingX * 2 +
        badgeStyle.borderWidth * 2
    );
    const badgeHeight = Math.ceil(
      badgeFontSize + palette.tooltipBadgePaddingY * 2 + badgeStyle.borderWidth * 2
    );
    const maxNameWidth = Math.max(1, maxContentWidth - badgeWidth - palette.tooltipBadgeGap);
    const text = truncateObjectMapTooltipText(name, maxNameWidth, endpointNameFont);
    const textWidthValue = objectMapTooltipTextWidth(text, endpointNameFont);
    const groupWidth = badgeWidth + palette.tooltipBadgeGap + textWidthValue;
    return {
      badgeHeight,
      badgeStyle,
      badgeText,
      badgeWidth,
      badgeFontSize,
      filtered,
      groupWidth,
      text,
    };
  };

  const relationshipRow = (text: string, edgeType: string): ObjectMapTooltipRow => ({
    type: 'relationship',
    edgeType,
    text: truncateObjectMapTooltipText(text, maxContentWidth, relationshipFont),
  });
  const defaultTop = -palette.tooltipOffsetY - palette.tooltipHeight - palette.tooltipArrowHeight;
  const firstRowOffset = palette.tooltipSourceY - defaultTop;
  const rowGap = Math.max(1, palette.tooltipRelationshipY - palette.tooltipSourceY);
  const defaultBottomPadding = Math.max(0, palette.tooltipHeight - (firstRowOffset + rowGap * 2));

  const rows: ObjectMapTooltipRow[] = [];
  const filteredPath = hoverEdge.filteredPath;
  if (filteredPath) {
    const pathNodes = filteredPath.nodes.slice(0, MAX_FILTERED_TOOLTIP_OBJECTS);
    pathNodes.forEach((node, index) => {
      rows.push({ type: 'object', endpoint: endpointFromRef(node.ref, node.filtered, endpoint) });
      if (index < pathNodes.length - 1) {
        const relationship = filteredPath.relationships[index];
        rows.push(relationshipRow(relationship?.label ?? '', relationship?.type ?? hoverEdge.type));
      }
    });
    const hiddenStepCount = Math.max(0, filteredPath.nodes.length - pathNodes.length);
    if (hiddenStepCount > 0) {
      rows.push(
        relationshipRow(
          `+${hiddenStepCount} hidden step${hiddenStepCount === 1 ? '' : 's'}`,
          hoverEdge.type
        )
      );
    }
    if (filteredPath.additionalPathCount > 0) {
      const count = filteredPath.additionalPathCount;
      rows.push(
        relationshipRow(`+${count} more hidden path${count === 1 ? '' : 's'}`, hoverEdge.type)
      );
    }
  } else {
    rows.push({
      type: 'object',
      endpoint: endpoint(hoverEdge.sourceLabel, hoverEdge.sourceKind),
    });
    rows.push(relationshipRow(hoverEdge.label, hoverEdge.type));
    rows.push({
      type: 'object',
      endpoint: endpoint(hoverEdge.targetLabel, hoverEdge.targetKind),
    });
  }

  const widestRow = rows.reduce((max, row) => {
    if (row.type === 'object') {
      return Math.max(max, row.endpoint.groupWidth);
    }
    return Math.max(max, objectMapTooltipTextWidth(row.text, relationshipFont));
  }, 0);
  const rowOffsets = rows.reduce<number[]>((offsets, _row, index) => {
    const previousOffset = offsets[index - 1] ?? firstRowOffset;
    const offset =
      index === 0
        ? firstRowOffset
        : previousOffset +
          rowGap +
          (rows[index - 1]?.type === 'relationship' ? palette.tooltipRelationshipBottomPadding : 0);
    offsets.push(offset);
    return offsets;
  }, []);
  const lastRowOffset = rowOffsets[rowOffsets.length - 1] ?? firstRowOffset;
  const width = Math.ceil(widestRow) + palette.tooltipHorizontalPadding * 2;
  const height = Math.max(palette.tooltipHeight, lastRowOffset + defaultBottomPadding);

  return {
    firstRowOffset,
    height,
    rowGap,
    rowOffsets,
    rows,
    width,
  };
};
