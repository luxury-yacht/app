import React from 'react';
import type { IconProps } from './SharedIcons';

export const KubeconfigsIcon: React.FC<IconProps> = ({
  width = 16,
  height = 16,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill={fill}
    width={width}
    height={height}
  >
    <path d="M21 4V6L14 14V21H10V14L3 6V4H21ZM5.4254 6L12 13.5114L18.5746 6H5.4254Z" />
  </svg>
);

export const DisplayIcon: React.FC<IconProps> = ({
  width = 16,
  height = 16,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill={fill}
    width={width}
    height={height}
  >
    <path d="M13 18V20H17V22H7V20H11V18H3.00094C2.4485 18 2 17.5551 2 17.0066V3.9934C2 3.44476 2.45531 3 2.9918 3H21.0082C21.556 3 22 3.44495 22 3.9934V17.0066C22 17.5552 21.5447 18 21.0091 18H13ZM4 5V16H20V5H4Z" />
  </svg>
);

export const AdvancedIcon: React.FC<IconProps> = ({
  width = 16,
  height = 16,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill={fill}
    width={width}
    height={height}
  >
    <path d="M17 16V18H22V20H17V22H15V20H2V18H15V16H17ZM7 10V12H2V14H7V16H9V10H7ZM22 12V14H11V12H22ZM17 4V6H22V8H17V10H15V4H17ZM2 6H13V8H2V6Z" />
  </svg>
);

export const AppearanceModeIcon: React.FC<IconProps> = ({
  width = 16,
  height = 16,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill={fill}
    width={width}
    height={height}
  >
    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10m0-2V4a8 8 0 1 1 0 16" />
  </svg>
);

export const KubeconfigFolderIcon: React.FC<IconProps> = ({
  width = 14,
  height = 14,
  className,
}) => (
  <svg viewBox="0 0 16 16" width={width} height={height} fill="none" className={className}>
    <path
      d="M1.75 3.5h4.19c.27 0 .53.1.72.3l1.27 1.27c.19.19.45.3.72.3h5.6c.55 0 1 .45 1 1v6.88c0 .55-.45 1-1 1H1.75c-.55 0-1-.45-1-1V4.5c0-.55.45-1 1-1Z"
      stroke="currentColor"
      strokeWidth="1.25"
    />
  </svg>
);
