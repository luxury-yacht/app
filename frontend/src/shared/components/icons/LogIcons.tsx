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
    fill={fill}
  >
    <path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5c0 .12.05.23.13.33c.41.47.64 1.06.64 1.67A2.5 2.5 0 0 1 12 22m0-18c-4.41 0-8 3.59-8 8s3.59 8 8 8c.28 0 .5-.22.5-.5a.54.54 0 0 0-.14-.35c-.41-.46-.63-1.05-.63-1.65a2.5 2.5 0 0 1 2.5-2.5H16c2.21 0 4-1.79 4-4c0-3.86-3.59-7-8-7" />
    <circle cx="6.5" cy="11.5" r="1.5" />
    <circle cx="9.5" cy="7.5" r="1.5" />
    <circle cx="14.5" cy="7.5" r="1.5" />
    <circle cx="17.5" cy="11.5" r="1.5" />
  </svg>
);

/** Curly braces with document — JSON / structured data parsing */
export const ParseJsonIcon: React.FC<IconProps> = ({
  width = 16,
  height = 16,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    width={width}
    height={height}
    fill={fill}
  >
    <path d="M1.364 5.138v12.02h17.272V5.138zM.909 1.5h18.182c.502 0 .909.4.909.895v15.21a.9.9 0 0 1-.91.895H.91c-.503 0-.91-.4-.91-.895V2.395C0 1.9.407 1.5.91 1.5m5.227 1.759c0-.37.306-.671.682-.671s.682.3.682.671v13.899c0 .37-.305.67-.682.67a.676.676 0 0 1-.682-.67zm6.96-.64c.377 0 .682.3.682.67v4.995h4.91c.377 0 .683.301.683.672c0 .37-.306.671-.682.671l-4.911-.001v3.062h5.002c.377 0 .682.3.682.671c0 .37-.305.671-.682.671h-5.002v3.158a.676.676 0 0 1-.682.671a.676.676 0 0 1-.681-.67l-.001-3.159H1.001a.676.676 0 0 1-.682-.67c0-.371.305-.672.682-.672h11.413V9.626L.909 9.627a.676.676 0 0 1-.682-.671c0-.37.306-.671.682-.671l11.505-.001V3.289c0-.37.306-.67.682-.67" />
  </svg>
);

/** Indented document — pretty-printed JSON */
export const PrettyJsonIcon: React.FC<IconProps> = ({
  width = 18,
  height = 18,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    width={width}
    height={height}
    fill={fill}
  >
    <path d="M1.75 2.5a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5zm3 3a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5zM3 9.25a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 3 9.25M1.75 11.5a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5zm8.75-5.25a.75.75 0 0 1 .75-.75h2a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1-.75-.75M9.75 2.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5z" />
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
  width = 16,
  height = 16,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    width={width}
    height={height}
    fill={fill}
  >
    <g transform="translate(0 -0.7">
      <path
        fillRule="evenodd"
        d="M2 14.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75m1.5-3.252V9.112l1.29-1.258L6.6 9.688l-1.268 1.31zM7.645 8.61l4.715-4.866a.5.5 0 0 0-.028-.722l-1.01-.895l.995-1.123l1.01.895a2 2 0 0 1 .11 2.889l-7.47 7.71H2V8.48l7.594-7.41a2 2 0 0 1 2.723-.066l-.995 1.123a.5.5 0 0 0-.68.016L5.863 6.806z"
        clipRule="evenodd"
      />
    </g>
  </svg>
);

/** Magnifier with slash — invert the text filter */
export const InverseSearchIcon: React.FC<IconProps> = ({
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
    <path d="M19 10.5C19 5.81 15.19 2 10.5 2S2 5.81 2 10.5S5.81 19 10.5 19c1.98 0 3.81-.69 5.25-1.83L20 21.42l1.41-1.41l-4.25-4.25a8.47 8.47 0 0 0 1.83-5.25Zm-15 0C4 6.92 6.92 4 10.5 4S17 6.92 17 10.5S14.08 17 10.5 17S4 14.08 4 10.5" />
    <path d="m12.79 6.79l-2.29 2.3l-2.29-2.3l-1.42 1.42l2.3 2.29l-2.3 2.29l1.42 1.42l2.29-2.3l2.29 2.3l1.42-1.42l-2.3-2.29l2.3-2.29z" />
  </svg>
);

/** Regex-style glyph — treat the filter text as a regular expression */
export const RegexSearchIcon: React.FC<IconProps> = ({
  width = 16,
  height = 16,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    width={width}
    height={height}
    fill={fill}
  >
    <path
      fillRule="evenodd"
      d="M10.25 1.75a.75.75 0 0 0-1.5 0v3.451L5.761 3.475a.75.75 0 1 0-.75 1.3L8 6.5L5.011 8.225a.75.75 0 1 0 .75 1.3L8.75 7.799v3.451a.75.75 0 0 0 1.5 0V7.8l2.989 1.725a.75.75 0 1 0 .75-1.3L11 6.5l2.989-1.725a.75.75 0 1 0-.75-1.3L10.25 5.201zM3 15a2 2 0 1 0 0-4a2 2 0 0 0 0 4"
      clipRule="evenodd"
    />
  </svg>
);
