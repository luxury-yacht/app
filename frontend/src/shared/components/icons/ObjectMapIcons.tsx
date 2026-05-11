import React from 'react';
import type { IconProps } from './SharedIcons';

export const ObjectMapIcon: React.FC<IconProps> = ({ width = 24, height = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    width={width}
    height={height}
  >
    <circle cx="5" cy="12" r="2" />
    <circle cx="19" cy="6" r="2" />
    <circle cx="19" cy="18" r="2" />
    <path d="M7 12h4m0 0 6-6m-6 6 6 6" />
  </svg>
);

export const ZoomInIcon: React.FC<IconProps> = ({ width = 24, height = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    width={width}
    height={height}
  >
    <circle cx="10.1" cy="10.1" r="8" />
    <line x1="21.9" y1="21.9" x2="16.3" y2="16.3" />
    <line x1="13.1" y1="10.1" x2="7.1" y2="10.1" />
    <line x1="10" y1="13" x2="10" y2="7" />
  </svg>
);

export const ZoomOutIcon: React.FC<IconProps> = ({ width = 24, height = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    width={width}
    height={height}
  >
    <circle cx="10.1" cy="10.1" r="8" />
    <line x1="21.9" y1="21.9" x2="16.3" y2="16.3" />
    <line x1="13.1" y1="10.1" x2="7.1" y2="10.1" />
  </svg>
);

export const ResetZoomIcon: React.FC<IconProps> = ({ width = 24, height = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    width={width}
    height={height}
  >
    <path d="M6.76287 7.07467C6.91027 7.16578 7 7.32671 7 7.5V12.5C7 12.7761 6.77614 13 6.5 13C6.22386 13 6 12.7761 6 12.5V8.30902L5.72361 8.44721C5.47662 8.57071 5.17628 8.4706 5.05279 8.22361C4.92929 7.97662 5.0294 7.67628 5.27639 7.55279L6.27639 7.05279C6.43139 6.97529 6.61546 6.98357 6.76287 7.07467ZM14 7.5C14 7.32671 13.9103 7.16578 13.7629 7.07467C13.6155 6.98357 13.4314 6.97529 13.2764 7.05279L12.2764 7.55279C12.0294 7.67628 11.9293 7.97662 12.0528 8.22361C12.1763 8.4706 12.4766 8.57071 12.7236 8.44721L13 8.30902V12.5C13 12.7761 13.2239 13 13.5 13C13.7761 13 14 12.7761 14 12.5V7.5ZM10 8.5C10 8.77614 9.77614 9 9.5 9C9.22386 9 9 8.77614 9 8.5C9 8.22386 9.22386 8 9.5 8C9.77614 8 10 8.22386 10 8.5ZM9.5 12C9.77614 12 10 11.7761 10 11.5C10 11.2239 9.77614 11 9.5 11C9.22386 11 9 11.2239 9 11.5C9 11.7761 9.22386 12 9.5 12ZM2 6.75C2 5.23122 3.23122 4 4.75 4H15.25C16.7688 4 18 5.23122 18 6.75V13.25C18 14.7688 16.7688 16 15.25 16H4.75C3.23122 16 2 14.7688 2 13.25V6.75ZM4.75 5C3.7835 5 3 5.7835 3 6.75V13.25C3 14.2165 3.7835 15 4.75 15H15.25C16.2165 15 17 14.2165 17 13.25V6.75C17 5.7835 16.2165 5 15.25 5H4.75Z" />
  </svg>
);

export const FitToViewIcon: React.FC<IconProps> = ({ width = 24, height = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    width={width}
    height={height}
  >
    <path d="M9 4H4v5" />
    <path d="M15 4h5v5" />
    <path d="M20 15v5h-5" />
    <path d="M4 15v5h5" />
  </svg>
);

export const AutoFitIcon: React.FC<IconProps> = ({ width = 24, height = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    width={width}
    height={height}
  >
    <path d="M9 4H4v5" />
    <path d="M15 4h5v5" />
    <path d="M20 15v5h-5" />
    <path d="M4 15v5h5" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);

export const FocusModeIcon: React.FC<IconProps> = ({ width = 24, height = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="3 3 26 26"
    fill="currentColor"
    width={width}
    height={height}
  >
    <path d="M16 18a2 2 0 1 0 0-4a2 2 0 0 0 0 4m-7-2a7 7 0 1 1 14 0a7 7 0 0 1-14 0m7-5a5 5 0 1 0 0 10a5 5 0 0 0 0-10M4 16.001C4 9.373 9.373 4 16.001 4s12.002 5.373 12.002 12.001S22.63 28.003 16 28.003C9.373 28.003 4 22.63 4 16M16.001 6C10.478 6 6 10.478 6 16.001c0 5.524 4.478 10.002 10.001 10.002c5.524 0 10.002-4.478 10.002-10.002C26.003 10.478 21.525 6 16 6" />
  </svg>
);

export const LegendIcon: React.FC<IconProps> = ({ width = 24, height = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth={2}
    width={width}
    height={height}
  >
    <line x1="4" y1="6" x2="9" y2="6" />
    <line x1="4" y1="12" x2="9" y2="12" />
    <line x1="4" y1="18" x2="9" y2="18" />
    <line x1="13" y1="6" x2="20" y2="6" />
    <line x1="13" y1="12" x2="20" y2="12" />
    <line x1="13" y1="18" x2="20" y2="18" />
  </svg>
);

export const ObjectMapLegendSwatchIcon: React.FC<IconProps & { edgeClassName: string }> = ({
  width = 26,
  height = 6,
  className = 'object-map__legend-swatch',
  edgeClassName,
}) => (
  <svg className={className} width={width} height={height} aria-hidden="true">
    <line x1={0} y1={3} x2={26} y2={3} className={edgeClassName} />
  </svg>
);
