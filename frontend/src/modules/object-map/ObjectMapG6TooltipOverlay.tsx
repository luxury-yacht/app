/**
 * frontend/src/modules/object-map/ObjectMapG6TooltipOverlay.tsx
 *
 * SVG overlay renderer for object-map connection tooltips.
 */

import React from 'react';
import type { ObjectMapG6Palette } from './objectMapG6Data';
import type { ObjectMapTooltipEndpoint, ObjectMapTooltipLayout } from './objectMapG6Tooltip';

export interface ObjectMapG6TooltipOverlayProps {
  palette: ObjectMapG6Palette;
  tooltipLayout: ObjectMapTooltipLayout;
  tooltipPosition: { x: number; y: number };
}

const renderTooltipEndpoint = (
  palette: ObjectMapG6Palette,
  endpoint: ObjectMapTooltipEndpoint,
  y: number,
  className: string
) => {
  const badgeX = -endpoint.groupWidth / 2;
  const nameX = badgeX + endpoint.badgeWidth + palette.tooltipBadgeGap;
  const rowCenterY = y - palette.tooltipNameFontSize / 2 + 1;
  const badgeY = rowCenterY - endpoint.badgeHeight / 2;
  return (
    <g className={className}>
      <rect
        x={badgeX}
        y={badgeY}
        width={endpoint.badgeWidth}
        height={endpoint.badgeHeight}
        rx={endpoint.badgeStyle.borderRadius}
        ry={endpoint.badgeStyle.borderRadius}
        fill={endpoint.badgeStyle.backgroundColor}
        stroke={endpoint.badgeStyle.borderColor}
        strokeWidth={endpoint.badgeStyle.borderWidth}
      />
      <text
        x={badgeX + endpoint.badgeWidth / 2}
        y={rowCenterY}
        textAnchor="middle"
        dominantBaseline="central"
        fill={endpoint.badgeStyle.color}
        fontFamily={palette.fontFamily}
        fontSize={endpoint.badgeFontSize}
        fontWeight={endpoint.badgeStyle.fontWeight}
        letterSpacing={endpoint.badgeStyle.letterSpacing}
      >
        {endpoint.badgeText}
      </text>
      <text
        className="object-map__edge-tooltip-name"
        x={nameX}
        y={y}
        textAnchor="start"
        fontStyle={endpoint.filtered ? 'italic' : undefined}
      >
        {endpoint.text}
      </text>
    </g>
  );
};

export const ObjectMapG6TooltipOverlay: React.FC<ObjectMapG6TooltipOverlayProps> = ({
  palette,
  tooltipLayout,
  tooltipPosition,
}) => {
  const tooltipTop = -palette.tooltipOffsetY - tooltipLayout.height - palette.tooltipArrowHeight;

  return (
    <g
      className="object-map__edge-tooltip"
      transform={`translate(${tooltipPosition.x} ${tooltipPosition.y})`}
    >
      <polygon
        className="object-map__edge-tooltip-arrow"
        points={`${-palette.tooltipArrowWidth / 2},${
          -palette.tooltipOffsetY - palette.tooltipArrowHeight
        } 0,${-palette.tooltipOffsetY} ${palette.tooltipArrowWidth / 2},${
          -palette.tooltipOffsetY - palette.tooltipArrowHeight
        }`}
      />
      <rect
        className="object-map__edge-tooltip-bg"
        x={-tooltipLayout.width / 2}
        y={tooltipTop}
        width={tooltipLayout.width}
        height={tooltipLayout.height}
        rx={palette.tooltipRadius}
        ry={palette.tooltipRadius}
      />
      {tooltipLayout.rows.map((row, index) => {
        const y = tooltipTop + tooltipLayout.firstRowOffset + tooltipLayout.rowGap * index;
        if (row.type === 'object') {
          return (
            <React.Fragment key={`object-${index}`}>
              {renderTooltipEndpoint(
                palette,
                row.endpoint,
                y,
                `object-map__edge-tooltip-object-${index}`
              )}
            </React.Fragment>
          );
        }
        return (
          <text
            key={`relationship-${index}`}
            className="object-map__edge-tooltip-relationship"
            x={0}
            y={y}
            textAnchor="middle"
          >
            {row.text}
          </text>
        );
      })}
    </g>
  );
};
