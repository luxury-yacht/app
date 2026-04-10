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

/** Circular arrows — auto-refresh */
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

/** Clock face — API timestamp display */
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

/** Palette / ANSI — render terminal color codes */
export const AnsiColorIcon: React.FC<IconProps> = ({
  width = 18,
  height = 18,
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
    strokeWidth={1.8}
  >
    <path d="M12 3.5c4.97 0 9 4.03 9 9c0 3.59-2.11 6.7-5.16 8.14c-1.14.54-2.34-.35-2.23-1.6l.09-1c.08-.91-.63-1.69-1.54-1.69H10a5.5 5.5 0 0 1 0-11z" />
    <circle cx="7.5" cy="10" r="1" fill={fill} stroke="none" />
    <circle cx="10.5" cy="7.5" r="1" fill={fill} stroke="none" />
    <circle cx="14.5" cy="7.8" r="1" fill={fill} stroke="none" />
    <circle cx="16.8" cy="11.3" r="1" fill={fill} stroke="none" />
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

/** Indented document — pretty-printed JSON */
export const PrettyJsonIcon: React.FC<IconProps> = ({
  width = 20,
  height = 20,
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
    <path d="M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2" />
    <path d="M16 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2" />
    <path d="M9 8h6" />
    <path d="M9 12h3" />
    <path d="M11 16h4" />
  </svg>
);

/** Clipboard — copy to clipboard */
export const CopyIcon: React.FC<IconProps> = ({
  width = 20,
  height = 20,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 32 32"
    width={width}
    height={height}
    fill={fill}
  >
    <path d="M11 12a1 1 0 1 0 0 2h10a1 1 0 1 0 0-2zm-1 6a1 1 0 0 1 1-1h5a1 1 0 1 1 0 2h-5a1 1 0 0 1-1-1m1 4a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2zM21.83 4A3 3 0 0 0 19 2h-6a3 3 0 0 0-2.83 2H8.5A3.5 3.5 0 0 0 5 7.5v19A3.5 3.5 0 0 0 8.5 30h15a3.5 3.5 0 0 0 3.5-3.5v-19A3.5 3.5 0 0 0 23.5 4zM12 5a1 1 0 0 1 1-1h6a1 1 0 1 1 0 2h-6a1 1 0 0 1-1-1M7 7.5A1.5 1.5 0 0 1 8.5 6h1.67A3 3 0 0 0 13 8h6a3 3 0 0 0 2.83-2h1.67A1.5 1.5 0 0 1 25 7.5v19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 7 26.5z" />
  </svg>
);

/** Magnifier with star — highlight matching search terms */
export const HighlightSearchIcon: React.FC<IconProps> = ({
  width = 18,
  height = 18,
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
    <circle cx="10.5" cy="10.5" r="5.5" />
    <path d="m15 15 4.5 4.5" />
    <path d="m10.5 7.5.7 1.5 1.5.7-1.5.7-.7 1.5-.7-1.5-1.5-.7 1.5-.7z" />
  </svg>
);

/** Magnifier with slash — invert the text filter */
export const InverseSearchIcon: React.FC<IconProps> = ({
  width = 18,
  height = 18,
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
    <circle cx="10.5" cy="10.5" r="5.5" />
    <path d="m15 15 4.5 4.5" />
    <path d="M6.5 14.5 14.5 6.5" />
  </svg>
);

/** Regex-style glyph — treat the filter text as a regular expression */
export const RegexSearchIcon: React.FC<IconProps> = ({
  width = 18,
  height = 18,
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
    <path d="M4 7c1.5 0 2.5 1 2.5 2.5S5.5 12 4 12c1.5 0 2.5 1 2.5 2.5S5.5 17 4 17" />
    <path d="M12 7v10" />
    <path d="m10 9 2-2 2 2" />
    <path d="m10 15 2 2 2-2" />
    <path d="M20 7c-1.5 0-2.5 1-2.5 2.5S18.5 12 20 12c-1.5 0-2.5 1-2.5 2.5S18.5 17 20 17" />
  </svg>
);
