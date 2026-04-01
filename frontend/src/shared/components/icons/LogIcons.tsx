/**
 * frontend/src/shared/components/icons/LogIcons.tsx
 *
 * SVG icons for log viewer toggle buttons.
 */

import React from 'react';

interface IconProps {
  width?: number;
  height?: number;
  fill?: string;
}

/** Scroll document — auto-scroll */
export const AutoScrollIcon: React.FC<IconProps> = ({
  width = 20,
  height = 20,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 256 256"
    width={width}
    height={height}
    fill={fill}
  >
    <path
      d="M200 176h-96s8 6 8 16a24 24 0 0 1-48 0V64a24 24 0 0 0-24-24h136a24 24 0 0 1 24 24Z"
      opacity="0.2"
    />
    <path d="M96 104a8 8 0 0 1 8-8h64a8 8 0 0 1 0 16h-64a8 8 0 0 1-8-8m8 40h64a8 8 0 0 0 0-16h-64a8 8 0 0 0 0 16m128 48a32 32 0 0 1-32 32H88a32 32 0 0 1-32-32V64a16 16 0 0 0-32 0c0 5.74 4.83 9.62 4.88 9.66A8 8 0 0 1 24 88a7.9 7.9 0 0 1-4.79-1.61C18.05 85.54 8 77.61 8 64a32 32 0 0 1 32-32h136a32 32 0 0 1 32 32v104h8a8 8 0 0 1 4.8 1.6c1.2.86 11.2 8.79 11.2 22.4M96.26 173.48A8.07 8.07 0 0 1 104 168h88V64a16 16 0 0 0-16-16H67.69A31.7 31.7 0 0 1 72 64v128a16 16 0 0 0 32 0c0-5.74-4.83-9.62-4.88-9.66a7.82 7.82 0 0 1-2.86-8.86M216 192a12.58 12.58 0 0 0-3.23-8h-94a27 27 0 0 1 1.21 8a31.8 31.8 0 0 1-4.29 16H200a16 16 0 0 0 16-16" />
  </svg>
);

/** Circular arrows — auto-refresh (stroke-based icon) */
export const AutoRefreshIcon: React.FC<IconProps> = ({
  width = 16,
  height = 16,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={width}
    height={height}
    fill="none"
    stroke={fill}
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
  >
    <path d="M3 12a9 9 0 0 1 9-9a9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5m5 4a9 9 0 0 1-9 9a9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </svg>
);

/** Skip-back / rewind — previous logs */
export const PreviousLogsIcon: React.FC<IconProps> = ({
  width = 16,
  height = 16,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 32 32"
    width={width}
    height={height}
    fill={fill}
  >
    <path d="M6 5a1 1 0 0 0-2 0v22a1 1 0 1 0 2 0zm22.003 1.504c0-2.002-2.236-3.192-3.897-2.073l-14.003 9.432A2.5 2.5 0 0 0 10.09 18l14.003 9.56c1.66 1.132 3.91-.056 3.91-2.065z" />
  </svg>
);

/** Clock face — API timestamp display (stroke-based icon) */
export const TimestampIcon: React.FC<IconProps> = ({
  width = 16,
  height = 16,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={width}
    height={height}
    fill="none"
    stroke={fill}
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);

/** Text wrapping between margins — word wrap */
export const WrapTextIcon: React.FC<IconProps> = ({
  width = 22,
  height = 22,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={width}
    height={height}
    fill={fill}
  >
    <path d="M4 20V4h2v16zm14 0V4h2v16zm-7.4-2.45L7.05 14l3.55-3.525l1.4 1.4L10.875 13H13q.825 0 1.413-.587T15 11t-.587-1.412T13 9H7V7h6q1.65 0 2.825 1.175T17 11t-1.175 2.825T13 15h-2.125L12 16.125z" />
  </svg>
);

/** Curly braces with document — JSON / structured data parsing */
export const ParseJsonIcon: React.FC<IconProps> = ({
  width = 20,
  height = 20,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={width}
    height={height}
    fill={fill}
  >
    <path d="M5 3c-1.1 0-2 .9-2 2s-.9 2-2 2v2c1.1 0 2 .9 2 2s.9 2 2 2h2v-2H5v-1c0-1.1-.9-2-2-2c1.1 0 2-.9 2-2V5h2V3m4 0c1.1 0 2 .9 2 2s.9 2 2 2v2c-1.1 0-2 .9-2 2s-.9 2-2 2H9v-2h2v-1c0-1.1.9-2 2-2c-1.1 0-2-.9-2-2V5H9V3zm11 3v12c0 1.11-.89 2-2 2H4a2 2 0 0 1-2-2v-3h2v3h16V6h-2.97V4H20c1.11 0 2 .89 2 2" />
  </svg>
);
