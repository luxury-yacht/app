import React from 'react';

type IconProps = {
  width?: number;
  height?: number;
};

export const YamlManagedFieldsIcon: React.FC<IconProps> = ({ width = 16, height = 16 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    width={width}
    height={height}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.25"
  >
    <rect x="2.5" y="2.5" width="4" height="4" rx="0.75" />
    <rect x="9.5" y="2.5" width="4" height="4" rx="0.75" />
    <rect x="2.5" y="9.5" width="4" height="4" rx="0.75" />
    <path d="M6.5 4.5h3M4.5 6.5v3" />
  </svg>
);

export const YamlEditIcon: React.FC<IconProps> = ({ width = 16, height = 16 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    width={width}
    height={height}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.25"
  >
    <path d="M3 11.75V13h1.25l6.9-6.9l-1.25-1.25z" />
    <path d="M9.75 4.85l1.25 1.25M3 13h10.5" />
  </svg>
);

export const YamlCancelIcon: React.FC<IconProps> = ({ width = 16, height = 16 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    width={width}
    height={height}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.5"
  >
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const YamlSaveIcon: React.FC<IconProps> = ({ width = 16, height = 16 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    width={width}
    height={height}
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.25"
  >
    <path d="M3 2.75h8l2 2V13.25H3z" />
    <path d="M5 2.75v3.5h4v-3.5M5.25 13.25v-3h5.5v3" />
  </svg>
);
