import type React from 'react';
import type { IconProps } from './SharedIcons';

// Select all / none are commands over the whole list, so they are drawn as bare
// marks. A rounded-square outline would collide with the real checkbox each
// option row now carries, making the header read as a third checkbox state
// rather than an action.
export const DropdownSelectAllIcon: React.FC<IconProps> = ({ width = 24, height = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={width}
    height={height}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M4 12.5 9.5 18 20 6.5" />
  </svg>
);

export const DropdownSelectNoneIcon: React.FC<IconProps> = ({ width = 24, height = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={width}
    height={height}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M5 12h14" />
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
    focusable="false"
  >
    <polyline points="6,9 12,15 18,9" />
  </svg>
);
