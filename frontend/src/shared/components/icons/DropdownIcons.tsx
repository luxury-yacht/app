import React from 'react';
import type { IconProps } from './SharedIcons';

export const DropdownSelectAllIcon: React.FC<IconProps> = ({ width = 24, height = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    width={width}
    height={height}
    aria-hidden="true"
  >
    <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" fill="none" stroke="currentColor" />
    <path d="M8 4.5v7" stroke="currentColor" strokeLinecap="round" />
    <path d="M4.5 8h7" stroke="currentColor" strokeLinecap="round" />
  </svg>
);

export const DropdownSelectNoneIcon: React.FC<IconProps> = ({ width = 24, height = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    width={width}
    height={height}
    aria-hidden="true"
  >
    <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" fill="none" stroke="currentColor" />
    <path d="M4.75 8h6.5" stroke="currentColor" strokeLinecap="round" />
  </svg>
);

export const DropdownArrowIcon: React.FC<IconProps> = ({ width = 24, height = 24 }) => (
  <svg
    width={width}
    height={height}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="6,9 12,15 18,9" />
  </svg>
);
